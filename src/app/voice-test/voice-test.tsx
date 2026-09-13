"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ApiError, createApiClient } from "@/shared/api-client";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";
import { connectLiveAudio } from "@/shared/live-client";
import type { Menu, Quote, Ticket } from "@/shared/contracts";

type Connection = Awaited<ReturnType<typeof connectLiveAudio>>;
type Review = { quote: Quote; confirmationNonce: string; revision: number };
const api = createApiClient();
const money = (cents: number) => `S$${(cents / 100).toFixed(2)}`;
const button = "rounded-full border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40";
async function accessToken() {
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Sign in again to use the voice test.");
  // Forward only; the server independently verifies this staff identity.
  return data.session.access_token;
}
function message(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Microphone access was denied. Allow microphone access for this page, then try Start again.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "No microphone was found. Connect a microphone and try again.";
  return error instanceof Error ? error.message : "The voice test could not complete this step.";
}

export function VoiceTest() {
  const audio = useRef<HTMLAudioElement>(null);
  const connection = useRef<Connection | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const uncertainRef = useRef(false);
  const [state, setState] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [hasConnection, setHasConnection] = useState(false);
  const [paused, setPaused] = useState(false);
  const [fulfillmentType, setFulfillmentType] = useState<"dine_in" | "takeaway" | "">("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  useEffect(() => {
    mounted.current = true;
    void api.readMenu(DEMO_RESTAURANT_ID).then(value => { if (mounted.current) setMenu(value); }).catch(() => { if (mounted.current) setError("The published demo menu could not be loaded. Check the backend before starting."); });
    return () => {
      mounted.current = false;
      abort.current?.abort();
      void connection.current?.close().catch(() => {});
    };
  }, []);

  function lock(value: boolean) { busyRef.current = value; if (mounted.current) setBusy(value); }
  async function start() {
    if (busyRef.current || connection.current || !audio.current) return;
    lock(true);
    generation.current++;
    const control = new AbortController(); abort.current = control;
    setError(""); setReview(null); setTicket(null); setText(""); setUncertain(false); uncertainRef.current = false;
    setPlaybackBlocked(false); setState("Connecting to GPT-Live…");
    try {
      const token = await accessToken();
      if (control.signal.aborted || !mounted.current) return;
      const connected = await connectLiveAudio(audio.current, (sdp, signal) => api.startLive(sdp, DEMO_RESTAURANT_ID, token, signal), {
        signal: control.signal,
        onState: value => { if (mounted.current) { setState(value === "listening" ? "GPT-Live is listening" : value === "closed" ? "Audio ended" : value === "error" ? "Connection needs attention" : "Connecting to GPT-Live…"); if (value === "closed") setHasSession(false); } },
        onTranscript: value => {
          if (!mounted.current) return;
          setText(value);
          // Corrections arriving after Prepare invalidate that screen's review.
          if (!uncertainRef.current) { generation.current++; setReview(null); }
        },
        onPlaybackBlocked: () => { if (mounted.current) setPlaybackBlocked(true); },
        endSession: async answer => {
          if (answer.voiceSessionId) await api.closeVoiceSession(answer.voiceSessionId, await accessToken());
        },
      });
      // Transcript events can update generation while connecting; only cancellation matters here.
      if (control.signal.aborted || !mounted.current) { await connected.close(); return; }
      connection.current = connected;
      setHasConnection(true);
      setHasSession(true); setPaused(false);
    } catch (caught) { if (mounted.current && !control.signal.aborted) setError(message(caught)); }
    finally { lock(false); }
  }
  async function end() {
    generation.current++;
    abort.current?.abort();
    const current = connection.current;
    setHasSession(false); setPaused(true);
    if (!uncertainRef.current) setReview(null);
    try {
      await current?.close();
      if (connection.current === current && !uncertainRef.current) { connection.current = null; setHasConnection(false); }
    }
    catch (caught) { if (mounted.current) setError(message(caught)); }
  }
  function resume() {
    if (busyRef.current || uncertainRef.current || !connection.current) return;
    generation.current++; setReview(null); setError("");
    connection.current.setMicrophoneEnabled(true); setPaused(false); setState("GPT-Live is listening");
  }
  async function prepare() {
    const current = connection.current;
    if (busyRef.current || uncertainRef.current || !current?.voiceSessionId || !fulfillmentType) return;
    current.setMicrophoneEnabled(false); setPaused(true); setReview(null); setError("");
    const snapshot = current.transcript();
    if (!snapshot.trim()) { setError("Say your order first, then prepare a review."); return; }
    const run = ++generation.current;
    lock(true); setState("Checking your spoken order…");
    try {
      const result = await api.prepareVoiceReview(current.voiceSessionId, snapshot, fulfillmentType, await accessToken());
      if (!mounted.current || run !== generation.current) { if (mounted.current) setError("More speech arrived while checking. Prepare the updated transcript again."); return; }
      if (result.review) { setReview(result.review); setState("Review before placing your order"); }
      else { setError(result.intent.issues.map(issue => issue.message).join(" ") || "Say a complete order with quantities."); setState("Please clarify your order"); }
    } catch (caught) { if (mounted.current && run === generation.current) setError(message(caught)); }
    finally { lock(false); }
  }
  async function confirm() {
    const current = connection.current;
    if (busyRef.current || !current?.voiceSessionId || !review) return;
    lock(true); setError(""); setState("Sending your unpaid order…");
    // Retain this exact nonce until a receipt resolves an uncertain submission.
    uncertainRef.current = true; setUncertain(true);
    try {
      const result = await api.confirmVoiceOrder(current.voiceSessionId, review.confirmationNonce, await accessToken());
      if (mounted.current) { setTicket(result); setReview(null); setUncertain(false); uncertainRef.current = false; setState("Order received by the kitchen"); }
    } catch (caught) {
      if (mounted.current) {
        setError(message(caught)); setState("Order receipt not confirmed");
        if (caught instanceof ApiError && ["STALE_REVIEW", "STALE_MENU", "SESSION_EXPIRED"].includes(caught.code)) {
          setReview(null); setUncertain(false); uncertainRef.current = false;
        }
      }
    } finally { lock(false); }
  }

  return <main className="min-h-screen bg-[var(--cream)] px-5 py-8 text-[var(--ink)]">
    <div className="mx-auto max-w-5xl">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
        <div><p className="text-xs font-bold uppercase tracking-widest text-[var(--red)]">Jiak Simi · Local voice test</p><h1 className="mt-2 text-3xl font-black">Order with the GPT-Live Butler</h1></div>
        <Link href="/" className="text-sm font-bold underline">Back to portal</Link>
      </header>
      <p className="mb-6 max-w-3xl text-sm text-[var(--muted)]">Uses GPT-Live <strong>gpt-live-1</strong> with your laptop microphone and speakers. Say your order, review the price, then explicitly place it. This demo creates real unpaid tickets in the hackathon database.</p>
      <div className="grid gap-6 md:grid-cols-[1.3fr_1fr]">
        <section className="rounded-3xl border border-[var(--line)] bg-white/80 p-6">
          <p role="status" aria-live="polite" className="mb-5 font-bold text-[var(--green)]">{state}</p>
          <div className="flex flex-wrap gap-3">
            <button className={`${button} !bg-[var(--red)] text-white`} disabled={busy || hasSession || uncertain || !menu || hasConnection} onClick={() => void start()}>Start GPT-Live</button>
            <button className={button} disabled={!hasSession || busy || uncertain} onClick={() => { if (paused) resume(); else { connection.current?.setMicrophoneEnabled(false); setPaused(true); setState("Microphone paused"); } }}>{paused ? "Resume microphone" : "Pause microphone"}</button>
            <button className={button} disabled={!hasSession && !busy && !hasConnection} onClick={() => void end()}>End audio</button>
          </div>
          <audio ref={audio} controls className="mt-5 w-full" aria-label="GPT-Live audio" />
          {playbackBlocked && <p className="mt-2 text-sm">Press play on the audio controls to hear the Butler.</p>}
          <h2 className="mb-2 mt-7 text-lg font-bold">Your spoken order</h2>
          <div className="min-h-32 whitespace-pre-wrap rounded-2xl bg-[var(--cream)] p-4 text-sm" aria-live="polite">{text || "Your words will appear here after you start speaking."}</div>
          <p className="mt-2 text-xs text-[var(--muted)]">Check the transcript: speech recognition can make mistakes. Resume to clarify, then prepare a new review.</p>
          <fieldset className="mt-5" disabled={busy || uncertain}>
            <legend className="text-sm font-bold">Dine in or takeaway? <span className="font-normal">Required</span></legend>
            <div className="mt-2 flex gap-5">{(["dine_in", "takeaway"] as const).map(mode => <label key={mode} className="flex items-center gap-2 text-sm"><input type="radio" name="fulfillment" value={mode} checked={fulfillmentType === mode} onChange={() => { generation.current++; setReview(null); setFulfillmentType(mode); }} />{mode === "dine_in" ? "Dine in" : "Takeaway"}</label>)}</div>
          </fieldset>
          <button className={`${button} mt-5`} disabled={!hasSession || busy || uncertain || !text.trim() || !fulfillmentType} onClick={() => void prepare()}>Review order</button>
          {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
        </section>
        <aside className="space-y-6">
          <section className="rounded-3xl border border-[var(--line)] bg-white/80 p-6"><h2 className="text-lg font-bold">{menu?.name || "Loading published menu…"}</h2>
            <ul className="mt-4 space-y-3 text-sm">{menu?.dishes.filter(dish => dish.available).map(dish => <li key={dish.id} className="flex justify-between gap-3"><span>{dish.name}</span><strong>{money(dish.priceCents)}</strong></li>)}</ul>
            <p className="mt-4 text-xs text-[var(--muted)]">Try: “One char siew rice, please.” The server checks the current menu again before placement.</p>
          </section>
          {review && <section className="rounded-3xl border-2 border-[var(--green)] bg-white p-6"><h2 className="text-lg font-bold">Check your order</h2><p className="mt-2 text-sm font-bold">{review.quote.fulfillmentType === "dine_in" ? "Dine in" : "Takeaway"}</p><ul className="mt-4 space-y-3 text-sm">{review.quote.lines.map((line, index) => <li key={index}><div className="flex justify-between gap-3"><span>{line.quantity} × {line.name}</span><strong>{money(line.lineTotalCents)}</strong></div>{line.options.length > 0 && <p className="text-xs text-[var(--muted)]">{line.options.map(option => option.name).join(", ")}</p>}</li>)}</ul><p className="my-5 flex justify-between border-t border-[var(--line)] pt-4 text-lg font-black"><span>Total</span><span>{money(review.quote.totalCents)}</span></p>
            <button className={`${button} w-full !bg-[var(--green)] text-white`} disabled={busy} onClick={() => void confirm()}>{uncertain ? "Retry same order confirmation" : "Place order"}</button><p className="mt-3 text-xs text-[var(--muted)]">{uncertain ? "Keep this confirmation until its receipt is recovered. Do not start another order." : "This sends the reviewed order to the kitchen. Payment remains unpaid."}</p></section>}
          {ticket && <section className="rounded-3xl bg-[var(--green)] p-6 text-white"><h2 className="text-lg font-bold">Kitchen receipt</h2><p className="mt-3 text-sm">{money(ticket.cart.totalCents)} · Unpaid · Voice · {ticket.cart.fulfillmentType === "dine_in" ? "Dine in" : ticket.cart.fulfillmentType === "takeaway" ? "Takeaway" : "Not specified"}</p><p className="mt-2 break-all text-xs">Order {ticket.id}</p><p className="mt-3 text-sm">Your order is received. You can end the audio now.</p></section>}
        </aside>
      </div>
    </div>
  </main>;
}
