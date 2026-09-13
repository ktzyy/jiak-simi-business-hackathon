import assert from "node:assert/strict";
import test from "node:test";
import { fixtureTicket } from "@/shared/fixtures";
import { activeQueue, completedRecordMatches, completionRecordSchema, selectQueueOrder } from "./queue-state";

const record = { input: { restaurantId: fixtureTicket.cart.restaurantId, orderId: fixtureTicket.id, expectedStatusVersion: 1 }, key: "70000000-0000-4000-8000-000000000001", uncertain: true };
const done = { ...fixtureTicket, status: "done" as const, statusVersion: 2, completedAt: "2026-09-13T04:00:00.000Z" };

test("unknown completion survives reload with the exact key and expected version", () => {
  const restored = completionRecordSchema.parse(JSON.parse(JSON.stringify(record)));
  assert.equal(restored.key, record.key);
  assert.equal(restored.input.expectedStatusVersion, 1);
  assert.equal(completedRecordMatches(restored, fixtureTicket), false);
  assert.equal(completedRecordMatches(restored, done), true);
  assert.equal(completedRecordMatches(restored, { ...done, cart: { ...done.cart, restaurantId: "90000000-0000-4000-8000-000000000001" } }), false);
  assert.equal(completedRecordMatches(restored, { ...done, statusVersion: 1 }), false);
});

test("queue advances only when refreshed data marks selected order done", () => {
  const next = { ...fixtureTicket, id: "80000000-0000-4000-8000-000000000001", createdAt: "2026-09-13T05:00:00.000Z" };
  assert.equal(selectQueueOrder([next, fixtureTicket], fixtureTicket.id), fixtureTicket.id);
  assert.equal(selectQueueOrder([next, done], fixtureTicket.id), next.id);
  assert.deepEqual(activeQueue([done]), []);
  assert.equal(selectQueueOrder([done], fixtureTicket.id), null);
  assert.equal(done.paymentStatus, "unpaid");
});
