import test from "node:test";
import assert from "node:assert/strict";
import { backendHandlers, getBackendClient, guestCookieName, hashGuestToken, type BackendClient } from "../src/server/supabase-backend";
import { fixtureCart, fixtureMenu, fixtureQuote } from "../src/shared/fixtures";

const actor = "99999999-9999-4999-8999-999999999999";
const token = "ab".repeat(32);
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://jiak.test/api/v1/orders", { method: "POST", headers: {
    origin: "https://jiak.test", "content-type": "application/json",
    cookie: `${guestCookieName(fixtureMenu.restaurantId)}=${token}`,
    ...headers,
  }, body: JSON.stringify(body) });
}
function harness(data: unknown = fixtureQuote, error: { code: string; message: string } | null = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: BackendClient = {
    rpc: async (name, args) => { calls.push({ name, args }); return { data, error }; },
    auth: { getUser: async jwt => ({ data: { user: jwt === "verified-token" ? { id: actor } : null }, error: null }) },
  };
  return { handlers: backendHandlers(() => client), calls };
}

test("quote binds cookie to restaurant and sends only its hash to database", async () => {
  const { handlers, calls } = harness();
  const response = await handlers.quote(request(fixtureCart));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), fixtureQuote);
  assert.equal(calls[0].args.p_session_token_hash, hashGuestToken(token));
  assert.equal(JSON.stringify(calls).includes(token), false);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const wrongCookie = request(fixtureCart, { cookie: `jiak_guest_${actor}=${token}` });
  assert.equal((await handlers.quote(wrongCookie)).status, 401);
  assert.equal(calls.length, 1);
});

test("cross-origin, missing confirmation, and tampered prices never reach RPC", async () => {
  const { handlers, calls } = harness();
  assert.equal((await handlers.quote(request(fixtureCart, { origin: "https://evil.test" }))).status, 403);
  assert.equal((await handlers.quote(request({ ...fixtureCart, totalCents: 1 }))).status, 400);
  assert.equal((await handlers.submit(request({ cart: fixtureCart, reviewedTotalCents: 1100, confirmed: false }))).status, 400);
  assert.equal(calls.length, 0);
});

test("submission fixes channel and preserves caller idempotency key", async () => {
  const ticket = { id: actor, createdAt: "2026-09-13T00:00:00Z", source: "web", status: "received", paymentStatus: "unpaid", cart: fixtureQuote };
  const { handlers, calls } = harness(ticket);
  const response = await handlers.submit(request({ cart: fixtureCart, reviewedTotalCents: fixtureQuote.totalCents, confirmed: true }, { "idempotency-key": actor }));
  assert.equal(response.status, 200);
  assert.equal(calls[0].args.p_source, "web");
  assert.equal(calls[0].args.p_idempotency_key, actor);
  assert.equal(calls[0].args.p_reviewed_total_cents, fixtureQuote.totalCents);
});

test("kitchen actor comes from verified Auth user and membership remains RPC enforced", async () => {
  const { handlers, calls } = harness({ orders: [] });
  assert.equal((await handlers.kitchen(new Request("https://jiak.test", { headers: { authorization: "Bearer forged-token" } }), fixtureMenu.restaurantId)).status, 401);
  assert.equal(calls.length, 0);
  const response = await handlers.kitchen(new Request("https://jiak.test", { headers: { authorization: "Bearer verified-token", "x-actor-id": fixtureMenu.id } }), fixtureMenu.restaurantId);
  assert.equal(response.status, 200);
  assert.equal(calls[0].args.p_actor_id, actor);
});

test("guest token is private cookie and database receives an independent digest", async () => {
  const { handlers, calls } = harness(actor);
  const response = await handlers.guest(request({ restaurantId: fixtureMenu.restaurantId }, { cookie: "" }));
  const cookie = response.headers.get("set-cookie")!;
  assert.equal(response.status, 200);
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const raw = cookie.split(";")[0].split("=")[1];
  assert.match(raw, /^[a-f0-9]{64}$/);
  assert.equal(calls[0].args.p_token_hash, hashGuestToken(raw));
  assert.equal(JSON.stringify(await response.json()).includes(raw), false);
});

test("reopening a customer session preserves the capability for uncertain-order recovery", async () => {
  const { handlers, calls } = harness(actor);
  const response = await handlers.guest(request({ restaurantId: fixtureMenu.restaurantId }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(calls.map(c => c.name), ["validate_guest_session"]);
  assert.equal(calls[0].args.p_session_token_hash, hashGuestToken(token));
});

test("business errors are whitelisted and internal SQL details are redacted", async () => {
  const conflict = harness(null, { code: "P0001", message: "STALE_MENU" });
  assert.equal((await conflict.handlers.quote(request(fixtureCart))).status, 409);
  const internal = harness(null, { code: "P0001", message: "secret-table-password" });
  const response = await internal.handlers.quote(request(fixtureCart));
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes("secret-table-password"), false);
});

test("configuration cannot silently target another Supabase project", () => {
  const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://production.supabase.co";
    assert.throws(() => getBackendClient(), /staging database/);
  } finally {
    if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
  }
});
