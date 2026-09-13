import assert from "node:assert/strict";
import test from "node:test";
import { applyVoiceDefaults, handsfreeHandler } from "../src/server/ai/live-handsfree";
import { DEMO_MENU_WITH_EXTRAS } from "../src/shared/demo-menu";
import { PUBLIC_DEMO_RESTAURANT_ID, PUBLIC_DEMO_BEARER } from "../src/shared/public-demo";
import { fixtureMenu, fixtureCart, fixtureQuote, fixtureTicket } from "../src/shared/fixtures";
import { LiveButler } from "../src/server/ai/live-butler";
import type { BackendClient } from "../src/server/supabase-backend";

test("voice-only defaults choose dine-in and free chilli without overriding explicit choices", () => {
  const menu = DEMO_MENU_WITH_EXTRAS, dish = menu.dishes[0], group = dish.modifierGroups[1];
  const chilli = group.options.find(option => option.name === "Chilli")!, noChilli = group.options.find(option => option.name === "No chilli")!;
  const intent = { restaurantId: menu.restaurantId, menuId: menu.id, menuVersion: menu.version, fulfillmentType: null, lines: [{ dishId: dish.id, quantity: 1, optionIds: [] as string[] }], issues: [{ code: "FULFILLMENT_REQUIRED", message: "Choose mode", lineIndex: null }] };
  const defaulted = applyVoiceDefaults(intent, menu, "one char siew rice");
  assert.equal(defaulted.fulfillmentType, "dine_in"); assert.deepEqual(defaulted.lines[0].optionIds, [chilli.id]); assert.deepEqual(defaulted.issues, []);
  assert.equal(intent.fulfillmentType, null); assert.deepEqual(intent.lines[0].optionIds, []);
  const explicit = applyVoiceDefaults({ ...intent, fulfillmentType: "takeaway", lines: [{ ...intent.lines[0], optionIds: [noChilli.id] }] }, menu, "one char siew rice takeaway no chilli");
  assert.equal(explicit.fulfillmentType, "takeaway"); assert.deepEqual(explicit.lines[0].optionIds, [noChilli.id]);
  assert.deepEqual(applyVoiceDefaults(intent, menu, "one char siew rice without chilli").lines[0].optionIds, []);
  const unresolved = applyVoiceDefaults(intent, menu, "one char siew rice not takeaway");
  assert.equal(unresolved.fulfillmentType, null); assert.equal(unresolved.issues[0].code, "FULFILLMENT_REQUIRED");
  const otherIssue = applyVoiceDefaults({ ...intent, issues: [{ code: "UNKNOWN_DISH", message: "Unknown dish", lineIndex: null }] }, menu, "something else");
  assert.equal(otherIssue.issues[0].code, "UNKNOWN_DISH");
});

