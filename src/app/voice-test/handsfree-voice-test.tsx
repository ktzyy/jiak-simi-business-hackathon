"use client";
import Link from "next/link";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";
import { connectLiveAudio, playVoiceReadback, recordVoiceConfirmation, type LiveSessionAnswer } from "@/shared/live-client";
import type { Ticket, Quote, Menu } from "@/shared/contracts";
import { PUBLIC_DEMO_BEARER } from "@/shared/public-demo";
import { createApiClient } from "@/shared/api-client";
import { isVoiceMenuConversation } from "@/shared/live-conversation";
import styles from "./voice.module.css";

type Connection = Awaited<ReturnType<typeof connectLiveAudio>>;
type Status = { phase: string; readbackId?: string; ticket?: Ticket; quote?: Quote; errorCode?: string; errorStage?: string; clarification?: string };
const phaseLabel: Record<string, string> = { collecting: "Listening — tell us your order", preparing: "Checking your order and total…", readback: "Your order is ready to read back", playing: "Reading back your order", confirming: "Say Confirm after the beep", transcribing: "Checking your answer…", submitted: "Order sent to the kitchen" };
function failureMessage(status: Status) {
  if (status.errorCode === "VOICE_PREPARATION_TIMEOUT") return "Checking took too long. Start the mic again or choose your dishes below.";
  if (status.errorCode === "RATE_LIMITED") return "The demo is busy. Please wait a moment, then start again.";
  if (status.errorStage === "mute" || status.errorStage === "provider") return "The voice connection was interrupted. Start again to reconnect.";
  if (status.errorStage === "prepare") return "We couldn't check that order. Please start again and say the dish name.";
  if (status.errorStage === "speech") return "We couldn't read your order aloud. Please start again.";
  return "The voice session ended before completion. Check Cook Mode before starting a new order.";
}
const money = (cents: number) => `S$${(cents / 100).toFixed(2)}`;
async function sendCommand<T>(body: object, signal?: AbortSignal, publicDemo = false): Promise<T> {
  let token = PUBLIC_DEMO_BEARER;
  if (!publicDemo) {
    const { data, error } = await createClient().auth.getSession();
    if (error || !data.session) throw new Error("Sign in again to start the voice device.");
    token = data.session.access_token;
  }
  const response = await fetch("/api/v1/live/handsfree", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000), cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Voice operation failed.");
  return result as T;
}
const encode = (bytes: Uint8Array) => { let text = ""; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); };

