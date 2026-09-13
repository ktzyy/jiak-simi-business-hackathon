import assert from "node:assert/strict";
import test from "node:test";
import { voiceHandlers } from "../src/server/ai/voice-ordering";
import { fixtureMenu, fixtureCart, fixtureQuote, fixtureTicket } from "../src/shared/fixtures";
import type { BackendClient } from "../src/server/supabase-backend";

const actor = "00000000-0000-4000-8000-000000000010";
const session = { id: "00000000-0000-4000-8000-000000000011", restaurantId: fixtureMenu.restaurantId, providerSessionId: "opaque/provider-id", status: "active", sessionTokenHash: "a".repeat(64), expiresAt: "2099-01-01T00:00:00Z" };
const nonce = "00000000-0000-4000-8000-000000000012";
const request = (value: unknown) => new Request("http://localhost:3000/api/v1/live/sessions", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", authorization: "Bearer test-staff" }, body: JSON.stringify(value) });
function setup(t: test.TestContext) {
  const originalKey = process.env.OPENAI_API_KEY, originalEnv = process.env.NODE_ENV, origin = process.env.APP_ORIGIN;
  Object.assign(process.env, { OPENAI_API_KEY: "fake-key", NODE_ENV: "test", APP_ORIGIN: "http://localhost:3000" });
  t.after(() => {
    for (const [key, value] of Object.entries({ OPENAI_API_KEY: originalKey, NODE_ENV: originalEnv, APP_ORIGIN: origin })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let fault: string | undefined;
  const backend: BackendClient = {
    auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (fault === name) return { data: null, error: { code: "P0001", message: "FORBIDDEN" } };
      const replies: Record<string, unknown> = {
        consume_staff_ai_budget: actor, consume_guest_ai_budget: actor, read_published_menu: fixtureMenu,
        create_voice_session: session, read_voice_session: session, begin_voice_review: { revision: 2 },
        save_voice_review: { quote: fixtureQuote, confirmationNonce: nonce, revision: 2 },
        submit_voice_order: { ...fixtureTicket, source: "voice" }, close_voice_session: { ok: true },
      };
      assert.ok(name in replies, `unexpected RPC ${name}`);
      return { data: replies[name], error: null };
    },
  };
  return { backend, calls, fail: (name: string | undefined) => { fault = name; } };
}

test("voice create authorizes budget and stores ownership before returning audio", async t => {
  const { backend, calls, fail } = setup(t);
  let paid = 0;
  const handlers = voiceHandlers({ backend: () => backend, create: async input => {
    paid++;
    const spokenMenu = JSON.parse(input.instructions.split("Published menu data: ")[1]);
    assert.equal(spokenMenu.id, fixtureMenu.id);
    assert.equal(spokenMenu.version, fixtureMenu.version);
    assert.deepEqual(spokenMenu.dishes.map((dish: { id: string; name: string }) => [dish.id, dish.name]), fixtureMenu.dishes.map(dish => [dish.id, dish.name]));
    assert.equal(spokenMenu.dishes[0].priceSGD, `S$${(fixtureMenu.dishes[0].priceCents / 100).toFixed(2)}`);
    assert.equal(spokenMenu.dishes[0].priceCents, undefined);
    return { sessionId: session.providerSessionId, sdp: "v=0 answer", model: "gpt-live-1", orderingEnabled: false };
  } });
  fail("consume_staff_ai_budget");
  assert.equal((await handlers.create(request({ restaurantId: fixtureMenu.restaurantId, sdp: "v=0" }))).status, 403);
  assert.equal(paid, 0);
  fail(undefined);
  const response = await handlers.create(request({ restaurantId: fixtureMenu.restaurantId, sdp: "v=0" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.voiceSessionId, session.id);
  assert.equal(result.sessionTokenHash, undefined);
  assert.equal(result.orderingEnabled, false);
  assert.equal(result.reviewEnabled, true);
  assert.deepEqual(calls.at(-1)?.args, { p_actor_id: actor, p_restaurant_id: fixtureMenu.restaurantId, p_provider_session_id: session.providerSessionId });
  const invalid = await handlers.create(request({ restaurantId: fixtureMenu.restaurantId, sdp: "v=0", instructions: "buy" }));
  assert.equal(invalid.status, 400);
  assert.equal(paid, 1);
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal((await handlers.create(request({ restaurantId: fixtureMenu.restaurantId, sdp: "v=0" }))).status, 503);
  assert.equal(paid, 1);
});

test("failure to save voice ownership closes the new provider session", async t => {
  const { backend, fail } = setup(t);
  fail("create_voice_session");
  const closed: string[] = [];
  const handlers = voiceHandlers({ backend: () => backend, create: async () => ({ sessionId: session.providerSessionId, sdp: "v=0", model: "gpt-live-1", orderingEnabled: false }), closeProvider: async id => { closed.push(id); } });
  assert.equal((await handlers.create(request({ restaurantId: fixtureMenu.restaurantId, sdp: "v=0" }))).status, 403);
  assert.deepEqual(closed, [session.providerSessionId]);
});

test("new review invalidates old nonce before parsing and only quotes clear intent", async t => {
  const { backend, calls } = setup(t);
  let ambiguous = true;
  const handlers = voiceHandlers({ backend: () => backend, parse: async (_menu, text, options) => {
    assert.equal(options.fulfillmentType, fixtureCart.fulfillmentType);
    assert.equal(calls.at(-1)?.name, "consume_guest_ai_budget");
    assert.ok(calls.some(call => call.name === "begin_voice_review"));
    assert.equal(text, "two noodles");
    return { ...fixtureCart, issues: ambiguous ? [{ code: "CLARIFICATION_REQUIRED", message: "Which portion?", lineIndex: 0 }] : [] };
  } });
  let response = await handlers.review(request({ voiceSessionId: session.id, text: "two noodles", fulfillmentType: fixtureCart.fulfillmentType }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).review, null);
  assert.equal(calls.some(call => call.name === "save_voice_review"), false);
  ambiguous = false;
  response = await handlers.review(request({ voiceSessionId: session.id, text: "two noodles", fulfillmentType: fixtureCart.fulfillmentType }));
  assert.equal((await response.json()).review.confirmationNonce, nonce);
  assert.deepEqual(calls.at(-1)?.args, { p_actor_id: actor, p_voice_session_id: session.id, p_cart: fixtureCart, p_revision: 2 });
});

test("voice submit requires explicit nonce confirmation and cannot accept client prices", async t => {
  const { backend, calls } = setup(t);
  const handlers = voiceHandlers({ backend: () => backend });
  for (const value of [{ voiceSessionId: session.id, confirmed: true }, { voiceSessionId: session.id, confirmationNonce: nonce, confirmed: false }, { voiceSessionId: session.id, confirmationNonce: nonce, confirmed: true, cart: fixtureCart }]) {
    assert.equal((await handlers.submit(request(value))).status, 400);
  }
  assert.equal(calls.length, 0);
  const response = await handlers.submit(request({ voiceSessionId: session.id, confirmationNonce: nonce, confirmed: true }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).source, "voice");
  assert.deepEqual(calls[0].args, { p_actor_id: actor, p_voice_session_id: session.id, p_confirmation_nonce: nonce });
});

test("voice End resolves server ownership and only marks closed after provider acknowledgement", async t => {
  const { backend, calls } = setup(t);
  let shouldFail = true;
  const handlers = voiceHandlers({ backend: () => backend, closeProvider: async id => { assert.equal(id, session.providerSessionId); if (shouldFail) throw new Error("private provider error"); } });
  let response = await handlers.close(request({ voiceSessionId: session.id }));
  assert.equal(response.status, 502);
  assert.equal(calls.some(call => call.name === "close_voice_session"), false);
  assert.doesNotMatch(await response.text(), /private/);
  shouldFail = false;
  response = await handlers.close(request({ voiceSessionId: session.id }));
  assert.equal(response.status, 200);
  assert.equal(calls.at(-1)?.name, "close_voice_session");
});


test("voice review requires a selected dining mode and blocks a conflicting interpretation", async t => {
  const { backend, calls } = setup(t);
  let parsed = 0;
  const handlers = voiceHandlers({ backend: () => backend, parse: async () => {
    parsed++;
    return { ...fixtureCart, fulfillmentType: fixtureCart.fulfillmentType === "dine_in" ? "takeaway" : "dine_in", issues: [] };
  } });
  assert.equal((await handlers.review(request({ voiceSessionId: session.id, text: "one noodles" }))).status, 400);
  assert.equal(parsed, 0);
  assert.equal(calls.length, 0);
  const response = await handlers.review(request({ voiceSessionId: session.id, text: "one noodles", fulfillmentType: fixtureCart.fulfillmentType }));
  const result = await response.json();
  assert.equal(result.review, null);
  assert.equal(result.intent.fulfillmentType, null);
  assert.equal(result.intent.issues[0].code, "FULFILLMENT_REQUIRED");
  assert.equal(calls.some(call => call.name === "save_voice_review"), false);
});
