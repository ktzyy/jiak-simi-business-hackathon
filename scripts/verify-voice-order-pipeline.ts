/** Paid staging integration check. Real parser, TTS, transcription and database;
 * simulated WebRTC/control acknowledgements. It is not a microphone acceptance test.
 * Run only with --place-test-order: creates exactly one unpaid dummy-stall ticket. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { handsfreeHandler } from "../src/server/ai/live-handsfree";
import { LiveButler } from "../src/server/ai/live-butler";
import { speakQuote, validateConfirmationWav } from "../src/server/ai/live-confirmation-audio";
import { getBackendClient, databaseRpc } from "../src/server/supabase-backend";
import { PUBLIC_DEMO_BEARER, PUBLIC_DEMO_RESTAURANT_ID } from "../src/shared/public-demo";
import { KitchenResponseSchema, TicketSchema, QuoteSchema } from "../src/shared/contracts";

function confirmationWav(input: Buffer) {
  // The speech API emits streaming RIFF lengths. Reframe PCM with leading/trailing
  // silence as the separate recorder would; never fabricate the transcription.
  assert.equal(input.toString("ascii", 0, 4), "RIFF");
  let rate = 0, pcm: Buffer | undefined;
  for (let at = 12; at + 8 <= input.length;) {
    const tag = input.toString("ascii", at, at + 4), size = input.readUInt32LE(at + 4);
    if (tag === "fmt ") {
      assert.equal(input.readUInt16LE(at + 8), 1); assert.equal(input.readUInt16LE(at + 10), 1);
      assert.equal(input.readUInt16LE(at + 22), 16); rate = input.readUInt32LE(at + 12);
    }
    if (tag === "data") { pcm = input.subarray(at + 8, Math.min(input.length, at + 8 + size)); break; }
    at += 8 + size + (size % 2);
  }
  assert.ok(rate && pcm);
  const audio = Buffer.concat([Buffer.alloc(Math.round(rate * 0.5) * 2), pcm, Buffer.alloc(rate * 2)]);
  const wav = Buffer.alloc(44 + audio.length);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(audio.length, 40); audio.copy(wav, 44);
  validateConfirmationWav(wav); return wav;
}

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--place-test-order"]);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, "https://mikpepfrumtglwweolzq.supabase.co");
  assert.ok(process.env.OPENAI_API_KEY);
  Object.assign(process.env, { NODE_ENV: "test", DEMO_MODE: "true", APP_ORIGIN: "http://localhost:3000" });
  let butler!: LiveButler, now = Date.now(), stage = "start";
  const route = handsfreeHandler({ sessions: new Map(), now: () => now,
    create: async () => ({ sessionId: `pipeline-test-${randomUUID()}`, sdp: "v=0", model: "gpt-live-1", orderingEnabled: false }),
    attach: async (_id, _key, make) => {
      butler = make(event => {
        if (event.type === "session.input_audio.mute" || event.type === "session.input_audio.unmute") queueMicrotask(() => { void butler.receive({ type: `${event.type}d`, client_event_id: event.event_id }); });
      }); return butler;
    }, close: async () => {},
  });
  const invoke = async (body: object) => {
    const response = await route(new Request("http://localhost:3000/api/v1/live/handsfree", { method: "POST", headers: { origin: "http://localhost:3000", "Content-Type": "application/json", Authorization: `Bearer ${PUBLIC_DEMO_BEARER}` }, body: JSON.stringify(body) }));
    const result = await response.json();
    assert.equal(response.status, 200, `${stage}: ${result.error?.code ?? response.status}`); return result;
  };
  const started = await invoke({ action: "start", restaurantId: PUBLIC_DEMO_RESTAURANT_ID, sdp: "v=0" });
  try {
    stage = "prepare";
    await butler.receive({ type: "session.input_transcript.delta", event_id: randomUUID(), delta: "One Char Siew Rice, please." });
    await butler.receive({ type: "session.delegation.created", event_id: randomUUID(), delegation: { target: "client", id: "test-delegation" } });
    const ready = await invoke({ action: "status", voiceSessionId: started.voiceSessionId });
    assert.equal(ready.phase, "readback", `${ready.errorStage}: ${ready.errorCode}`);
    const quote = QuoteSchema.parse(ready.quote); assert.equal(quote.totalCents, 450); assert.equal(quote.fulfillmentType, "dine_in");
    assert.equal(quote.lines.length, 1); assert.equal(quote.lines[0].name, "Char Siew Rice");
    assert.ok(quote.lines[0].options.some(option => /^chilli$/i.test(option.name)));
    stage = "readback";
    const sound = await invoke({ action: "audio", voiceSessionId: started.voiceSessionId, readbackId: ready.readbackId });
    assert.ok(Buffer.from(sound.audio, "base64").length > 1000);
    now += 20_000;
    await invoke({ action: "playback", voiceSessionId: started.voiceSessionId, readbackId: ready.readbackId });
    stage = "confirm";
    const wav = confirmationWav(await speakQuote("Confirm.", process.env.OPENAI_API_KEY!));
    now += Math.ceil(validateConfirmationWav(wav) * 1000);
    const command = { action: "confirm", voiceSessionId: started.voiceSessionId, readbackId: ready.readbackId, audio: wav.toString("base64") };
    const placed = await invoke(command); assert.equal(placed.phase, "submitted", `${placed.errorStage}: ${placed.errorCode}`);
    const ticket = TicketSchema.parse(placed.ticket); assert.equal(ticket.source, "voice"); assert.equal(ticket.paymentStatus, "unpaid");
    stage = "replay"; const replay = await invoke(command); assert.equal(replay.ticket.id, ticket.id);
    stage = "kitchen";
    const kitchen = await databaseRpc(getBackendClient(), "read_kitchen_orders", { p_actor_id: "b123ff27-d269-4b0f-97f6-78a3e97170a3", p_restaurant_id: PUBLIC_DEMO_RESTAURANT_ID }, KitchenResponseSchema);
    assert.equal(kitchen.orders.filter(order => order.id === ticket.id).length, 1);
    const result = { verifiedAt: new Date().toISOString(), test: "real-database-parser-speech-transcription-simulated-transport", microphoneTested: false, webRtcTested: false, ticketId: ticket.id, quoteCents: quote.totalCents, fulfillmentType: quote.fulfillmentType, paymentStatus: ticket.paymentStatus, replaySameTicket: true, kitchenCopies: 1 };
    await writeFile("/private/tmp/jiak-voice-pipeline-result.json", JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { await invoke({ action: "close", voiceSessionId: started.voiceSessionId }).catch(() => undefined); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Voice pipeline check failed."); process.exitCode = 1; });
