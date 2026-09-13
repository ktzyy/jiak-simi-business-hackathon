import test from "node:test";
import assert from "node:assert/strict";
import { quoteCart, cartFingerprint } from "../src/server/orders";
import { fixtureCart, fixtureMenu, fixtureQuote } from "../src/shared/fixtures";
import { ApiError, createApiClient } from "../src/shared/api-client";

test("canonical server quote uses approved prices and modifiers", () => assert.deepEqual(quoteCart(fixtureMenu, fixtureCart), fixtureQuote));
test("tampered price, quantity, stale menu, unknown dishes and conflicting options fail", () => {
  for (const input of [
    { ...fixtureCart, totalCents: 1 }, { ...fixtureCart, menuVersion: 2 },
    { ...fixtureCart, lines: [{ ...fixtureCart.lines[0], quantity: -1 }] },
    { ...fixtureCart, lines: [{ ...fixtureCart.lines[0], dishId: fixtureMenu.id }] },
    { ...fixtureCart, lines: [{ ...fixtureCart.lines[0], optionIds: [] }] },
    { ...fixtureCart, lines: [{ ...fixtureCart.lines[0], optionIds: fixtureMenu.dishes[0].modifierGroups[0].options.map(o => o.id) }] },
    { ...fixtureCart, lines: [{ ...fixtureCart.lines[0], optionIds: [fixtureMenu.id] }] },
  ]) assert.throws(() => quoteCart(fixtureMenu, input));
});
test("idempotency payload distinguishes quantity and trusted channel", () => {
  assert.notEqual(cartFingerprint(fixtureCart, "web"), cartFingerprint(fixtureCart, "voice"));
  assert.notEqual(cartFingerprint(fixtureCart, "web"), cartFingerprint({ ...fixtureCart, lines: [{ ...fixtureCart.lines[0], quantity: 1 }] }, "web"));
});
test("network interruption never silently retries or reports an order as not sent", async () => {
  let calls = 0;
  const client = createApiClient("", async () => { calls++; throw new Error("offline"); });
  await assert.rejects(client.submit({ cart: fixtureCart, reviewedTotalCents: 1100, confirmed: true }, fixtureMenu.id), (e: unknown) => e instanceof ApiError && e.code === "ACKNOWLEDGEMENT_UNKNOWN");
  assert.equal(calls, 1);
});

test("OCR sends raw photo bytes with staff authorization and does not retry unknown uploads", async () => {
  const photo = new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" });
  let calls = 0;
  const client = createApiClient("", async (url, init) => {
    calls++;
    assert.equal(url, "/api/v1/menu-extractions");
    assert.equal(init?.body, photo);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer staff-test-jwt");
    assert.equal(headers.get("x-restaurant-id"), fixtureMenu.restaurantId);
    assert.equal(headers.get("content-type"), "image/jpeg");
    throw new Error("connection interrupted after upload");
  });
  await assert.rejects(client.extract(photo, fixtureMenu.restaurantId, "staff-test-jwt"), (error: unknown) => error instanceof ApiError && error.code === "ACKNOWLEDGEMENT_UNKNOWN" && !error.retryable);
  assert.equal(calls, 1);
});

test("voice confirmation preserves its nonce across explicit retry after an unknown acknowledgement", async () => {
  const bodies: unknown[] = [];
  const client = createApiClient("", async (url, init) => {
    assert.equal(url, "/api/v1/live/orders");
    bodies.push(JSON.parse(init?.body as string));
    throw new Error("connection interrupted after commit");
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(client.confirmVoiceOrder(fixtureMenu.id, fixtureMenu.restaurantId, "staff-test-jwt"), (error: unknown) => error instanceof ApiError && error.retryable);
  }
  assert.deepEqual(bodies, [0, 1].map(() => ({ voiceSessionId: fixtureMenu.id, confirmationNonce: fixtureMenu.restaurantId, confirmed: true })));
});
