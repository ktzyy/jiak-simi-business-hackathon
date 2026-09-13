import "server-only";
import { randomUUID, createHash } from "node:crypto";
import WebSocket from "ws";
import type { Quote, Ticket } from "../../shared/contracts";
import { HttpError } from "../http";
import { explicitVoiceConfirmation, quoteReadback, validateConfirmationWav } from "./live-confirmation-audio";

export type VoiceReview = { quote: Quote; confirmationNonce: string; revision: number };
type Phase = "collecting" | "preparing" | "readback" | "playing" | "confirming" | "transcribing" | "submitted" | "closed" | "error";
export interface ButlerHooks {
  prepare(text: string): Promise<VoiceReview | null>;
  invalidate(): Promise<void>;
  speech(text: string): Promise<Buffer>;
  transcribe(wav: Buffer): Promise<string>;
  submit(nonce: string): Promise<Ticket>;
  send(event: Record<string, unknown>): void;
  close(): Promise<void>;
  now?: () => number;
}

/** One server owner per supervised local device. Lost process state fails closed;
 * only the database owns the pending cart, nonce and idempotent order receipt. */
export class LiveButler {
  private phase: Phase = "collecting";
  private text = "";
  private seen = new Set<string>();
  private generation = 0;
  private review?: VoiceReview;
  private audio?: Buffer;
  private readbackId?: string;
  private playedAt = 0;
  private deliveredAt = 0;
  private ticket?: Ticket;
  private confirmation?: { hash: string; result: Promise<void> };
  private attempts = 0;
  private mute?: { id: string; resolve: () => void; reject: () => void };
  private now: () => number;
  constructor(readonly actor: string, readonly sessionId: string, private hooks: ButlerHooks) { this.now = hooks.now ?? Date.now; }

