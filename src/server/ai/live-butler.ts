import "server-only";
import { randomUUID, createHash } from "node:crypto";
import WebSocket from "ws";
import type { Quote, Ticket } from "../../shared/contracts";
import { HttpError } from "../http";
import { explicitVoiceConfirmation, quoteReadback, validateConfirmationWav } from "./live-confirmation-audio";
import { isVoiceMenuConversation } from "../../shared/live-conversation";
import { HAWKER_VOICE_STYLE } from "./live-voice-style";

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
  private mute?: { id: string; expected: string; resolve: () => void; reject: () => void };
  private now: () => number;
  private errorCode?: string;
  private errorStage?: string;
  private draftTimer?: ReturnType<typeof setTimeout>;
  constructor(readonly actor: string, readonly sessionId: string, private hooks: ButlerHooks) { this.now = hooks.now ?? Date.now; }

  status() {
    const showQuote = ["preparing", "readback", "playing", "confirming", "transcribing"].includes(this.phase);
    return { phase: this.phase, ...(this.errorCode ? { errorCode: this.errorCode, errorStage: this.errorStage } : {}), readbackId: this.readbackId, ticket: this.ticket, ...(showQuote && this.review ? { quote: this.review.quote } : {}) };
  }
  previewTranscript(text: string) {
    if (this.phase !== "collecting" || !text.trim() || text.length > 4000) return;
    this.text = text; this.generation++;
    void this.prepare(null);
  }
  private send(type: string, content: string, delegationId: string | null = null) {
    this.hooks.send({ type, event_id: randomUUID(), delegation_id: delegationId, content });
  }
  async receive(event: Record<string, unknown>): Promise<void> {
    if (this.phase === "closed" || this.phase === "error") return;
    if (this.mute && event.type === this.mute.expected && event.client_event_id === this.mute.id) { this.mute?.resolve(); return; }
    if (event.type === "error") { this.diagnose("provider", "VOICE_PROVIDER_COMMAND_FAILED"); await this.stop(true); return; }
    if (event.type === "session.closed") { await this.stop(); return; }
    if (typeof event.event_id !== "string" || this.seen.has(event.event_id)) return;
    this.seen.add(event.event_id);
    if (this.seen.size > 4000) { await this.stop(true); return; }
    if (event.type === "session.input_transcript.delta" && typeof event.delta === "string") {
      if (this.phase !== "collecting" && this.phase !== "preparing") return;
      this.text += event.delta; this.generation++;
      if (this.phase === "preparing") this.review = undefined;
      // Quiet transcript starts a reversible quote only, never order consent.
      if (this.draftTimer) clearTimeout(this.draftTimer);
      if (this.phase === "collecting") { this.draftTimer = setTimeout(() => { if (this.phase === "collecting" && this.text.trim()) void this.prepare(null); }, 1200); this.draftTimer.unref?.(); }
      if (this.text.length > 4000) await this.stop(true);
    }
    if (event.type === "session.delegation.created" && this.phase === "collecting") {
      const delegation = event.delegation as { target?: string; id?: string } | undefined;
      if (delegation?.target === "client" && typeof delegation.id === "string" && this.text.trim()) await this.prepare(delegation.id);
    }
  }
  private diagnose(stage: string, code: string) {
    this.errorStage = stage; this.errorCode = code;
    // Never log provider error messages, transcript, IDs, headers or credentials.
    console.warn("voice_butler", JSON.stringify({ phase: this.phase, stage, errorCode: code }));
  }
  private async inputControl(muted: boolean) {
    await new Promise<void>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        if (this.mute?.id !== id) return;
        this.mute = undefined;
        reject(new HttpError(504, "VOICE_CONTROL_TIMEOUT", "The microphone control was not acknowledged."));
      }, 5000);
      this.mute = { id, expected: muted ? "session.input_audio.muted" : "session.input_audio.unmuted",
        resolve: () => { clearTimeout(timer); this.mute = undefined; resolve(); },
        reject: () => { clearTimeout(timer); this.mute = undefined; reject(new Error("Closed.")); } };
      try { this.hooks.send({ type: muted ? "session.input_audio.mute" : "session.input_audio.unmute", event_id: id }); }
      catch (error) { clearTimeout(timer); this.mute = undefined; reject(error); }
    });
  }
  private async resume(message: string) {
    this.review = undefined; this.audio = undefined; this.readbackId = undefined;
    await this.hooks.invalidate();
    if (this.phase === "closed" || this.phase === "error") return;
    this.send("session.instructions.append", message);
    await this.inputControl(false);
    if (["closed", "error"].includes(this.phase)) return;
    this.phase = "collecting";
  }
  private async prepare(delegationId: string | null) {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    if (isVoiceMenuConversation(this.text)) {
      try {
        if (delegationId) this.send("session.thinking.append", "Answer this greeting or menu question briefly from the published menu. No order is being prepared. Keep listening for the customer's order.", delegationId);
      } catch { this.diagnose("provider", "VOICE_PROVIDER_COMMAND_FAILED"); await this.stop(true); }
      return;
    }
    this.phase = "preparing"; this.review = undefined;
    let generation = this.generation;
    let stage = "mute";
    this.errorCode = undefined; this.errorStage = undefined;
    try {
      if (++this.attempts > 5) throw new Error("Session preparation limit.");
      await this.inputControl(true);
      if (this.phase !== "preparing") return;
      // Include fragments received before mute acknowledgment in the reversible
      // draft. Subsequent changes invalidate it; this never establishes consent.
      generation = this.generation;
      stage = "prepare";
      const review = await this.hooks.prepare(this.text);
      if (this.phase !== "preparing") return;
      if (!review || generation !== this.generation) { await this.resume("The order needs clarification. Ask one short question about the unclear dish, quantity or required choice. Keep the demo's dine-in and chilli defaults unless the customer changes them. Then collect the final order and delegate again. Nothing was placed."); return; }
      this.review = review;
      const text = quoteReadback(review.quote);
      stage = "speech";
      const audio = await this.hooks.speech(text);
      if (this.phase !== "preparing" || generation !== this.generation) { if (this.phase === "preparing") await this.resume("Please repeat the final order; it changed during checking."); return; }
      this.review = review; this.audio = audio; this.readbackId = randomUUID(); this.phase = "readback";
      // Model receives authoritative facts but stays quiet while finite TTS plays.
      this.send(delegationId ? "session.thinking.append" : "session.instructions.append", `Authoritative quote: ${text.slice(0, 1600)} Application handles readback and confirmation; remain silent. No order has been placed.`, delegationId);
    } catch (error) {

      this.diagnose(stage, error instanceof HttpError && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : `VOICE_${stage.toUpperCase()}_FAILED`);
      await this.stop(true);
    }
  }
  takeAudio(id: string) {
    if (this.phase !== "readback" || id !== this.readbackId || !this.audio) throw new HttpError(409, "STALE_VOICE_REVIEW", "Start a fresh voice order.");
    this.errorCode = undefined; this.errorStage = undefined;
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
      let stage = "transcribe";
      try {
        const text = await this.hooks.transcribe(wav);
        if (this.phase !== "transcribing" || this.review !== review) return;
        if (!explicitVoiceConfirmation(text)) {
          // Do not turn corrections from the recording into unreviewed cart mutations.
          await this.resume("The separate confirmation was not an exact approval. Nothing was placed. Ask the customer to state their full corrected order or say cancel. Do not repeat an upsell."); return;
        }
        stage = "submit";
        const ticket = await this.hooks.submit(review.confirmationNonce);
        this.ticket = ticket; this.phase = "submitted";
        this.send("session.commentary.append", `${HAWKER_VOICE_STYLE} The order was saved successfully. Ticket ${ticket.id}. Payment remains unpaid. Acknowledge once: Can, your order sent already. Pay at the stall later, thanks! Do not read the ticket ID or ask another question.`);
      } catch (error) {
        this.diagnose(stage, error instanceof HttpError && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : `VOICE_${stage.toUpperCase()}_FAILED`);
        // A known transcription failure happened before submission. Replay the
        // same authoritative quote and capture a fresh answer; never retry submit.
        if (stage === "transcribe" && error instanceof HttpError && [502, 504].includes(error.status) && this.phase === "transcribing" && this.review === review) {
          this.confirmation = undefined; this.readbackId = randomUUID(); this.phase = "readback";
        } else await this.stop(true);
      }
    })();
    this.confirmation = { hash, result };
    await result;
  }
  async stop(error = false) {
    if (this.phase === "closed" || this.phase === "error") return;
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.phase = error ? "error" : "closed"; this.generation++; this.mute?.reject(); this.audio = undefined;
    await this.hooks.close().catch(() => undefined);
  }
}

export async function attachButler(providerId: string, apiKey: string, make: (send: ButlerHooks["send"]) => LiveButler): Promise<LiveButler> {
  const socket = new WebSocket(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(providerId)}/attach`, { headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 8000, maxPayload: 1_000_000 });
  const butler = make(event => { if (socket.readyState !== WebSocket.OPEN) throw new Error("Voice connection closed."); socket.send(JSON.stringify(event)); });
  // Attachment automatically streams subsequent transcripts/delegations. The
  // Live sideband protocol has no subscription command and does not replay history.
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
