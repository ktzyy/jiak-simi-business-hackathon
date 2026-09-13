import test from "node:test";
import assert from "node:assert/strict";
import { backendHandlers, verifiedActor, type BackendClient } from "../src/server/supabase-backend";
import { stallDetailsHandlers } from "../src/server/stall-details";
import { createOcrHandler } from "../src/server/ai/ocr-handler";
import { PUBLIC_DEMO_BEARER, PUBLIC_DEMO_RESTAURANT_ID as restaurantId } from "../src/shared/public-demo";
import { fixtureMenu, fixtureTicket } from "../src/shared/fixtures";
import { fixtureStallDetails } from "../src/shared/stall-details";

const other = fixtureMenu.restaurantId;
const actor = "b123ff27-d269-4b0f-97f6-78a3e97170a3";
function request(value?: unknown, headers: Record<string, string> = {}) {
  return new Request("https://jiak.test/api/v1", { method: value === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${PUBLIC_DEMO_BEARER}`, origin: "https://jiak.test", "content-type": "application/json", ...headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
function harness() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let authCalls = 0;
  const client: BackendClient = {
    auth: { getUser: async () => { authCalls++; return { data: { user: null }, error: null }; } },
    rpc: async (name, args) => {
      calls.push({ name, args });
      const data = name === "publish_menu" ? args.p_menu : name === "complete_kitchen_order" ? { ...fixtureTicket, cart: { ...fixtureTicket.cart, restaurantId }, status: "done", statusVersion: 2, completedAt: new Date().toISOString() } : name === "read_kitchen_orders" ? { orders: [], counts: { received: 0, done: 0, total: 0 } } : { details: { ...fixtureStallDetails, restaurantId } };
      return { data, error: null };
    },
  };
  return { client, calls, authCalls: () => authCalls, handlers: backendHandlers(() => client), details: stallDetailsHandlers(() => client) };
}

test("public demo allows only dummy menu, details and kitchen operations with fixed actor", async t => {
  const previous = process.env.DEMO_MODE; process.env.DEMO_MODE = "true";
  t.after(() => { if (previous === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = previous; });
  const h = harness();
  assert.equal((await h.handlers.kitchen(request(), restaurantId)).status, 200);
  assert.equal((await h.handlers.publish(request({ menu: { ...fixtureMenu, restaurantId }, stallDetailsVersion: 1 }))).status, 200);
  assert.equal((await h.handlers.completeKitchenOrder(request({ restaurantId, orderId: fixtureTicket.id, expectedStatusVersion: 1 }, { "idempotency-key": fixtureTicket.id }))).status, 200);
  assert.equal((await h.details.read(request(), restaurantId)).status, 200);
  assert.equal((await h.details.save(request({ name: fixtureStallDetails.name, timezone: "Asia/Singapore", weeklyHours: fixtureStallDetails.weeklyHours, expectedVersion: 0 }), restaurantId)).status, 200);
  assert.equal(h.authCalls(), 0);
  for (const call of h.calls) { assert.equal(call.args.p_actor_id, actor); assert.equal(call.args.p_restaurant_id, restaurantId); }
});

test("demo cross-stall payloads, missing scope and off-origin mutations never reach privileged RPC", async t => {
  const previous = process.env.DEMO_MODE; process.env.DEMO_MODE = "true";
  t.after(() => { if (previous === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = previous; });
  const h = harness();
  assert.equal((await h.handlers.kitchen(request(undefined, { "x-restaurant-id": restaurantId }), other)).status, 403);
  assert.equal((await h.handlers.publish(request({ menu: fixtureMenu, stallDetailsVersion: 1 }))).status, 403);
  assert.equal((await h.handlers.completeKitchenOrder(request({ restaurantId: other, orderId: fixtureTicket.id, expectedStatusVersion: 1 }, { "idempotency-key": fixtureTicket.id }))).status, 403);
  assert.equal((await h.details.read(request(), other)).status, 403);
  assert.equal((await h.details.save(request({}), other)).status, 403);
  assert.equal((await h.handlers.publish(request({ menu: { ...fixtureMenu, restaurantId }, stallDetailsVersion: 1 }, { origin: "https://evil.test" }))).status, 403);
  await assert.rejects(verifiedActor(request(), h.client), { status: 403 });
  const ocr = createOcrHandler({ backend: () => h.client, apiKey: () => "test-key" });
  assert.equal((await ocr(request({}, { "x-restaurant-id": other }))).status, 403);
  assert.equal(h.calls.length, 0);
});

test("disabled demo and forged JWT fail closed without demo fallback", async t => {
  const previous = process.env.DEMO_MODE;
  t.after(() => { if (previous === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = previous; });
  const h = harness();
  for (const flag of [undefined, "false", "TRUE"]) {
    if (flag === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = flag;
    assert.equal((await h.handlers.kitchen(request(), restaurantId)).status, 401);
  }
  process.env.DEMO_MODE = "true";
  assert.equal((await h.handlers.kitchen(request(undefined, { authorization: "Bearer forged-jwt" }), restaurantId)).status, 401);
  assert.equal(h.authCalls(), 1);
  assert.equal(h.calls.length, 0);
});

test("public browser helper emits only the labelled sentinel without creating an Auth session", async t => {
  const previous = process.env.NEXT_PUBLIC_DEMO_MODE;
  process.env.NEXT_PUBLIC_DEMO_MODE = "true";
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE; else process.env.NEXT_PUBLIC_DEMO_MODE = previous; });
  const { getStaffAccessToken } = await import("../src/components/ui/staff-access");
  assert.equal(await getStaffAccessToken(), PUBLIC_DEMO_BEARER);
  assert.equal(PUBLIC_DEMO_BEARER.includes("."), false);
});
