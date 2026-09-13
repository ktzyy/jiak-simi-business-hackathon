import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const MAX_AUDIO_BYTES = 5_000_000;
export const MAX_AUDIO_SECONDS = 20;
export const TelegramAudioSchema = z.strictObject({
  fileId: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
  mimeType: z.enum(["audio/ogg", "audio/opus", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav"]),
  durationSeconds: z.number().int().min(1).max(MAX_AUDIO_SECONDS).nullable(),
  sizeBytes: z.number().int().positive().max(MAX_AUDIO_BYTES),
});
export type TelegramAudio = z.infer<typeof TelegramAudioSchema>;
export class AudioOrderError extends Error {}
const fail = (): never => { throw new AudioOrderError("I couldn't read that audio. Send a voice note under 20 seconds, or type your order."); };

async function boundedResponse(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok || !response.body) return fail();
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) return fail();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length; if (bytes > limit) { await reader.cancel(); return fail(); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function downloadTelegramAudio(token: string, input: TelegramAudio, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const audio = TelegramAudioSchema.parse(input);
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) return fail();
  const signal = AbortSignal.timeout(12_000);
  try {
    const result = await fetcher(`https://api.telegram.org/bot${token}/getFile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: audio.fileId }), redirect: "error", signal });
    const metadata = z.object({ ok: z.literal(true), result: z.object({ file_id: z.literal(audio.fileId), file_size: z.number().int().positive().max(MAX_AUDIO_BYTES), file_path: z.string().max(256) }) }).parse(JSON.parse((await boundedResponse(result, 16_000)).toString("utf8")));
    const path = metadata.result.file_path;
    // Only a canonical Telegram-returned file path, never a caller URL. Reject
    // encoded separators, dot segments, query strings, absolute paths and redirects.
    if (!/^(?:voice|audio|documents)\/[A-Za-z0-9_-]+\.(?:oga|ogg|opus|mp3|m4a|wav)$/.test(path)) return fail();
    const response = await fetcher(`https://api.telegram.org/file/bot${token}/${path}`, { redirect: "error", signal });
    const bytes = await boundedResponse(response, MAX_AUDIO_BYTES);
    if (bytes.length !== metadata.result.file_size || bytes.length !== audio.sizeBytes) return fail();
    return bytes;
  } catch { return fail(); }
}

export function pcmFromWave(bytes: Buffer): Buffer {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") return fail();
  let validFormat = false, pcm: Buffer | null = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString("ascii", offset, offset + 4), size = bytes.readUInt32LE(offset + 4), end = offset + 8 + size;
    if (end > bytes.length) return fail();
    if (kind === "fmt ") {
      if (size < 16 || bytes.readUInt16LE(offset + 8) !== 1 || bytes.readUInt16LE(offset + 10) !== 1 || bytes.readUInt32LE(offset + 12) !== 24000 || bytes.readUInt16LE(offset + 22) !== 16) return fail();
      validFormat = true;
    }
    if (kind === "data") { if (pcm) return fail(); pcm = bytes.subarray(offset + 8, end); }
    offset = end + (size % 2);
  }
  if (!validFormat || !pcm?.length || pcm.length % 2 || pcm.length > 24000 * 2 * MAX_AUDIO_SECONDS) return fail();
  return Buffer.from(pcm);
}

/** Laptop adapter only; never shell-interpolate a filename or fetch remote media through a decoder. */
export async function decodeTelegramAudio(bytes: Buffer, mimeType: TelegramAudio["mimeType"]): Promise<Buffer> {
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) return fail();
  const ogg = bytes.toString("ascii", 0, 4) === "OggS";
  const wav = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
  const mp4 = bytes.toString("ascii", 4, 8) === "ftyp";
  const mp3 = bytes.toString("ascii", 0, 3) === "ID3" || (bytes.length > 1 && bytes[0] === 255 && (bytes[1] & 224) === 224);
  if (!(ogg || wav || mp4 || mp3)) return fail();
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") {
    try { return pcmFromWave(bytes); } catch { /* Resample a supported WAVE below. */ }
  }
  if (process.platform !== "darwin") throw new AudioOrderError("Audio ordering needs the laptop decoder. Please type your order for now.");
  const directory = await mkdtemp(join(tmpdir(), "jiak-audio-"));
  const input = join(directory, "input.audio"), output = join(directory, "decoded.wav");
  try {
    await writeFile(input, bytes, { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const process = spawn("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16@24000", "-c", "1", input, output], { stdio: "ignore", timeout: 10_000 });
      let exceeded = false;
      const monitor = setInterval(() => {
        void stat(output).then(info => { if (info.size > 24000 * 2 * (MAX_AUDIO_SECONDS + 1)) { exceeded = true; process.kill("SIGKILL"); } }).catch(() => {});
      }, 25);
      process.once("error", () => { clearInterval(monitor); reject(new AudioOrderError("Audio decoder is unavailable. Please type your order.")); });
      process.once("close", code => { clearInterval(monitor); if (code === 0 && !exceeded) resolve(); else reject(new AudioOrderError("That audio couldn't be decoded within the demo limits. Please type your order.")); });
    });
    const info = await stat(output);
    if (info.size > 24000 * 2 * (MAX_AUDIO_SECONDS + 1)) return fail();
    return pcmFromWave(await readFile(output));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
