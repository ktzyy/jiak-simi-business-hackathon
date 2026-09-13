import assert from "node:assert/strict";
import test from "node:test";
import { createLiveSession, liveMenuInstructions, LiveSessionError } from "../src/server/ai/live-session";

test("Live SDP exchange is server authenticated and cannot expose order tools", async () => {
  let requestBody: Record<string, unknown> = {};
  const result = await createLiveSession({ sdp: "v=0\r\n", instructions: "Approved menu: Tea SGD 1.50." }, {
    apiKey: "test-secret",
    fetch: (async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/live/sessions");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-secret");
      requestBody = JSON.parse(init?.body as string);
      return Response.json({ session: { id: "opaque-session" }, transport: { type: "webrtc", sdp: "v=0\r\nanswer" }, secret: "not-returned" });
    }) as typeof fetch,
  });
  const session = requestBody.session as Record<string, unknown>;
  assert.equal(session.model, "gpt-live-1");
  assert.equal(session.store, false);
  assert.equal(session.tools, undefined);
  assert.equal(session.delegation, undefined);
  assert.deepEqual(session.client, { data_channel: { allowed_client_events: ["session.close"], allowed_server_events: [{ type: "session.started" }, { type: "session.input_transcript.delta" }, { type: "session.closed" }, { type: "error" }] } });
  assert.match(session.instructions as string, /Ordering and backend tools are unavailable/);
  assert.deepEqual(result, { sessionId: "opaque-session", sdp: "v=0\r\nanswer", model: "gpt-live-1", orderingEnabled: false });
});

test("invalid offers do not call the provider", async () => {
  let called = false;
  await assert.rejects(createLiveSession({ sdp: "bad", instructions: "" }, {
    apiKey: "test-secret", fetch: (async () => { called = true; return Response.json({}); }) as typeof fetch,
  }), /Invalid SDP/);
  assert.equal(called, false);
});

test("provider errors and malformed responses never leak their bodies", async () => {
  for (const response of [new Response("sensitive-provider-body", { status: 403 }), Response.json({ secret: "sensitive-provider-body" })]) {
    await assert.rejects(createLiveSession({ sdp: "v=0", instructions: "" }, {
      apiKey: "test-secret", fetch: (async () => response) as typeof fetch,
    }), (error: unknown) => error instanceof LiveSessionError && !error.message.includes("sensitive"));
  }
});


test("voice menu context rejects oversized snapshots without truncating modifier rules", async () => {
  const { fixtureMenu } = await import("../src/shared/fixtures");
  const dishes = Array.from({ length: 100 }, (_, i) => ({ ...fixtureMenu.dishes[0], id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: "x".repeat(120) }));
  assert.throws(() => liveMenuInstructions({ ...fixtureMenu, dishes }), /too large/);
});