  status() {
    const showQuote = ["readback", "playing", "confirming", "transcribing"].includes(this.phase);
    return { phase: this.phase, readbackId: this.readbackId, ticket: this.ticket, ...(showQuote && this.review ? { quote: this.review.quote } : {}) };
  }
  private send(type: string, content: string, delegationId: string | null = null) {
    this.hooks.send({ type, event_id: randomUUID(), delegation_id: delegationId, content });
  }
  async receive(event: Record<string, unknown>): Promise<void> {
    if (this.phase === "closed" || this.phase === "error") return;
    if (event.type === "session.input_audio.muted" && event.client_event_id === this.mute?.id) { this.mute?.resolve(); return; }
    if (event.type === "error" || event.type === "session.closed") { await this.stop(event.type === "error"); return; }
    if (typeof event.event_id !== "string" || this.seen.has(event.event_id)) return;
    this.seen.add(event.event_id);
    if (this.seen.size > 4000) { await this.stop(true); return; }
    if (event.type === "session.input_transcript.delta" && typeof event.delta === "string") {
      if (this.phase !== "collecting" && this.phase !== "preparing") return;
      this.text += event.delta; this.generation++;
      if (this.text.length > 4000) await this.stop(true);
    }
    if (event.type === "session.delegation.created" && this.phase === "collecting") {
      const delegation = event.delegation as { target?: string; id?: string } | undefined;
      if (delegation?.target === "client" && typeof delegation.id === "string" && this.text.trim()) await this.prepare(delegation.id);
    }
  }
  private async muteInput() {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.mute = undefined; reject(new Error("Microphone control failed.")); }, 5000);
      const id = randomUUID();
      this.mute = { id, resolve: () => { clearTimeout(timer); this.mute = undefined; resolve(); }, reject: () => { clearTimeout(timer); this.mute = undefined; reject(new Error("Closed.")); } };
      try { this.hooks.send({ type: "session.input_audio.mute", event_id: id }); } catch { this.mute?.reject(); }
    });
  }
  private async resume(message: string) {
    this.review = undefined; this.audio = undefined; this.readbackId = undefined;
    await this.hooks.invalidate();
    if (this.phase === "closed" || this.phase === "error") return;
    this.phase = "collecting";
    this.send("session.instructions.append", message);
    this.hooks.send({ type: "session.input_audio.unmute", event_id: randomUUID() });
  }
  private async prepare(delegationId: string) {
    this.phase = "preparing";
    let generation = this.generation;
    try {
      if (++this.attempts > 5) throw new Error("Session preparation limit.");
      await this.muteInput();
      if (this.phase !== "preparing") return;
      // Include fragments received before mute acknowledgment in the reversible
      // draft. Subsequent changes invalidate it; this never establishes consent.
      generation = this.generation;
      const review = await this.hooks.prepare(this.text);
      if (this.phase !== "preparing") return;
      if (!review || generation !== this.generation) { await this.resume("The order needs clarification. Ask for the full final order, including dine-in or takeaway and required options, then delegate again. Nothing was placed."); return; }
      const text = quoteReadback(review.quote);
      const audio = await this.hooks.speech(text);
      if (this.phase !== "preparing" || generation !== this.generation) { if (this.phase === "preparing") await this.resume("Please repeat the final order; it changed during checking."); return; }
      this.review = review; this.audio = audio; this.readbackId = randomUUID(); this.phase = "readback";
      // Model receives authoritative facts but stays quiet while finite TTS plays.
      this.send("session.thinking.append", `Authoritative quote: ${text.slice(0, 1600)} Application handles readback and confirmation; remain silent. No order has been placed.`, delegationId);
    } catch { await this.stop(true); }
  }
  takeAudio(id: string) {
    if (this.phase !== "readback" || id !== this.readbackId || !this.audio) throw new HttpError(409, "STALE_VOICE_REVIEW", "Start a fresh voice order.");
    this.phase = "playing"; this.deliveredAt = this.now();
    return this.audio;
  }
  playbackEnded(id: string) {
    // Acknowledgment is trusted only from the authenticated staff-owned local device.
    if (this.phase !== "playing" || id !== this.readbackId || this.now() - this.deliveredAt < 1000) throw new HttpError(409, "VOICE_PLAYBACK_REQUIRED", "Complete the readback before answering.");
    this.phase = "confirming"; this.playedAt = this.now();
  }
  async confirm(id: string, wav: Buffer) {
    const hash = createHash("sha256").update(wav).digest("hex");
    if (id === this.readbackId && this.confirmation?.hash === hash) return this.confirmation.result;
    if (this.phase !== "confirming" || id !== this.readbackId || !this.review || this.now() - this.playedAt > 25_000) throw new HttpError(409, "STALE_VOICE_CONFIRMATION", "A fresh recorded answer is required.");
    const duration = validateConfirmationWav(wav);
    if (this.now() - this.playedAt < duration * 1000 - 250) throw new HttpError(409, "STALE_VOICE_CONFIRMATION", "Record a fresh answer after the readback.");
    this.phase = "transcribing";
    const review = this.review;
    const result = (async () => {
      try {
        const text = await this.hooks.transcribe(wav);
        if (this.phase !== "transcribing" || this.review !== review) return;
        if (!explicitVoiceConfirmation(text)) {
          // Do not turn corrections from the recording into unreviewed cart mutations.
          await this.resume("The separate confirmation was not an exact approval. Nothing was placed. Ask the customer to state their full corrected order or say cancel. Do not repeat an upsell."); return;
        }
        const ticket = await this.hooks.submit(review.confirmationNonce);
        this.ticket = ticket; this.phase = "submitted";
        this.send("session.commentary.append", `The order was saved successfully. Ticket ${ticket.id}. Payment remains unpaid. Tell the customer their order has reached the kitchen and payment is due at the stall.`);
      } catch { await this.stop(true); }
    })();
    this.confirmation = { hash, result };
    await result;
  }
  async stop(error = false) {
    if (this.phase === "closed" || this.phase === "error") return;
    this.phase = error ? "error" : "closed"; this.generation++; this.mute?.reject(); this.audio = undefined;
    await this.hooks.close().catch(() => undefined);
  }
}

export async function attachButler(providerId: string, apiKey: string, make: (send: ButlerHooks["send"]) => LiveButler): Promise<LiveButler> {
  const socket = new WebSocket(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(providerId)}/attach`, { headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 8000, maxPayload: 1_000_000 });
  const butler = make(event => { if (socket.readyState !== WebSocket.OPEN) throw new Error("Voice connection closed."); socket.send(JSON.stringify(event)); });
  socket.on("message", data => {
    try { void butler.receive(JSON.parse(String(data))).catch(() => butler.stop(true)); } catch { void butler.stop(true); }
  });
  socket.on("error", () => { void butler.stop(true); });
  socket.on("close", () => { void butler.stop(true); });
  try {
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", () => reject(new Error("Sideband unavailable."))); socket.once("close", () => reject(new Error("Sideband closed."))); });
  } catch { socket.close(); throw new HttpError(502, "VOICE_CONTROL_FAILED", "The voice ordering connection could not start."); }
  const timer = setTimeout(() => { void butler.stop(); socket.close(); }, 10 * 60_000);
  timer.unref(); socket.once("close", () => clearTimeout(timer));
  return butler;
}
