import assert from "node:assert/strict";
import test from "node:test";
import { createLiveSession, liveMenuInstructions, handsfreeMenuInstructions, LiveSessionError } from "../src/server/ai/live-session";

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


test("voice context supports 100 dishes without repeating shared modifiers or UUIDs", async () => {
  const { fixtureMenu } = await import("../src/shared/fixtures");
  const dishes = Array.from({ length: 100 }, (_, i) => ({ ...fixtureMenu.dishes[0], id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: "x".repeat(120) }));
  const expanded = { ...fixtureMenu, dishes };
  for (const render of [liveMenuInstructions, handsfreeMenuInstructions]) {
    const instructions = render(expanded);
    const data = JSON.parse(instructions.split("\nPublished menu data: ")[1]);
    assert.equal(data.dishes.length, 100);
    assert.ok(instructions.length < 40000);
    assert.ok(!instructions.includes(fixtureMenu.restaurantId));
    assert.equal(data.dishes[0].modifierGroups[0], data.dishes[99].modifierGroups[0]);
  }
});

test("Live receives dollar-formatted egg prices and free chilli without raw cent fields", async () => {
  const { DEMO_MENU_WITH_EXTRAS } = await import("../src/shared/demo-menu");
  const instructions = liveMenuInstructions(DEMO_MENU_WITH_EXTRAS);
  const menu = JSON.parse(instructions.split("\nPublished menu data: ")[1]);
  assert.equal(menu.dishes[0].priceSGD, "S$4.50");
  const options = menu.dishes[0].modifierGroups.map((reference: string) => menu.modifierGroups[reference]).flatMap((group: { options: Array<{ name: string; priceAdjustmentSGD: string; spokenPrice: string }> }) => group.options);
  const egg = options.find((option: { name: string }) => /egg/i.test(option.name));
  assert.equal(egg.priceAdjustmentSGD, "+S$1.00");
  assert.equal(egg.spokenPrice, "one Singapore dollar");
  assert.equal(options.find((option: { name: string }) => /no chilli/i.test(option.name)).spokenPrice, "free");
  assert.doesNotMatch(JSON.stringify(menu), /priceCents|priceDeltaCents/);
});


test("shared modifier references preserve dish-specific price differences", async () => {
  const { fixtureMenu } = await import("../src/shared/fixtures");
  const menu = structuredClone(fixtureMenu);
  const first = menu.dishes[0];
  const second = structuredClone(first); second.id = "00000000-0000-4000-8000-000000000099";
  second.modifierGroups[0].options[0].priceDeltaCents += 100;
  menu.dishes = [first, second];
  const data = JSON.parse(handsfreeMenuInstructions(menu).split("\nPublished menu data: ")[1]);
  assert.notEqual(data.dishes[0].modifierGroups[0], data.dishes[1].modifierGroups[0]);
  assert.equal(data.dishes[0].available, first.available);
  assert.equal(data.modifierGroups[data.dishes[0].modifierGroups[0]].minSelections, first.modifierGroups[0].minSelections);
});
