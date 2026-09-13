import assert from "node:assert/strict";
import test from "node:test";
import { connectLiveAudio, liveTranscriptBuffer, playVoiceReadback, recordVoiceConfirmation, voiceCaptureBoundary } from "../src/shared/live-client";

test("voice fragments retain corrections, ignore assistant speech and deduplicate delivery", () => {
  const buffer = liveTranscriptBuffer(60);
  const event = { type: "session.input_transcript.delta", event_id: "first", delta: "Two soups" };
  assert.equal(buffer.append(event), "Two soups");
  assert.equal(buffer.append(event), null);
  assert.equal(buffer.append({ ...event, event_id: "assistant", type: "session.output_transcript.delta", delta: "confirmed" }), null);
  assert.equal(buffer.append({ ...event, event_id: "second", delta: ", actually one soup." }), "Two soups, actually one soup.");
  assert.throws(() => buffer.append({ ...event, event_id: "third", delta: "x".repeat(60) }), /full/);
  assert.equal(buffer.text(), "Two soups, actually one soup.");
});

test("finite readback resolves only at playback end; interrupted playback rejects", async () => {
  let ended: (() => void) | null = null, stops = 0;
  const context = { state: "running", destination: {}, decodeAudioData: async () => ({ duration: 2 }), createBufferSource: () => ({ buffer: null, connect() {}, disconnect() {}, start() {}, stop() { stops++; }, set onended(value: (() => void) | null) { ended = value; } }) } as unknown as AudioContext;
  const abort = new AbortController();
  let completed = false;
  const pending = playVoiceReadback(context, new Uint8Array([1]), abort.signal).then(() => { completed = true; });
  await Promise.resolve(); assert.equal(completed, false);
  abort.abort(); await assert.rejects(pending, /interrupted/); assert.equal(completed, false); assert.equal(stops, 1);
  const normal = playVoiceReadback(context, new Uint8Array([1]), new AbortController().signal);
  await Promise.resolve(); (ended as unknown as () => void)(); await normal;
});

test("confirmation framing ends after speech and quiet, retains mid-answer pauses and ignores initial cue", () => {
  const rate = 16000, quiet = new Float32Array(rate / 10), speech = new Float32Array(rate / 10).fill(0.1);
  const frame = voiceCaptureBoundary(rate);
  for (let i = 0; i < 4; i++) assert.equal(frame.push(speech), false); // Cue alone must not arm speech detection.
  for (let i = 0; i < 12; i++) assert.equal(frame.push(quiet), false);
  for (let i = 0; i < 4; i++) assert.equal(frame.push(speech), false);
  for (let i = 0; i < 6; i++) assert.equal(frame.push(quiet), false); // A short pause is retained.
  for (let i = 0; i < 4; i++) assert.equal(frame.push(speech), false);
  for (let i = 0; i < 9; i++) assert.equal(frame.push(quiet), false);
  assert.equal(frame.push(quiet), true);
  const silent = voiceCaptureBoundary(rate);
  for (let i = 0; i < 79; i++) assert.equal(silent.push(quiet), false);
  assert.equal(silent.push(quiet), true); // Maximum duration, server will reject silence.
});

test("separate confirmation microphone arriving after Stop is cleaned and never recorded", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => { if (previous) Object.defineProperty(globalThis, "navigator", previous); else Reflect.deleteProperty(globalThis, "navigator"); });
  let release!: (stream: MediaStream) => void, stops = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { release = resolve; }) } } });
  const abort = new AbortController(), pending = recordVoiceConfirmation({} as AudioContext, abort.signal); abort.abort();
  release({ getTracks: () => [{ stop() { stops++; } }] } as unknown as MediaStream);
  await assert.rejects(pending, /stopped/); assert.equal(stops, 1);
});

test("End during microphone permission cleans tracks that arrive after cancellation", async (t) => {
  const previousPc = Object.getOwnPropertyDescriptor(globalThis, "RTCPeerConnection");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => {
    if (previousPc) Object.defineProperty(globalThis, "RTCPeerConnection", previousPc); else Reflect.deleteProperty(globalThis, "RTCPeerConnection");
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator); else Reflect.deleteProperty(globalThis, "navigator");
  });
  let resolveMic!: (stream: MediaStream) => void;
  let stopped = 0, providerCalls = 0, peerClosed = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { resolveMic = resolve; }) } } });
  Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, value: class {
    createDataChannel() { return { readyState: "connecting", close() {} }; }
    close() { peerClosed++; }
  } });
  const controller = new AbortController();
  const audio = { pause() {}, srcObject: null } as unknown as HTMLAudioElement;
  const pending = connectLiveAudio(audio, async () => { providerCalls++; throw new Error("Must not run"); }, { signal: controller.signal });
  controller.abort();
  resolveMic({ getTracks: () => [{ stop: () => stopped++ }] } as unknown as MediaStream);
  await assert.rejects(pending, /cancelled/);
  assert.equal(providerCalls, 0);
  assert.equal(stopped, 1);
  assert.equal(peerClosed, 1);
});
