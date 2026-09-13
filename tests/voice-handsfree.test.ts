import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../src/server/http";
import { LiveButler, type ButlerHooks } from "../src/server/ai/live-butler";
import { explicitVoiceConfirmation, quoteReadback, validateConfirmationWav, speakQuote, transcribeConfirmation } from "../src/server/ai/live-confirmation-audio";
import { fixtureQuote, fixtureTicket } from "../src/shared/fixtures";

function wav(speechAtEnd = false) {
  const rate = 16000, audio = Buffer.alloc(44 + rate * 16);
  audio.write("RIFF"); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVE", 8); audio.write("fmt ", 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(rate, 24); audio.writeUInt32LE(rate * 2, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40);
  for (let i = rate; i < rate * 2; i++) audio.writeInt16LE(Math.round(Math.sin(i / 8) * 5000), 44 + i * 2);
  if (speechAtEnd) for (let i = rate * 7; i < rate * 8; i++) audio.writeInt16LE(5000, 44 + i * 2);
  return audio;
}
function setup(answer = "Yes, place this order.", overrides: Partial<ButlerHooks> = {}) {
  let clock = 0, submitted = 0, transcribed = 0, invalidated = 0;
  const commands: Record<string, unknown>[] = [];
  const nonce = "00000000-0000-4000-8000-000000000080";
  const butler = new LiveButler("actor", "session", {
    now: () => clock,
    prepare: async text => { assert.match(text, /rice/); return { quote: fixtureQuote, confirmationNonce: nonce, revision: 2 }; },
    invalidate: async () => { invalidated++; }, speech: async text => { assert.match(text, /Pay at the stall/); return Buffer.from("finite-audio"); },
    transcribe: async () => { transcribed++; return answer; },
    submit: async id => { assert.equal(id, nonce); submitted++; return { ...fixtureTicket, source: "voice" }; },
    close: async () => {},
    send: event => { commands.push(event); if (event.type === "session.input_audio.mute" || event.type === "session.input_audio.unmute") queueMicrotask(() => { void butler.receive({ type: event.type === "session.input_audio.mute" ? "session.input_audio.muted" : "session.input_audio.unmuted", client_event_id: event.event_id }); }); },
    ...overrides,
  });
  return { butler, commands, counts: () => ({ submitted, transcribed, invalidated }), tick: (ms: number) => { clock += ms; } };
}
async function ready(s: ReturnType<typeof setup>) {
  await s.butler.receive({ type: "session.input_transcript.delta", event_id: "input1", delta: "Two rice, takeaway. Yes." });
  assert.equal(s.counts().submitted, 0);
  await s.butler.receive({ type: "session.delegation.created", event_id: "d1", delegation: { id: "opaque", target: "client" } });
  const id = s.butler.status().readbackId!;
  assert.equal(s.butler.status().phase, "readback");
  return id;
}
test("handsfree requires complete playback and fresh framed answer; retries submit once", async () => {
  const s = setup(), id = await ready(s), audio = wav();
  await assert.rejects(s.butler.confirm(id, audio));
  assert.throws(() => s.butler.playbackEnded(id));
  s.butler.takeAudio(id); assert.throws(() => s.butler.playbackEnded(id)); s.tick(4000); s.butler.playbackEnded(id);
  await assert.rejects(s.butler.confirm(id, audio)); s.tick(8000);
  await Promise.all([s.butler.confirm(id, audio), s.butler.confirm(id, audio)]);
  assert.deepEqual(s.counts(), { submitted: 1, transcribed: 1, invalidated: 0 });
  assert.equal(s.butler.status().phase, "submitted");
  assert.equal(s.butler.status().ticket?.paymentStatus, "unpaid");
  assert.ok(s.commands.some(event => event.type === "session.thinking.append" && event.delegation_id === "opaque"));
});
test("negation or edits in completed recording invalidate quote without ordering", async () => {
  const s = setup("Yes, place this order, but change it to dine in."), id = await ready(s);
  s.butler.takeAudio(id); s.tick(4000); s.butler.playbackEnded(id); s.tick(8000); await s.butler.confirm(id, wav());
  assert.equal(s.counts().submitted, 0); assert.equal(s.counts().invalidated, 1); assert.equal(s.butler.status().phase, "collecting");
  await assert.rejects(s.butler.confirm(id, wav()));
});

