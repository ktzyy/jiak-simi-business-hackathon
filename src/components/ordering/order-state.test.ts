import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/shared/api-client";
import { DEMO_MENU } from "@/shared/demo-menu";
import type { CartRequest, Ticket } from "@/shared/contracts";
import { cartProblems, definitelyNotSent, previewQuote, quoteMatchesCart, receiptMatches, savedOrderSchema } from "./order-state";

const cart: CartRequest = { restaurantId: DEMO_MENU.restaurantId, menuId: DEMO_MENU.id, menuVersion: DEMO_MENU.version, fulfillmentType: "takeaway", lines: [{ dishId: DEMO_MENU.dishes[0].id, quantity: 2, optionIds: [] }, { dishId: DEMO_MENU.dishes[1].id, quantity: 1, optionIds: [] }] };
const quote = previewQuote(DEMO_MENU, cart.lines, cart.fulfillmentType);
const key = "d98b97c0-7004-4587-8ce0-5804c0474a1a";
const ticket: Ticket = { id: "70762012-88c6-4f0a-95b4-1db4ca4195df", createdAt: "2026-09-13T01:00:00.000Z", source: "web", status: "received", statusVersion: 1, completedAt: null, paymentStatus: "unpaid", cart: quote };

test("cart quote and persisted receipt recover only with consistent restaurant, lines and totals", () => {
  assert.equal(quote.totalCents, 1400);
  assert.equal(quoteMatchesCart(cart, quote), true);
  assert.equal(receiptMatches(cart, quote, ticket), true);
  assert.equal(savedOrderSchema.safeParse({ kind: "pending", key, cart, quote }).success, true);
  assert.equal(savedOrderSchema.safeParse({ kind: "receipt", key, cart, quote, ticket }).success, true);
  assert.equal(savedOrderSchema.safeParse({ kind: "pending", key, cart, quote: { ...quote, totalCents: 1 } }).success, false);
  assert.equal(savedOrderSchema.safeParse({ kind: "pending", key, cart: { ...cart, menuVersion: 4 }, quote }).success, false);
  assert.equal(savedOrderSchema.safeParse({ kind: "receipt", key, cart, quote, ticket: { ...ticket, source: "telegram" } }).success, false);
});

test("received receipt cannot silently alter reviewed prices or contents", () => {
  const repriced = { ...quote, totalCents: 1600, lines: quote.lines.map((line, i) => i ? line : { ...line, unitPriceCents: 550, lineTotalCents: 1100 }) };
  assert.equal(quoteMatchesCart(cart, repriced), true);
  assert.equal(receiptMatches(cart, quote, { ...ticket, cart: repriced }), false);
  assert.equal(quoteMatchesCart(cart, { ...quote, lines: [...quote.lines].reverse() }), false);
});

test("missing required options, unknown options, sold out dishes and excess quantities need correction", () => {
  const menu = structuredClone(DEMO_MENU);
  menu.dishes[0].modifierGroups = [{ id: "e5f3e28f-e3e6-44a0-8d0a-bb0a276dab5b", name: "Noodle type", minSelections: 1, maxSelections: 1, options: [{ id: "534d3be6-488c-4e38-abf1-baf082b76c77", name: "Yellow noodles", priceDeltaCents: 0 }] }];
  assert.match(cartProblems(menu, cart.lines)[0], /choose 1 for Noodle type/);
  assert.deepEqual(cartProblems(menu, [{ ...cart.lines[0], optionIds: [menu.dishes[0].modifierGroups[0].options[0].id] }]), []);
  assert.match(cartProblems(DEMO_MENU, [{ ...cart.lines[0], optionIds: [key] }])[0], /options/);
  menu.dishes[0].available = false;
  assert.match(cartProblems(menu, cart.lines)[0], /no longer available/);
  assert.match(cartProblems(DEMO_MENU, [{ ...cart.lines[0], quantity: 21 }])[0], /1–20 portions/);
});

test("only explicit first-attempt rejections prove an order was not sent", () => {
  assert.equal(definitelyNotSent(new ApiError("STALE_MENU", "changed", 409, false)), true);
  assert.equal(definitelyNotSent(new ApiError("INVALID_SESSION", "expired", 401, false)), true);
  assert.equal(definitelyNotSent(new ApiError("INVALID_CONTENT_TYPE", "JSON required", 415, false)), true);
  assert.equal(definitelyNotSent(new ApiError("BODY_TOO_LARGE", "too large", 413, false)), true);
  assert.equal(definitelyNotSent(new ApiError("INVALID_MENU", "invalid price", 400, false)), true);
  assert.equal(definitelyNotSent(new ApiError("ACKNOWLEDGEMENT_UNKNOWN", "interrupted", 0, true)), false);
  assert.equal(definitelyNotSent(new ApiError("INVALID_RESPONSE", "bad receipt", 200, false)), false);
  assert.equal(definitelyNotSent(new ApiError("IDEMPOTENCY_CONFLICT", "different prior request", 409, false)), false);
  assert.equal(definitelyNotSent(new ApiError("DATABASE_ERROR", "unknown commit", 502, false)), false);
  assert.equal(definitelyNotSent(new Error("offline")), false);
});


test("fulfillment changes invalidate quotes and saved orders instead of defaulting silently", () => {
  assert.equal(quoteMatchesCart({ ...cart, fulfillmentType: "dine_in" }, quote), false);
  assert.equal(savedOrderSchema.safeParse({ kind: "pending", key, cart: { ...cart, fulfillmentType: "dine_in" }, quote }).success, false);
  const { fulfillmentType: omitted, ...missingMode } = cart;
  assert.equal(omitted, "takeaway");
  assert.equal(savedOrderSchema.safeParse({ kind: "pending", key, cart: missingMode, quote }).success, false);
  const restored = savedOrderSchema.parse({ kind: "pending", key, cart, quote });
  assert.equal(restored.cart.fulfillmentType, "takeaway");
  assert.equal(restored.key, key);
});

test("published hours retain closed days and overnight labels in weekday order", async () => {
  const { fixtureStallDetails } = await import("@/shared/stall-details");
  const { formatPublishedHours } = await import("./order-state");
  const details = structuredClone(fixtureStallDetails);
  details.weeklyHours.reverse();
  details.weeklyHours.find(day => day.weekday === 1)!.intervals = [{ opens: "22:00", closes: "02:00", closesNextDay: true }];
  const display = formatPublishedHours(details);
  assert.equal(display[0], "Monday: 22:00–02:00 (next day)");
  assert.equal(display[6], "Sunday: Closed");
});
