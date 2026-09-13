import "server-only";
import { createHash } from "node:crypto";
import { QUOTE_VOICE, speakQuote } from "./live-confirmation-audio";

/** Audio only: callers must still authorize, obtain a fresh quote and debit the
 * voice budget before calling. Never cache reviews, nonces or consent. */
export function createQuoteSpeaker(speech = speakQuote, now = Date.now) {
  const cache = new Map<string, { audio: Buffer; expires: number }>();
  const ttl = 5 * 60_000, maxBytes = 8_000_000, maxEntries = 32;
  let bytes = 0;
  const remove = (key: string) => { bytes -= cache.get(key)?.audio.length ?? 0; cache.delete(key); };
  return async (text: string, apiKey: string): Promise<Buffer> => {
    // Hash credentials and exact text rather than retaining either as map keys.
    const key = createHash("sha256").update(JSON.stringify([apiKey, QUOTE_VOICE, text])).digest("hex");
    for (const [id, entry] of cache) if (entry.expires <= now()) remove(id);
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return Buffer.from(hit.audio); }
    const audio = await speech(text, apiKey);
    if (audio.length && audio.length <= maxBytes) {
      // Concurrent requests may have populated this entry while speech ran.
      remove(key);
      while (cache.size && (cache.size >= maxEntries || bytes + audio.length > maxBytes)) remove(cache.keys().next().value!);
      cache.set(key, { audio: Buffer.from(audio), expires: now() + ttl }); bytes += audio.length;
    }
    return audio;
  };
}

export const speakCachedQuote = createQuoteSpeaker();
