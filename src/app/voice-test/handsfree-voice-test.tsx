"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";
import { connectLiveAudio, playVoiceReadback, recordVoiceConfirmation, type LiveSessionAnswer } from "@/shared/live-client";
import type { Ticket, Quote, Menu } from "@/shared/contracts";
import { PUBLIC_DEMO_BEARER } from "@/shared/public-demo";
import { createApiClient } from "@/shared/api-client";
import styles from "./voice.module.css";

type Connection = Awaited<ReturnType<typeof connectLiveAudio>>;
type Status = { phase: string; readbackId?: string; ticket?: Ticket; quote?: Quote };
const money = (cents: number) => `S$${(cents / 100).toFixed(2)}`;
async function sendCommand<T>(body: object, signal?: AbortSignal, publicDemo = false): Promise<T> {
  let token = PUBLIC_DEMO_BEARER;
  if (!publicDemo) {
    const { data, error } = await createClient().auth.getSession();
    if (error || !data.session) throw new Error("Sign in again to start the voice device.");
    token = data.session.access_token;
  }
  const response = await fetch("/api/v1/live/handsfree", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Voice operation failed.");
  return result as T;
}
const encode = (bytes: Uint8Array) => { let text = ""; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); };

export function HandsfreeVoiceTest({ publicDemo = false }: { publicDemo?: boolean }) {
  const command = <T,>(body: object, signal?: AbortSignal) => sendCommand<T>(body, signal, publicDemo);
  const audio = useRef<HTMLAudioElement>(null), connection = useRef<Connection | null>(null), controller = useRef<AbortController | null>(null), context = useRef<AudioContext | null>(null);
  const mounted = useRef(true);
  const transcriptDraft = useRef({ text: "", at: 0, sent: "" });
  const [state, setState] = useState("Ready"), [running, setRunning] = useState(false), [text, setText] = useState(""), [error, setError] = useState(""), [ticket, setTicket] = useState<Ticket | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  useEffect(() => { let active = true; void createApiClient().readMenu(DEMO_RESTAURANT_ID).then(value => { if (active) setMenu(value); }).catch(() => undefined); return () => { active = false; }; }, []);
  async function stop() {
    controller.current?.abort(); controller.current = null;
    const current = connection.current; connection.current = null;
    if (audio.current) audio.current.muted = true;
    await current?.close().catch(() => { if (mounted.current) setError("Session close was not acknowledged. The local server will expire it."); });
    await context.current?.close().catch(() => undefined); context.current = null;
    if (mounted.current) { setRunning(false); setState("Stopped"); setQuote(null); }
  }
  useEffect(() => { mounted.current = true; const end = () => { void stop(); }; window.addEventListener("pagehide", end); return () => { mounted.current = false; window.removeEventListener("pagehide", end); void stop(); }; }, []);
  async function start() {
    if (controller.current || !audio.current) return;
    const abort = new AbortController(); controller.current = abort;
    transcriptDraft.current = { text: "", at: 0, sent: "" };
    setRunning(true); setError(""); setTicket(null); setQuote(null); setText(""); setState("Connecting GPT-Live");
    const ctx = new AudioContext(); context.current = ctx;
    try {
      await ctx.resume(); audio.current.muted = false;
      const live = await connectLiveAudio(audio.current, (sdp, signal) => command<LiveSessionAnswer>({ action: "start", restaurantId: DEMO_RESTAURANT_ID, sdp }, signal), {
        signal: abort.signal,
        onTranscript: value => { transcriptDraft.current.text = value; transcriptDraft.current.at = Date.now(); if (mounted.current) setText(value); },
        onPlaybackBlocked: () => { abort.abort(); if (mounted.current) setError("Audio playback was blocked. Stop and start again with speaker access enabled."); },
        endSession: answer => command({ action: "close", voiceSessionId: answer.voiceSessionId }).then(() => undefined),
      });
      if (abort.signal.aborted) { await live.close(); return; }
      connection.current = live;
      const seen = new Set<string>();
      while (!abort.signal.aborted) {
        const status = await command<Status>({ action: "status", voiceSessionId: live.voiceSessionId }, abort.signal);
        if (!mounted.current || abort.signal.aborted) break;
        if (status.phase === "error" || status.phase === "closed") throw new Error("The voice session ended before completion. Check the kitchen queue before starting a new order.");
        if (status.phase === "collecting" && transcriptDraft.current.text && transcriptDraft.current.sent !== transcriptDraft.current.text && Date.now() - transcriptDraft.current.at >= 1200) {
          transcriptDraft.current.sent = transcriptDraft.current.text;
          await command({ action: "draft", voiceSessionId: live.voiceSessionId, text: transcriptDraft.current.text }, abort.signal);
        }
        setQuote(status.quote ?? null);
        live.setMicrophoneEnabled(status.phase === "collecting");
        audio.current!.muted = !["collecting", "submitted"].includes(status.phase);
        setState(status.phase === "collecting" ? "Listening — order aloud, including dine-in or takeaway" : status.phase);
        if (status.phase === "readback" && status.readbackId && !seen.has(status.readbackId)) {
          seen.add(status.readbackId);
          const id = status.readbackId;
          const result = await command<{ audio: string }>({ action: "audio", voiceSessionId: live.voiceSessionId, readbackId: id }, abort.signal);
          setState("Reading back your order");
          await playVoiceReadback(ctx, Uint8Array.from(atob(result.audio), char => char.charCodeAt(0)), abort.signal);
          await command({ action: "playback", voiceSessionId: live.voiceSessionId, readbackId: id }, abort.signal);
          setState("Answer aloud now, then wait quietly");
          const wav = await recordVoiceConfirmation(ctx, abort.signal);
          setState("Checking your recorded answer");
          const body = { action: "confirm", voiceSessionId: live.voiceSessionId, readbackId: id, audio: encode(wav) };
          // Exact recording/id retry recovers uncertain transport without a new consent.
          try { await command(body, abort.signal); }
          catch (failure) { if (abort.signal.aborted || !(failure instanceof TypeError)) throw failure; await command(body, abort.signal); }
        }
        if (status.ticket) { setTicket(status.ticket); setState("Order sent to kitchen — payment due at the stall"); audio.current!.muted = false; live.setMicrophoneEnabled(false); break; }
        await new Promise<void>(resolve => setTimeout(resolve, 350));
      }
    } catch (failure) {
      if (!abort.signal.aborted && mounted.current) setError(failure instanceof Error ? failure.message : "Voice ordering failed.");
      await stop();
    }
  }
  const summary = ticket?.cart ?? quote;
  return <main className={styles.page}>
    <Link href="/">← Portal</Link>
    <header className={styles.header}><p className="eyebrow">Jiak Simi · Voice ordering</p><h1>Tell us what you’d like.</h1><p>Order with GPT Live. Say your dish and any extras. We assume dine-in and chilli unless you say otherwise. The voice is AI-generated.</p></header>
    <div className={styles.grid}>
      <section className={`card ${styles.panel}`} aria-labelledby="voice-guide"><h2 id="voice-guide">What can I order?</h2>
        {menu ? <ul className={styles.menu}>{menu.dishes.filter(dish => dish.available).map(dish => <li key={dish.id}><strong>{dish.name}</strong><span>{money(dish.priceCents)}</span></li>)}</ul> : <p>Loading today’s menu…</p>}
        <p>Add egg, char siew or shao rou. Ask for chilli or no chilli.</p>
        <div className={styles.example}><strong>Try saying</strong><p>“One Char Siew Rice, add egg, no chilli, takeaway.”</p></div>
        <p>Listen to the summary. After the beep, say <strong>“Confirm.”</strong></p>
        <div className="actions"><button className="btn btn-primary" onClick={() => { void start(); }} disabled={running}>Start device</button><button className="btn btn-outline" onClick={() => { void stop(); }} disabled={!running}>Stop device</button></div>
        <p role="status" className={styles.state}>{state}</p>{error && <p role="alert" className={styles.error}>{error}</p>}
      </section>
      <section className={`card ${styles.panel}`} aria-labelledby="voice-summary" aria-live="polite"><p className="eyebrow">{ticket ? "Sent to the kitchen" : summary ? "Ready for your spoken confirmation" : "Your voice order"}</p><h2 id="voice-summary">Your order</h2>
        {summary ? <><p>{summary.fulfillmentType === "dine_in" ? "Dine-in" : summary.fulfillmentType === "takeaway" ? "Takeaway" : "Dining choice not recorded"}</p><ul className={styles.order}>{summary.lines.map((line, index) => <li key={`${line.dishId}-${index}`}><div><strong>{line.quantity} × {line.name}</strong><strong>{money(line.lineTotalCents)}</strong></div>{line.options.length > 0 && <p>{line.options.map(option => `${option.name}${option.priceDeltaCents ? ` (${money(option.priceDeltaCents)} per dish)` : ""}`).join(" · ")}</p>}</li>)}</ul><div className={styles.total}><strong>Total</strong><strong>{money(summary.totalCents)}</strong></div><p>{ticket ? "Order received · Unpaid — pay at the stall." : "Not placed yet · Payment due at the stall."}</p>{ticket && <><p className={styles.ticket}>Ticket {ticket.id}</p><Link className="btn btn-teal" href={`/kitchen?restaurantId=${DEMO_RESTAURANT_ID}`}>View in Cook Mode →</Link></>}</> : <p className={styles.empty}>Your dishes, extras and total will appear here after GPT Live checks your order.</p>}
      </section>
    </div>
    <details className={styles.monitor}><summary>Conversation transcript</summary><p>{text || "No speech yet."}</p></details><audio ref={audio} autoPlay />
  </main>;
}
