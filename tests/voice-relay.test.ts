import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { hostedHandsfreeProxy } from "../src/server/ai/live-relay-proxy";
import { voiceRelayOrigin, HANDSFREE_PATH } from "../src/server/ai/live-handsfree-contract";
import { createVoiceRelayServer } from "../scripts/run-voice-relay";
import { PUBLIC_DEMO_BEARER, PUBLIC_DEMO_RESTAURANT_ID } from "../src/shared/public-demo";

const machine = "r".repeat(48);
const command = { action: "start", restaurantId: PUBLIC_DEMO_RESTAURANT_ID, sdp: "v=0" };
test("relay URL validation permits only a configured HTTPS Quick Tunnel origin", () => {
  assert.equal(voiceRelayOrigin("https://example-voice.trycloudflare.com"), "https://example-voice.trycloudflare.com");
  for (const value of [undefined, "http://example.trycloudflare.com", "https://trycloudflare.com", "https://other.supabase.co", "https://example.trycloudflare.com.attacker.test", "https://example.trycloudflare.com:8443", "https://user:secret@example.trycloudflare.com", "https://example.trycloudflare.com/path", "https://example.trycloudflare.com?target=http://localhost", "http://localhost:3000"]) assert.equal(voiceRelayOrigin(value), null);
});

test("hosted proxy scopes commands and sends only machine authorization to fixed endpoint", async t => {
  const old = { DEMO_MODE: process.env.DEMO_MODE, VOICE_BACKEND_URL: process.env.VOICE_BACKEND_URL, VOICE_BACKEND_TOKEN: process.env.VOICE_BACKEND_TOKEN, APP_ORIGIN: process.env.APP_ORIGIN };
  Object.assign(process.env, { DEMO_MODE: "true", VOICE_BACKEND_URL: "https://example-voice.trycloudflare.com", VOICE_BACKEND_TOKEN: machine, APP_ORIGIN: "https://demo.example" });
  t.after(() => { for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  let calls = 0;
  const proxy = hostedHandsfreeProxy(async (url, init) => {
    calls++; assert.equal(String(url), `https://example-voice.trycloudflare.com${HANDSFREE_PATH}`); assert.equal(init?.redirect, "manual"); assert.equal(init?.cache, undefined);
    const headers = new Headers(init?.headers); assert.equal(headers.get("authorization"), `Bearer ${machine}`); assert.equal(headers.get("cookie"), null); assert.equal(headers.get("x-upstream-url"), null);
    assert.deepEqual(JSON.parse(String(init?.body)), command);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": "private=discard" } });
  });
  const req = (body: object = command, headers: Record<string, string> = {}) => new Request(`https://demo.example${HANDSFREE_PATH}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://demo.example", Authorization: `Bearer ${PUBLIC_DEMO_BEARER}`, cookie: "untrusted=value", "x-upstream-url": "https://other.supabase.co", ...headers }, body: JSON.stringify(body) });
  assert.equal((await proxy(req(command, { Origin: "https://attacker.example" }))).status, 403);
  assert.equal((await proxy(req(command, { Authorization: `Bearer ${machine}` }))).status, 401);
  assert.equal((await proxy(req({ ...command, restaurantId: "00000000-0000-4000-8000-000000000099" }))).status, 403);
  assert.equal((await proxy(req({ ...command, upstream: "https://other.supabase.co" }))).status, 400);
  assert.equal((await proxy(req(command, { "Content-Length": "1400001" }))).status, 413);
  assert.equal((await proxy(new Request(`https://demo.example${HANDSFREE_PATH}`))).status, 405);
  assert.equal(calls, 0);
  const response = await proxy(req()); assert.equal(response.status, 200); assert.equal(response.headers.get("set-cookie"), null); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(calls, 1);
  process.env.VOICE_BACKEND_URL = "https://mikpepfrumtglwweolzq.supabase.co";
  assert.equal((await proxy(req())).status, 503); assert.equal(calls, 1);
});

test("laptop relay rejects wrong key, path, method, oversized body and outside stall; forwards only fixed local API", async t => {
  let calls = 0;
  const server = createVoiceRelayServer({ token: machine, demoMode: true, fetcher: async (url, init) => {
    calls++; assert.equal(String(url), `http://localhost:3000${HANDSFREE_PATH}`); assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers); assert.equal(headers.get("authorization"), `Bearer ${PUBLIC_DEMO_BEARER}`); assert.equal(headers.get("origin"), "http://localhost:3000"); assert.equal(headers.get("cookie"), null);
    return Response.json({ phase: "collecting" });
  } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const send = (body: object = command, token = machine, path = HANDSFREE_PATH) => fetch(`${origin}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await send(command, "x".repeat(48))).status, 401);
  assert.equal((await send(command, machine, "/api/v1/menus/publish")).status, 404);
  assert.equal((await fetch(`${origin}${HANDSFREE_PATH}`, { headers: { Authorization: `Bearer ${machine}` } })).status, 405);
  assert.equal((await send({ ...command, restaurantId: "00000000-0000-4000-8000-000000000099" })).status, 403);
  assert.equal((await send({ ...command, sdp: "v=0" + "x".repeat(1_400_000) })).status, 413);
  assert.equal(calls, 0);
  const response = await send(); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { phase: "collecting" }); assert.equal(calls, 1);
  assert.throws(() => createVoiceRelayServer({ token: machine, demoMode: false }));
});

test("hosted proxy diagnostics identify stage and exception class without leaking details", async t => {
  const old = { DEMO_MODE: process.env.DEMO_MODE, VOICE_BACKEND_URL: process.env.VOICE_BACKEND_URL, VOICE_BACKEND_TOKEN: process.env.VOICE_BACKEND_TOKEN, APP_ORIGIN: process.env.APP_ORIGIN };
  Object.assign(process.env, { DEMO_MODE: "true", VOICE_BACKEND_URL: "https://example-voice.trycloudflare.com", VOICE_BACKEND_TOKEN: machine, APP_ORIGIN: "https://demo.example" });
  t.after(() => { for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const request = () => new Request(`https://demo.example${HANDSFREE_PATH}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://demo.example", Authorization: `Bearer ${PUBLIC_DEMO_BEARER}` }, body: JSON.stringify(command) });
  const failure = await hostedHandsfreeProxy(async () => { throw new TypeError(`sensitive-url-${machine}`); })(request());
  const text = await failure.text(); assert.equal(failure.status, 502); assert.equal(JSON.parse(text).error.code, "VOICE_RELAY_FETCH_TYPEERROR"); assert.ok(!text.includes(machine)); assert.ok(!text.includes("sensitive-url"));
  const html = await hostedHandsfreeProxy(async () => new Response("private upstream details", { headers: { "Content-Type": "text/html" } }))(request());
  assert.equal((await html.json()).error.code, "VOICE_RELAY_CONTENT_TYPE_ERROR");
  const invalidJson = await hostedHandsfreeProxy(async () => new Response("broken-secret", { headers: { "Content-Type": "application/json" } }))(request());
  assert.equal((await invalidJson.json()).error.code, "VOICE_RELAY_JSON_SYNTAXERROR");
  let redirects = 0;
  const redirected = await hostedHandsfreeProxy(async (_url, init) => { redirects++; assert.equal(init?.redirect, "manual"); return new Response("", { status: 302, headers: { Location: "https://untrusted.example/receive", "Content-Type": "application/json" } }); })(request());
  assert.equal((await redirected.json()).error.code, "VOICE_RELAY_REDIRECT_ERROR"); assert.equal(redirects, 1); assert.equal(redirected.headers.get("location"), null);
});