test("status exposes only the fresh canonical quote during review and clears it on invalidation or close", async () => {
  const s = setup("No, change the order.");
  assert.equal("quote" in s.butler.status(), false);
  const id = await ready(s);
  for (const phase of ["readback", "playing", "confirming"] as const) {
    const status = s.butler.status();
    assert.equal(status.phase, phase); assert.deepEqual(status.quote, fixtureQuote);
    assert.deepEqual(Object.keys(status).sort(), ["phase", "quote", "readbackId", "ticket"]);
    const serialized = JSON.stringify(status);
    for (const privateField of ["confirmationNonce", "revision", "sessionTokenHash", "audio"]) assert.ok(!serialized.includes(`"${privateField}"`));
    if (phase === "readback") s.butler.takeAudio(id);
    if (phase === "playing") { s.tick(4000); s.butler.playbackEnded(id); }
  }
  s.tick(8000); await s.butler.confirm(id, wav());
  assert.equal(s.butler.status().phase, "collecting"); assert.equal("quote" in s.butler.status(), false);
  const another = setup(); await ready(another); await another.butler.stop();
  assert.equal("quote" in another.butler.status(), false);
  const failed = setup(); await ready(failed); await failed.butler.stop(true);
  assert.equal("quote" in failed.butler.status(), false);
});

test("short complete audio can confirm promptly without waiting eight seconds", async () => {
  const s = setup("confirm"), id = await ready(s);
  const audio = Buffer.from(wav().subarray(0, 44 + 16000 * 2 * 3.1));
  audio.writeUInt32LE(audio.length - 8, 4); audio.writeUInt32LE(audio.length - 44, 40);
  assert.equal(validateConfirmationWav(audio), 3.1);
  s.butler.takeAudio(id); s.tick(4000); s.butler.playbackEnded(id); s.tick(1000);
  await assert.rejects(s.butler.confirm(id, audio)); // Cannot upload prerecorded audio immediately.
  s.tick(2200); await s.butler.confirm(id, audio); assert.equal(s.counts().submitted, 1);
  const truncated = Buffer.from(audio.subarray(0, 44 + 16000));
  truncated.writeUInt32LE(truncated.length - 8, 4); truncated.writeUInt32LE(truncated.length - 44, 40);
  assert.throws(() => validateConfirmationWav(truncated));
});
test("stale id, interrupted audio and expired confirmation never transcribe or submit", async () => {
  const s = setup(), id = await ready(s);
  assert.throws(() => s.butler.takeAudio("other")); s.butler.takeAudio(id); s.tick(4000); s.butler.playbackEnded(id); s.tick(8000);
  await assert.rejects(s.butler.confirm(id, wav(true))); s.tick(30000); await assert.rejects(s.butler.confirm(id, wav()));
  assert.equal(s.counts().transcribed, 0); await s.butler.stop(); await assert.rejects(s.butler.confirm(id, wav()));
});
test("confirmation guard accepts only complete exact affirmative; audio must contain speech and quiet tail", () => {
  for (const value of ["okay", "yes place this order but no chilli", "don't place this order", "not yes place this order", "Yes place this order? Actually no."]) assert.equal(explicitVoiceConfirmation(value), false);
  assert.equal(explicitVoiceConfirmation("Yes, place this order!"), true);
  validateConfirmationWav(wav()); assert.throws(() => validateConfirmationWav(wav(true))); assert.throws(() => validateConfirmationWav(Buffer.alloc(100)));
  const silence = wav(); silence.fill(0, 44); assert.throws(() => validateConfirmationWav(silence));
  assert.match(quoteReadback(fixtureQuote), /dollars/);
});
test("separate speech adapters use exact documented models and complete file response without approval prompt", async () => {
  const fetcher: typeof fetch = async (url, options) => {
    if (String(url).endsWith("/speech")) { const body = JSON.parse(String(options?.body)); assert.equal(body.model, "gpt-4o-mini-tts"); assert.equal(body.response_format, "wav"); return new Response(wav()); }
    const body = options?.body as FormData; assert.equal(body.get("model"), "gpt-4o-transcribe"); assert.equal(body.get("response_format"), "json"); assert.equal(body.get("prompt"), null); assert.equal(body.get("stream"), null);
    return Response.json({ text: "Yes, place this order." });
  };
  assert.ok((await speakQuote("The authoritative quote", "fake", fetcher)).length > 0);
  assert.equal(await transcribeConfirmation(wav(), "fake", fetcher), "Yes, place this order.");
});