export type VoiceControls = { start: () => void; stop: () => void };
export function HandsfreeVoiceTest({ publicDemo = false, inline = false, controlsRef, onActiveChange, onManualConfirm, manualBusy = false }: { publicDemo?: boolean; inline?: boolean; controlsRef?: Ref<VoiceControls>; onActiveChange?: (active: boolean) => void; onManualConfirm?: (quote: Quote) => void; manualBusy?: boolean }) {
  const command = <T,>(body: object, signal?: AbortSignal) => sendCommand<T>(body, signal, publicDemo);
  const audio = useRef<HTMLAudioElement>(null), connection = useRef<Connection | null>(null), controller = useRef<AbortController | null>(null), context = useRef<AudioContext | null>(null);
  const mounted = useRef(true);
  const spokenDispatched = useRef(false);
  const manualClaimed = useRef(false);
  const [confirmingManually, setConfirmingManually] = useState(false);
  const [clarification, setClarification] = useState("");
  const transcriptDraft = useRef({ text: "", at: 0, sent: "" });
  const [state, setState] = useState("Ready"), [running, setRunning] = useState(false), [text, setText] = useState(""), [error, setError] = useState(""), [ticket, setTicket] = useState<Ticket | null>(null);
  const [opened, setOpened] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  useEffect(() => { let active = true; void createApiClient().readMenu(DEMO_RESTAURANT_ID).then(value => { if (active) setMenu(value); }).catch(() => undefined); return () => { active = false; }; }, []);
  async function stop() {
    controller.current?.abort(); controller.current = null;
    const current = connection.current; connection.current = null;
    if (audio.current) audio.current.muted = true;
    await current?.close().catch(() => { if (mounted.current) setError("Session close was not acknowledged. The local server will expire it."); });
    await context.current?.close().catch(() => undefined); context.current = null;
    if (mounted.current) { setRunning(false); onActiveChange?.(false); setState("Stopped"); }
  }
  async function confirmManually() {
    if (!quote || !onManualConfirm || manualBusy || manualClaimed.current || spokenDispatched.current) return;
    const reviewed = quote;
    manualClaimed.current = true;
    setConfirmingManually(true);
    // Abort the recording/loop synchronously before it can dispatch spoken consent.
    await stop();
    try { if (!spokenDispatched.current) onManualConfirm(reviewed); }
    finally { manualClaimed.current = false; if (mounted.current) setConfirmingManually(false); }
  }
  useEffect(() => { mounted.current = true; const end = () => { void stop(); }; window.addEventListener("pagehide", end); return () => { mounted.current = false; window.removeEventListener("pagehide", end); void stop(); }; }, []);
  async function start() {
    if (controller.current || manualClaimed.current || manualBusy || !audio.current) return;
    const abort = new AbortController(); controller.current = abort;
    transcriptDraft.current = { text: "", at: 0, sent: "" }; spokenDispatched.current = false;
    setClarification("");
    setOpened(true); setRunning(true); onActiveChange?.(true); setError(""); setTicket(null); setQuote(null); setText(""); setState("Connecting GPT-Live");
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
      await live.waitUntilStarted();
      await command({ action: "greet", voiceSessionId: live.voiceSessionId }, abort.signal);
      const seen = new Set<string>();
      while (!abort.signal.aborted) {
        let status = await command<Status>({ action: "status", voiceSessionId: live.voiceSessionId }, abort.signal);
        if (!mounted.current || abort.signal.aborted) break;
        if (status.phase === "error" || status.phase === "closed") throw new Error(failureMessage(status));
        if (status.phase === "collecting" && transcriptDraft.current.text && !isVoiceMenuConversation(transcriptDraft.current.text) && transcriptDraft.current.sent !== transcriptDraft.current.text && Date.now() - transcriptDraft.current.at >= 1200) {
          transcriptDraft.current.sent = transcriptDraft.current.text;
          await command({ action: "draft", voiceSessionId: live.voiceSessionId, text: transcriptDraft.current.text }, abort.signal);
        }
        if (status.phase === "collecting" || (status.phase === "readback" && status.errorStage === "transcribe")) spokenDispatched.current = false;
        setQuote(status.quote ?? null);
        // Keep silent audio frames flowing while the server acknowledges its mute.
        live.setMicrophoneEnabled(["collecting", "preparing"].includes(status.phase));
        setClarification(status.clarification ?? "");
        audio.current!.muted = !["collecting", "submitted"].includes(status.phase);
        setState(phaseLabel[status.phase] ?? "Checking your order…");
        if (status.phase === "readback" && status.readbackId && !seen.has(status.readbackId)) {
          seen.add(status.readbackId);
          if (status.errorCode) setError("I couldn't hear the confirmation clearly. Listen once more, then say Confirm after the beep.");
          else setError("");
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
          if (abort.signal.aborted) break;
          spokenDispatched.current = true;
          try { status = await command<Status>(body, abort.signal); }
          catch (failure) { if (abort.signal.aborted || !(failure instanceof TypeError)) throw failure; status = await command<Status>(body, abort.signal); }
        }
        if (status.ticket) { setTicket(status.ticket); await stop(); setState("Order sent to kitchen · Pay at the stall"); break; }
        await new Promise<void>(resolve => setTimeout(resolve, 350));
      }
    } catch (failure) {
      if (!abort.signal.aborted && mounted.current) setError(failure instanceof Error ? failure.message : "Voice ordering failed.");
      await stop();
    }
  }
  useImperativeHandle(controlsRef, () => ({ start: () => { void start(); }, stop: () => { void stop(); } }));
  const summary = ticket?.cart ?? quote;
  if (inline) return <section className={styles.inlineVoice} hidden={!opened} aria-label="Voice order">
    <div className={styles.inlineStatus}><strong role="status">{state}</strong>{running && <button type="button" className="btn btn-outline" onClick={() => { void stop(); }}>Stop mic</button>}</div>
    <p className={styles.voiceDisclosure}>AI voice ordering · Check your order, then tap Confirm order or say “Confirm” after the beep.</p>
    <p className={styles.transcript} aria-live="polite" aria-label="Live transcript">{text || (running ? "Tell us your dishes and add-ons…" : "Mic off")}</p>
    {clarification && !error && <p role="status" className={styles.inlineError}>{clarification}</p>}
    {error && <p role="alert" className={styles.inlineError}>{error}</p>}
    {summary && <div className={styles.inlineOrder} aria-live="polite"><h3>{ticket ? "Order sent" : "Your order"}</h3><p>{summary.fulfillmentType === "takeaway" ? "Takeaway" : "Dine-in"}</p><ul className={styles.order}>{summary.lines.map((line, index) => <li key={`${line.dishId}-${index}`}><div><strong>{line.quantity} × {line.name}</strong><strong>{money(line.lineTotalCents)}</strong></div>{!!line.options.length && <p>{line.options.map(option => option.name).join(" · ")}</p>}</li>)}</ul><div className={styles.total}><strong>Total</strong><strong>{money(summary.totalCents)}</strong></div>{ticket && <p>Received by the kitchen · Pay at the stall</p>}</div>}
    {quote && !ticket && onManualConfirm && !spokenDispatched.current && <button type="button" className="btn btn-primary" disabled={manualBusy || confirmingManually} onClick={() => { void confirmManually(); }}>{manualBusy || confirmingManually ? "Checking order…" : "Confirm order"}</button>}
    {!running && !ticket && spokenDispatched.current && <p>Spoken confirmation may already have been sent. Check Cook mode before placing another order.</p>}
    <audio ref={audio} autoPlay />
  </section>;
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
      <section className={`card ${styles.panel}`} aria-labelledby="voice-summary" aria-live="polite"><p className="eyebrow">{ticket ? "Sent to the kitchen" : summary ? "Your order draft" : "Your voice order"}</p><h2 id="voice-summary">Your order</h2>
        {summary ? <><p>{summary.fulfillmentType === "dine_in" ? "Dine-in" : summary.fulfillmentType === "takeaway" ? "Takeaway" : "Dining choice not recorded"}</p><ul className={styles.order}>{summary.lines.map((line, index) => <li key={`${line.dishId}-${index}`}><div><strong>{line.quantity} × {line.name}</strong><strong>{money(line.lineTotalCents)}</strong></div>{line.options.length > 0 && <p>{line.options.map(option => `${option.name}${option.priceDeltaCents ? ` (${money(option.priceDeltaCents)} per dish)` : ""}`).join(" · ")}</p>}</li>)}</ul><div className={styles.total}><strong>Total</strong><strong>{money(summary.totalCents)}</strong></div><p>{ticket ? "Order received · Unpaid — pay at the stall." : "Not placed yet · Payment due at the stall."}</p>{ticket && <><p className={styles.ticket}>Ticket {ticket.id}</p><Link className="btn btn-teal" href={`/kitchen?restaurantId=${DEMO_RESTAURANT_ID}`}>View in Cook Mode →</Link></>}</> : <p className={styles.empty}>Your dishes, extras and total will appear here after GPT Live checks your order.</p>}
      </section>
    </div>
    <details className={styles.monitor}><summary>Conversation transcript</summary><p>{text || "No speech yet."}</p></details><audio ref={audio} autoPlay />
  </main>;
}
