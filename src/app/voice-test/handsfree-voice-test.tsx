"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";
import { connectLiveAudio, playVoiceReadback, recordVoiceConfirmation, type LiveSessionAnswer } from "@/shared/live-client";
import type { Ticket } from "@/shared/contracts";
import { PUBLIC_DEMO_BEARER } from "@/shared/public-demo";

type Connection = Awaited<ReturnType<typeof connectLiveAudio>>;
type Status = { phase: string; readbackId?: string; ticket?: Ticket };
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
  const [state, setState] = useState("Ready"), [running, setRunning] = useState(false), [text, setText] = useState(""), [error, setError] = useState(""), [ticket, setTicket] = useState<Ticket | null>(null);
  async function stop() {
    controller.current?.abort(); controller.current = null;
    const current = connection.current; connection.current = null;
    if (audio.current) audio.current.muted = true;
    await current?.close().catch(() => { if (mounted.current) setError("Session close was not acknowledged. The local server will expire it."); });
    await context.current?.close().catch(() => undefined); context.current = null;
    if (mounted.current) { setRunning(false); setState("Stopped"); }
  }
  useEffect(() => { mounted.current = true; const end = () => { void stop(); }; window.addEventListener("pagehide", end); return () => { mounted.current = false; window.removeEventListener("pagehide", end); void stop(); }; }, []);
  async function start() {
    if (controller.current || !audio.current) return;
    const abort = new AbortController(); controller.current = abort;
    setRunning(true); setError(""); setTicket(null); setText(""); setState("Connecting GPT-Live");
    const ctx = new AudioContext(); context.current = ctx;
    try {
      await ctx.resume(); audio.current.muted = false;
      const live = await connectLiveAudio(audio.current, (sdp, signal) => command<LiveSessionAnswer>({ action: "start", restaurantId: DEMO_RESTAURANT_ID, sdp }, signal), {
        signal: abort.signal,
        onTranscript: value => { if (mounted.current) setText(value); },
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
  return <main className="mx-auto max-w-2xl space-y-6 p-8"><Link href="/">← Portal</Link><h1 className="text-3xl font-bold">GPT-Live hands-free ordering</h1><p>Staff-operated local test. Customers order and confirm by speaking. These voices are AI-generated.</p><p className="text-sm">Conversation: gpt-live-1. Exact quote readback: gpt-4o-mini-tts. Separate recorded confirmation: gpt-4o-transcribe. Say “Yes, place this order” after the readback, then wait quietly.</p><div className="flex gap-4"><button className="rounded border px-5 py-3 disabled:opacity-40" onClick={() => { void start(); }} disabled={running}>Start device</button><button className="rounded border px-5 py-3 disabled:opacity-40" onClick={() => { void stop(); }} disabled={!running}>Stop device</button></div><p role="status">{state}</p>{error && <p role="alert" className="text-red-700">{error}</p>}{ticket && <p>Ticket: {ticket.id}. Unpaid.</p>}<details><summary>Staff transcript monitor</summary><p className="whitespace-pre-wrap">{text || "No speech yet."}</p></details><audio ref={audio} autoPlay /></main>;
}