test("microphone controls require their matching ACK; late ACK cannot revive timed-out preparation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const commands: Record<string, unknown>[] = [];
  let prepared = 0;
  const s = setup(undefined, { send: event => { commands.push(event); }, prepare: async () => { prepared++; return null; } });
  await s.butler.receive({ type: "session.input_transcript.delta", event_id: "input", delta: "One rice" });
  const pending = s.butler.receive({ type: "session.delegation.created", event_id: "delegate", delegation: { id: "d", target: "client" } });
  const mute = commands.find(event => event.type === "session.input_audio.mute")!;
  await s.butler.receive({ type: "session.input_audio.muted", client_event_id: "wrong" });
  await s.butler.receive({ type: "session.input_audio.unmuted", client_event_id: mute.event_id });
  assert.equal(prepared, 0); assert.equal(s.butler.status().phase, "preparing");
  t.mock.timers.tick(5000); await pending;
  assert.equal(s.butler.status().errorCode, "VOICE_CONTROL_TIMEOUT"); assert.equal(s.butler.status().errorStage, "mute");
  await s.butler.receive({ type: "session.input_audio.muted", client_event_id: mute.event_id });
  assert.equal(prepared, 0); assert.equal(s.butler.status().phase, "error");
});

test("known pre-submit transcription outage retains canonical quote for fresh playback, never submits", async () => {
  const s = setup(undefined, { transcribe: async () => { throw new HttpError(502, "VOICE_TRANSCRIPTION_FAILED", "sensitive raw upstream detail"); } });
  const id = await ready(s);
  s.butler.takeAudio(id); s.tick(4000); s.butler.playbackEnded(id); s.tick(8000);
  await s.butler.confirm(id, wav());
  const status = s.butler.status();
  assert.equal(status.phase, "readback"); assert.notEqual(status.readbackId, id);
  assert.deepEqual(status.quote, fixtureQuote); assert.equal(status.errorStage, "transcribe");
  assert.equal(s.counts().submitted, 0);
  assert.ok(!JSON.stringify(status).includes("sensitive"));
  await assert.rejects(s.butler.confirm(id, wav()));
});

test("unknown submission outcome fails closed and cannot be retried as a fresh order", async () => {
  const s = setup(undefined, { submit: async () => { throw new Error("private upstream detail"); } });
  const id = await ready(s); s.butler.takeAudio(id); s.tick(4000); s.butler.playbackEnded(id); s.tick(8000);
  await s.butler.confirm(id, wav());
  assert.equal(s.butler.status().phase, "error"); assert.equal(s.butler.status().errorCode, "VOICE_SUBMIT_FAILED");
  assert.equal("quote" in s.butler.status(), false);
  assert.ok(!JSON.stringify(s.butler.status()).includes("private"));
});


test("fresh server quote is visible while speech is prepared and disappears on a late edit", async () => {
  let finishSpeech!: (audio: Buffer) => void;
  const speech = new Promise<Buffer>(resolve => { finishSpeech = resolve; });
  const s = setup(undefined, { speech: async () => speech });
  await s.butler.receive({ type: "session.input_transcript.delta", event_id: "input", delta: "One rice" });
  const pending = s.butler.receive({ type: "session.delegation.created", event_id: "delegate", delegation: { id: "d", target: "client" } });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(s.butler.status().phase, "preparing"); assert.deepEqual(s.butler.status().quote, fixtureQuote);
  await s.butler.receive({ type: "session.input_transcript.delta", event_id: "edit", delta: " actually two" });
  assert.equal("quote" in s.butler.status(), false);
  finishSpeech(Buffer.from("audio")); await pending;
  assert.equal(s.butler.status().phase, "collecting"); assert.equal("quote" in s.butler.status(), false);
});


test("menu questions stay conversational without pausing the microphone or consuming quote attempts", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup();
  await s.butler.receive({ type: "session.input_transcript.delta", event_id: "question", delta: "Hi, what's your menu?" });
  t.mock.timers.tick(1200);
  s.butler.previewTranscript("Hi, what's your menu? Show me the menu again.");
  await s.butler.receive({ type: "session.delegation.created", event_id: "question-delegation", delegation: { id: "question", target: "client" } });
  assert.equal(s.butler.status().phase, "collecting");
  assert.ok(!s.commands.some(event => event.type === "session.input_audio.mute"));
  await s.butler.receive({ type: "session.input_transcript.delta", event_id: "order", delta: " One rice, takeaway." });
  await s.butler.receive({ type: "session.delegation.created", event_id: "order-delegation", delegation: { id: "order", target: "client" } });
  assert.equal(s.butler.status().phase, "readback");
  await s.butler.stop();
});

 test("opening greets once after acknowledgement and never creates an order", async () => {
   const s = setup();
   const opening = s.butler.greet();
   const instruction = s.commands[0];
   assert.equal(instruction.type, "session.instructions.append");
   assert.match(String(instruction.content), /Come, what you want to eat\?/);
   await s.butler.receive({type:"session.instructions.appended",client_event_id:instruction.event_id});
   await opening; await s.butler.greet();
   assert.equal(s.commands.length,2);
   assert.equal(s.commands[1].type,"session.commentary.append");
   assert.equal(s.counts().submitted,0);
 });