test("handsfree HTTP start is local-only, authorizes scope before provider and hides private session state", async t => {
  const prior = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, NODE_ENV: process.env.NODE_ENV, APP_ORIGIN: process.env.APP_ORIGIN, DEMO_MODE: process.env.DEMO_MODE };
  Object.assign(process.env, { OPENAI_API_KEY: "fake", NODE_ENV: "test", APP_ORIGIN: "http://localhost:3000", DEMO_MODE: "true" });
  t.after(() => { for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const actor = "b123ff27-d269-4b0f-97f6-78a3e97170a3", sessionId = "00000000-0000-4000-8000-000000000055";
  const session = { id: sessionId, providerSessionId: "live_opaque", restaurantId: PUBLIC_DEMO_RESTAURANT_ID, sessionTokenHash: "a".repeat(64), status: "active", expiresAt: "2099-01-01T00:00:00Z" };
  let paid = 0, wrongRestaurant = false, databaseClosed = false;
  const calls: string[] = [];
  const backend: BackendClient = {
    auth: { getUser: async () => { throw new Error("Sentinel should be separately scoped."); } },
    rpc: async name => {
      calls.push(name);
      if (name === "close_voice_session") databaseClosed = true;
      const replies: Record<string, unknown> = { consume_staff_ai_budget: actor, read_published_menu: { ...fixtureMenu, restaurantId: PUBLIC_DEMO_RESTAURANT_ID }, create_voice_session: session, read_voice_session: { ...session, status: databaseClosed ? "closed" : "active", restaurantId: wrongRestaurant ? fixtureMenu.restaurantId : PUBLIC_DEMO_RESTAURANT_ID }, close_voice_session: { ok: true } };
      assert.ok(name in replies, name); return { data: replies[name], error: null };
    },
  };
  const handlers = handsfreeHandler({ backend: () => backend, sessions: new Map(), create: async input => {
    paid++; assert.equal(input.handsfree, true); assert.match(input.instructions, /delegate/); assert.doesNotMatch(input.instructions, /Tap Review|ONLY confirmation/);
    return { sessionId: session.providerSessionId, sdp: "v=0 answer", model: "gpt-live-1", orderingEnabled: false };
  }, attach: async (_id, _key, make) => make(() => {}), close: async () => {} });
  const req = (body: object) => new Request("http://localhost:3000/api/v1/live/handsfree", { method: "POST", headers: { origin: "http://localhost:3000", "Content-Type": "application/json", Authorization: `Bearer ${PUBLIC_DEMO_BEARER}` }, body: JSON.stringify(body) });
  assert.equal((await handlers(req({ action: "start", restaurantId: fixtureMenu.restaurantId, sdp: "v=0" }))).status, 403); assert.equal(paid, 0);
  const start = await handlers(req({ action: "start", restaurantId: PUBLIC_DEMO_RESTAURANT_ID, sdp: "v=0" }));
  assert.equal(start.status, 200); const answer = await start.json(); assert.equal(answer.voiceSessionId, sessionId); assert.equal(answer.sessionTokenHash, undefined); assert.equal(answer.handsfree, true);
  assert.deepEqual(calls.slice(0, 3), ["consume_staff_ai_budget", "read_published_menu", "create_voice_session"]);
  wrongRestaurant = true;
  assert.equal((await handlers(req({ action: "close", voiceSessionId: sessionId }))).status, 403); assert.ok(!calls.includes("close_voice_session"));
  wrongRestaurant = false;
  assert.equal((await handlers(req({ action: "status", voiceSessionId: sessionId }))).status, 200);
  assert.equal((await handlers(req({ action: "close", voiceSessionId: sessionId }))).status, 200);
  const finalStatus = await handlers(req({ action: "status", voiceSessionId: sessionId }));
  assert.equal(finalStatus.status, 200); assert.equal((await finalStatus.json()).phase, "closed");
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal((await handlers(req({ action: "start", restaurantId: PUBLIC_DEMO_RESTAURANT_ID, sdp: "v=0" }))).status, 503); assert.equal(paid, 1);
});

test("closing while confirmation transcription is pending prevents order submission", async () => {
  let release!: (text: string) => void, now = 0, submitted = 0;
  const { fixtureQuote, fixtureTicket } = await import("../src/shared/fixtures");
  const controller = new LiveButler("actor", "session", {
    now: () => now, prepare: async () => ({ quote: fixtureQuote, confirmationNonce: "nonce", revision: 1 }), invalidate: async () => {}, speech: async () => Buffer.from("audio"), transcribe: () => new Promise(resolve => { release = resolve; }), submit: async () => { submitted++; return { ...fixtureTicket, source: "voice" }; }, close: async () => {},
    send: event => { if (event.type === "session.input_audio.mute") queueMicrotask(() => { void controller.receive({ type: "session.input_audio.muted", client_event_id: event.event_id }); }); },
  });
  await controller.receive({ type: "session.input_transcript.delta", event_id: "i", delta: "rice takeaway" });
  await controller.receive({ type: "session.delegation.created", event_id: "d", delegation: { target: "client", id: "delegate" } });
  const id = controller.status().readbackId!; controller.takeAudio(id); now = 5000; controller.playbackEnded(id); now = 13000;
  const rate = 16000, wav = Buffer.alloc(44 + rate * 16);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVE", 8); wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = rate; i < rate * 2; i++) wav.writeInt16LE(5000, 44 + i * 2);
  const pending = controller.confirm(id, wav); await controller.stop(); release("Yes, place this order"); await pending;
  assert.equal(submitted, 0); assert.equal(controller.status().phase, "closed");
});

test("HTTP spoken confirmation recovers a lost submission response using the same nonce, then replays the receipt", async t => {
  const prior = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, NODE_ENV: process.env.NODE_ENV, APP_ORIGIN: process.env.APP_ORIGIN, DEMO_MODE: process.env.DEMO_MODE };
  Object.assign(process.env, { OPENAI_API_KEY: "fake", NODE_ENV: "test", APP_ORIGIN: "http://localhost:3000", DEMO_MODE: "true" });
  t.after(() => { for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const id = "00000000-0000-4000-8000-000000000081", nonce = "00000000-0000-4000-8000-000000000082";
  const session = { id, restaurantId: PUBLIC_DEMO_RESTAURANT_ID, providerSessionId: "live_fixture", status: "active", sessionTokenHash: "a".repeat(64), expiresAt: "2099-01-01T00:00:00Z" };
  const quote = { ...fixtureQuote, restaurantId: PUBLIC_DEMO_RESTAURANT_ID };
  let time = 0, submits = 0, transcripts = 0;
  const calls: string[] = [];
  const backend: BackendClient = { auth: { getUser: async () => { throw new Error("Sentinel path"); } }, rpc: async (name, args) => {
    calls.push(name);
    if (name === "submit_voice_order") {
      submits++; assert.equal(args.p_confirmation_nonce, nonce); assert.equal(args.p_voice_session_id, id);
      if (submits === 1) return { data: null, error: { code: "NETWORK", message: "Transport response unavailable" } };
    }
    if (name === "save_voice_review") { assert.equal(args.p_revision, 3); assert.equal((args.p_cart as typeof fixtureCart).restaurantId, PUBLIC_DEMO_RESTAURANT_ID); }
    const values: Record<string, unknown> = { consume_staff_ai_budget: id, consume_guest_ai_budget: id, read_published_menu: { ...fixtureMenu, restaurantId: PUBLIC_DEMO_RESTAURANT_ID }, create_voice_session: session, read_voice_session: session, begin_voice_review: { revision: 3 }, save_voice_review: { quote, confirmationNonce: nonce, revision: 3 }, submit_voice_order: { ...fixtureTicket, source: "voice", cart: quote }, close_voice_session: { ok: true } };
    assert.ok(name in values, name); return { data: values[name], error: null };
  } };
  let controller!: LiveButler;
  const route = handsfreeHandler({ backend: () => backend, now: () => time, sessions: new Map(), create: async () => ({ sessionId: session.providerSessionId, sdp: "v=0", model: "gpt-live-1", orderingEnabled: false }),
    attach: async (_id, _key, make) => { controller = make(event => { if (event.type === "session.input_audio.mute") queueMicrotask(() => { void controller.receive({ type: "session.input_audio.muted", client_event_id: event.event_id }); }); }); return controller; },
    parse: async menu => ({ restaurantId: menu.restaurantId, menuId: menu.id, menuVersion: menu.version, fulfillmentType: fixtureCart.fulfillmentType, lines: fixtureCart.lines, issues: [] }),
    speech: async text => { assert.match(text, /After the beep/); return Buffer.from("finite wav fixture"); }, transcribe: async () => { transcripts++; return "Yes, place this order."; }, close: async () => {},
  });
  const invoke = (value: object) => route(new Request("http://localhost:3000/api/v1/live/handsfree", { method: "POST", headers: { origin: "http://localhost:3000", "Content-Type": "application/json", Authorization: `Bearer ${PUBLIC_DEMO_BEARER}` }, body: JSON.stringify(value) }));
  assert.equal((await invoke({ action: "start", restaurantId: PUBLIC_DEMO_RESTAURANT_ID, sdp: "v=0" })).status, 200);
  await controller.receive({ type: "session.input_transcript.delta", event_id: "input", delta: "Rice takeaway" });
  await controller.receive({ type: "session.delegation.created", event_id: "delegate", delegation: { id: "delegate1", target: "client" } });
  const status = await (await invoke({ action: "status", voiceSessionId: id })).json();
  assert.equal(status.phase, "readback"); assert.equal(status.confirmationNonce, undefined);
  assert.equal((await invoke({ action: "audio", voiceSessionId: id, readbackId: status.readbackId })).status, 200);
  time = 5000; assert.equal((await invoke({ action: "playback", voiceSessionId: id, readbackId: status.readbackId })).status, 200); time = 13000;
  const rate = 16000, wav = Buffer.alloc(44 + rate * 16);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVE", 8); wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = rate; i < rate * 2; i++) wav.writeInt16LE(5000, 44 + i * 2);
  const body = { action: "confirm", voiceSessionId: id, readbackId: status.readbackId, audio: wav.toString("base64") };
  const placed = await (await invoke(body)).json(); assert.equal(placed.phase, "submitted"); assert.equal(placed.ticket.paymentStatus, "unpaid");
  assert.equal((await invoke(body)).status, 200); assert.equal(submits, 2); assert.equal(transcripts, 1);
  assert.equal(calls.filter(name => name === "consume_guest_ai_budget").length, 3);
});
