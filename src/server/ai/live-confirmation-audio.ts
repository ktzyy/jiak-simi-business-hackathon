import "server-only";
import type { Quote } from "../../shared/contracts";
import { HttpError, readBoundedBody } from "../http";

export function quoteReadback(quote: Quote): string {
  const lines = quote.lines.map(line => `${line.quantity} ${line.name}${line.options.length ? ` with ${line.options.map(option => option.name).join(", ")}` : ""}`).join("; ");
  const dollars = Math.floor(quote.totalCents / 100), cents = quote.totalCents % 100;
  const amount = `${dollars} dollar${dollars === 1 ? "" : "s"}${cents ? ` ${cents} cents` : ""}`;
  const text = `${lines}. ${quote.fulfillmentType === "dine_in" ? "Dine in" : "Takeaway"}. Total ${amount}. Pay at the stall. After the beep, say confirm.`;
  if (text.length > 3500) throw new HttpError(422, "VOICE_ORDER_TOO_LONG", "This order is too long for voice confirmation.");
  return text;
}

export function explicitVoiceConfirmation(text: string): boolean {
  // Whole completed recording only: never match an affirmative inside an edit or negation.
  const answer = text.toLowerCase().replace(/[.,!?]/g, "").replace(/\s+/g, " ").trim();
  return ["confirm", "yes", "yes confirm", "confirm order", "yes place order", "yes place this order", "can confirm", "confirm lah", "yes confirm lah"].includes(answer);
}

/** Canonical WAV from our staff device: 1.25–8 seconds, PCM16, quiet final second.
 * Server checks framing and speech energy independently of browser claims.
 * This is a supervised device protocol, not public speaker authentication. */
export function validateConfirmationWav(wav: Buffer): number {
  const bad = () => { throw new HttpError(400, "INVALID_CONFIRMATION_AUDIO", "Please repeat your full answer, then wait quietly."); };
  if (wav.length < 44 || wav.length > 1_000_000 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE" || wav.toString("ascii", 12, 16) !== "fmt " || wav.toString("ascii", 36, 40) !== "data") return bad();
  const rate = wav.readUInt32LE(24), size = wav.length - 44;
  if (wav.readUInt32LE(4) !== wav.length - 8 || wav.readUInt32LE(16) !== 16 || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16 || wav.readUInt16LE(32) !== 2 || wav.readUInt32LE(28) !== rate * 2 || wav.readUInt32LE(40) !== size || ![16000, 24000, 44100, 48000].includes(rate) || size % 2 || size / (rate * 2) < 1.25 || size / (rate * 2) > 8.2) return bad();
  let voiced = 0;
  for (let offset = 44; offset < wav.length; offset += rate / 50 * 2) {
    const start = Math.floor(offset / 2) * 2, end = Math.min(wav.length, start + Math.floor(rate / 50) * 2);
    let energy = 0;
    for (let i = start; i < end; i += 2) energy += (wav.readInt16LE(i) / 32768) ** 2;
    if (Math.sqrt(energy / ((end - start) / 2)) > 0.015) {
      if (start > wav.length - rate * 2) return bad();
      voiced++;
    }
  }
  if (voiced < 10) return bad();
  return size / (rate * 2);
}

export const QUOTE_VOICE = { model: "gpt-4o-mini-tts", voice: "coral", response_format: "wav", speed: 1.12,
  instructions: "Read the supplied order exactly, in natural everyday Singaporean English, with local rhythm and pronunciation. Sound like a friendly hawker taking an order: brisk, clear and matter-of-fact, with short pauses. Avoid a formal announcer delivery or exaggerated accent. Do not add Singlish particles or any other words, and do not omit items, options, amounts or the confirmation instruction." } as const;

export async function speakQuote(text: string, apiKey: string, fetcher = fetch): Promise<Buffer> {
  try {
    const response = await fetcher("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ ...QUOTE_VOICE, input: text }) });
    if (!response.ok) throw new Error();
    return Buffer.from(await readBoundedBody(new Request("http://audio.local", { method: "POST", body: response.body, duplex: "half" } as RequestInit), 4_000_000));
  } catch { throw new HttpError(502, "VOICE_READBACK_FAILED", "The order could not be read back. Nothing has been placed."); }
}

export async function transcribeConfirmation(wav: Buffer, apiKey: string, fetcher = fetch): Promise<string> {
  validateConfirmationWav(wav);
  const body = new FormData();
  body.set("model", "gpt-4o-transcribe"); body.set("response_format", "json"); body.set("language", "en");
  // Do not prompt with the desired phrase; that biases silence toward consent.
  body.set("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "confirmation.wav");
  try {
    const response = await fetcher("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body, signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (typeof result.text !== "string" || result.text.length > 1000) throw new Error();
    return result.text;
  } catch { throw new HttpError(502, "VOICE_CONFIRMATION_FAILED", "I couldn't verify that answer. Nothing has been placed."); }
}
