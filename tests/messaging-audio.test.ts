import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadTelegramAudio, pcmFromWave, decodeTelegramAudio, type TelegramAudio } from "../src/server/messaging/audio";
import { audioAttemptPath, ensureNoAudioAttempt, reserveAudioAttempt, transcribeWithGptLive } from "../src/server/messaging/live-audio";
import { decodeTelegramUpdate } from "../src/server/messaging/telegram";

const audio: TelegramAudio = { fileId: "file_abc", sizeBytes: 4, durationSeconds: 2, mimeType: "audio/ogg" };
const wave = (rate = 24000, seconds = 0.1) => {
  const pcm = Buffer.alloc(rate * 2 * seconds), header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40); return Buffer.concat([header, pcm]);
};

test("audio downloader accepts only Telegram-returned canonical paths and bounded bytes", async () => {
  const urls: string[] = [];
  const bytes = await downloadTelegramAudio("12345:abc", audio, async (url, init) => {
    urls.push(String(url)); assert.equal(init?.redirect, "error");
    return urls.length === 1 ? Response.json({ ok: true, result: { file_id: audio.fileId, file_size: 4, file_path: "voice/file_1.oga" } }) : new Response("OggS");
  });
  assert.equal(bytes.toString(), "OggS");
  assert.match(urls[1], /^https:\/\/api.telegram.org\/file\/bot12345:abc\/voice\/file_1.oga$/);
  for (const file_path of ["../secret", "https://evil.test/audio.oga", "voice/../../secret.oga", "voice/%2e%2e.oga", "voice/file.oga?token=bad"]) {
    let requests = 0;
    await assert.rejects(downloadTelegramAudio("12345:abc", audio, async () => { requests++; return Response.json({ ok: true, result: { file_id: audio.fileId, file_size: 4, file_path } }); }));
    assert.equal(requests, 1);
  }
});

test("voice and audio files retain provider file IDs but never caller URLs or cross-chat identities", () => {
  const event = { update_id: 1, message: { from: { id: 67890, is_bot: false }, chat: { id: 67890, type: "private" }, voice: { file_id: "file_abc", file_size: 4, duration: 2, mime_type: "audio/ogg" } } };
  assert.equal(decodeTelegramUpdate(event, new Set(["67890"]))?.kind, "audio");
  assert.equal(decodeTelegramUpdate(event, new Set(["999"])), null);
  assert.equal(decodeTelegramUpdate({ ...event, message: { ...event.message, voice: { ...event.message.voice, duration: 100 } } }, new Set(["67890"]))?.kind, "unsupported");
});

test("PCM parsing rejects unsupported format, truncated content and excessive decoded duration", () => {
  assert.equal(pcmFromWave(wave()).length, 4800);
  assert.throws(() => pcmFromWave(wave(8000)));
  assert.throws(() => pcmFromWave(wave().subarray(0, 45)));
  assert.throws(() => pcmFromWave(wave(24000, 21)));
});

test("laptop decoder resamples a synthetic WAV without a provider call", { skip: process.platform !== "darwin" }, async () => {
  const pcm = await decodeTelegramAudio(wave(8000), "audio/wav");
  assert.ok(pcm.length > 0 && pcm.length <= 4800 + 100);
});

test("durable audio marker survives restart and concurrent attempts permit only one dispatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jiak-audio-marker-test-"));
  try {
    const path = audioAttemptPath("s".repeat(32), "recipient-private/update-1", directory);
    assert.equal(path.includes("recipient-private"), false);
    await ensureNoAudioAttempt(path);
    const results = await Promise.allSettled([reserveAudioAttempt(path), reserveAudioAttempt(path)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    await assert.rejects(ensureNoAudioAttempt(path));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

class FakeLiveSocket extends EventEmitter {
  sent: Record<string, unknown>[] = [];
  closed = false;
  send(raw: string) {
    const event = JSON.parse(raw); this.sent.push(event);
    if (event.type === "session.start") queueMicrotask(() => this.emit("message", JSON.stringify({ type: "session.started", session: { model: "gpt-live-1" } })));
    if (event.type === "session.input_audio.append" && !this.sent.some(item => item.marker)) {
      this.sent.push({ marker: true });
      this.emit("message", JSON.stringify({ type: "session.output_transcript.delta", event_id: "assistant", delta: "Order placed and paid" }));
      for (let n = 0; n < 2; n++) this.emit("message", JSON.stringify({ type: "session.input_transcript.delta", event_id: "user", delta: "Two noodles takeaway" }));
    }
    if (event.type === "session.close") queueMicrotask(() => this.emit("message", JSON.stringify({ type: "session.closed" })));
  }
  close() { this.closed = true; }
}

test("exact GPT Live audio events produce only user transcript and close after upload", async () => {
  const socket = new FakeLiveSocket();
  const text = await transcribeWithGptLive(Buffer.alloc(4800), "fake-key", { connect: (url, key) => {
    assert.equal(url, "wss://api.openai.com/v1/live/sessions"); assert.equal(key, "fake-key");
    queueMicrotask(() => socket.emit("open")); return socket;
  }, pause: async () => {} });
  assert.equal(text, "Two noodles takeaway");
  assert.equal((socket.sent[0].session as { model: string }).model, "gpt-live-1");
  assert.ok(socket.sent.some(event => event.type === "session.input_audio.append"));
  assert.equal(socket.sent.some(event => String(event.type).includes("input_audio_buffer")), false);
  assert.ok(socket.closed);
});

test("provider closure before confirmed session close never returns a partial transcript", async () => {
  const socket = new FakeLiveSocket();
  await assert.rejects(transcribeWithGptLive(Buffer.alloc(4800), "fake-key", { connect: () => { queueMicrotask(() => socket.emit("close")); return socket; }, deadlineMs: 100 }));
});
