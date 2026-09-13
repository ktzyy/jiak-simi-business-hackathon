import assert from "node:assert/strict";
import test from "node:test";
import { connectLiveAudio, liveTranscriptBuffer } from "../src/shared/live-client";

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
