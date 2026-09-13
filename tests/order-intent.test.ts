import test from "node:test";
import assert from "node:assert/strict";
import { parseOrderIntent } from "../src/server/ai/order-intent";
import { fixtureCart, fixtureMenu } from "../src/shared/fixtures";

const reply = (value: unknown) => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] }), { status: 200 });
test("parse retains clarification and never confers order or price authority", async () => {
  const result = await parseOrderIntent(fixtureMenu, "two large noodles, more vinegar, takeaway", { apiKey: "test", fetch: async () => reply({ fulfillmentType: "takeaway", lines: fixtureCart.lines, issues: [{ code: "UNSUPPORTED_OPTION", message: "More vinegar is not approved.", lineIndex: 0 }] }) });
  assert.equal(result.issues.length, 1); assert.equal(result.menuVersion, fixtureMenu.version); assert.equal("totalCents" in result, false);
});
test("invented dish IDs produce a deterministic blocking issue", async () => {
  const result = await parseOrderIntent(fixtureMenu, "noodles takeaway", { apiKey: "test", fetch: async () => reply({ fulfillmentType: "takeaway", lines: [{ ...fixtureCart.lines[0], dishId: fixtureMenu.id }], issues: [] }) });
  assert.equal(result.issues[0].code, "UNKNOWN_DISH");
});
test("model-supplied prices fail strict schema and stop after bounded retry", async () => {
  let attempts = 0;
  await assert.rejects(parseOrderIntent(fixtureMenu, "noodles takeaway", { apiKey: "test", fetch: async () => { attempts++; return reply({ fulfillmentType: "takeaway", lines: fixtureCart.lines, issues: [], totalCents: 1 }); } }));
  assert.equal(attempts, 2);
});


test("mode is never defaulted from a model guess or conflicting customer wording", async () => {
  for (const text of ["two large noodles", "two large noodles dine in or takeaway", "two large noodles not takeaway"]) {
    const result = await parseOrderIntent(fixtureMenu, text, { apiKey: "test", fetch: async () => reply({ fulfillmentType: "takeaway", lines: fixtureCart.lines, issues: [] }) });
    assert.equal(result.fulfillmentType, null);
    assert.ok(result.issues.some(issue => issue.code === "FULFILLMENT_REQUIRED"));
  }
});

test("explicit mode is preserved and a model's conflicting choice stays unresolved", async () => {
  const accepted = await parseOrderIntent(fixtureMenu, "two large noodles dine in", { apiKey: "test", fetch: async () => reply({ fulfillmentType: "dine_in", lines: fixtureCart.lines, issues: [] }) });
  assert.equal(accepted.fulfillmentType, "dine_in");
  assert.equal(accepted.issues.length, 0);
  const mismatch = await parseOrderIntent(fixtureMenu, "two large noodles dine in", { apiKey: "test", fetch: async () => reply({ fulfillmentType: "takeaway", lines: fixtureCart.lines, issues: [] }) });
  assert.equal(mismatch.fulfillmentType, null);
  assert.ok(mismatch.issues.some(issue => issue.code === "FULFILLMENT_REQUIRED"));
});


test("explicit selector resolves omitted spoken mode but never overrides conflicting speech", async () => {
  const fetch = async () => reply({ fulfillmentType: null, lines: fixtureCart.lines, issues: [] });
  const chosen = await parseOrderIntent(fixtureMenu, "two large noodles", { apiKey: "test", fetch, fulfillmentType: "takeaway" });
  assert.equal(chosen.fulfillmentType, "takeaway");
  assert.equal(chosen.issues.length, 0);
  const conflict = await parseOrderIntent(fixtureMenu, "two large noodles dine in", { apiKey: "test", fetch, fulfillmentType: "takeaway" });
  assert.equal(conflict.fulfillmentType, null);
  assert.ok(conflict.issues.some(issue => issue.code === "FULFILLMENT_REQUIRED"));
});

const eggId = "00000000-0000-4000-8000-000000000030";
const menuWithEgg = structuredClone(fixtureMenu);
menuWithEgg.dishes[0].modifierGroups.push({ id: "00000000-0000-4000-8000-000000000031", name: "Extras", minSelections: 0, maxSelections: 1, options: [{ id: eggId, name: "Egg", priceDeltaCents: 50 }] });

test("follow-up sends structured current cart and preserves quantities and fulfillment", async () => {
  const onePlate = { ...fixtureCart, lines: [{ ...fixtureCart.lines[0], quantity: 1 }] };
  const result = await parseOrderIntent(menuWithEgg, "can i add egg as well", { apiKey: "test", cartContext: onePlate, fetch: async (_url, request) => {
    const body = JSON.parse(String(request!.body));
    const data = JSON.parse(body.input[0].content[0].text);
    assert.deepEqual(data.currentCart, onePlate);
    assert.equal(data.customerRequest, "can i add egg as well");
    return reply({ fulfillmentType: null, lines: [{ ...onePlate.lines[0], optionIds: [...onePlate.lines[0].optionIds, eggId] }], issues: [] });
  } });
  assert.equal(result.fulfillmentType, onePlate.fulfillmentType);
  assert.equal(result.lines[0].quantity, 1);
  assert.ok(result.lines[0].optionIds.includes(eggId));
  assert.equal(result.issues.length, 0);
});

test("egg follow-up with two plates cannot silently charge both or discard a plate", async () => {
  const both = await parseOrderIntent(menuWithEgg, "can i add egg as well", { apiKey: "test", cartContext: fixtureCart, fetch: async () => reply({ fulfillmentType: null, lines: [{ ...fixtureCart.lines[0], optionIds: [...fixtureCart.lines[0].optionIds, eggId] }], issues: [] }) });
  assert.equal(both.fulfillmentType, fixtureCart.fulfillmentType);
  assert.ok(both.issues.some(issue => issue.code === "EDIT_SCOPE_REQUIRED"));
  const dropped = await parseOrderIntent(menuWithEgg, "add egg to one plate", { apiKey: "test", cartContext: fixtureCart, fetch: async () => reply({ fulfillmentType: null, lines: [{ ...fixtureCart.lines[0], quantity: 1, optionIds: [...fixtureCart.lines[0].optionIds, eggId] }], issues: [] }) });
  assert.ok(dropped.issues.some(issue => issue.code === "EDIT_CHANGED_QUANTITIES"));
  const overApplied = await parseOrderIntent(menuWithEgg, "add egg to one plate", { apiKey: "test", cartContext: fixtureCart, fetch: async () => reply({ fulfillmentType: null, lines: [{ ...fixtureCart.lines[0], optionIds: [...fixtureCart.lines[0].optionIds, eggId] }], issues: [] }) });
  assert.ok(overApplied.issues.some(issue => issue.code === "EDIT_SCOPE_MISMATCH"));
});

test("one-plate extra splits quantity without losing the other plate; unsupported extras remain issues", async () => {
  const result = await parseOrderIntent(menuWithEgg, "add egg to one plate", { apiKey: "test", cartContext: fixtureCart, fetch: async () => reply({ fulfillmentType: null, lines: [
    { ...fixtureCart.lines[0], quantity: 1, optionIds: [...fixtureCart.lines[0].optionIds, eggId] },
    { ...fixtureCart.lines[0], quantity: 1 },
  ], issues: [] }) });
  assert.equal(result.issues.length, 0);
  assert.equal(result.lines.reduce((count, line) => count + line.quantity, 0), 2);
  const ignored = await parseOrderIntent(fixtureMenu, "add an egg as well", { apiKey: "test", cartContext: fixtureCart, fetch: async () => reply({ fulfillmentType: null, lines: fixtureCart.lines, issues: [] }) });
  assert.ok(ignored.issues.some(issue => issue.code === "EDIT_NOT_APPLIED"));
});

test("published demo extras and free no-chilli use saved option IDs and server prices", async () => {
  const { DEMO_MENU_WITH_EXTRAS } = await import("../src/shared/demo-menu");
  const { quoteCart } = await import("../src/server/orders");
  const dish = DEMO_MENU_WITH_EXTRAS.dishes[0];
  const egg = dish.modifierGroups.flatMap(group => group.options).find(option => option.name === "Egg")!;
  const noChilli = dish.modifierGroups.flatMap(group => group.options).find(option => option.name === "No chilli")!;
  const previous = { restaurantId: DEMO_MENU_WITH_EXTRAS.restaurantId, menuId: DEMO_MENU_WITH_EXTRAS.id, menuVersion: DEMO_MENU_WITH_EXTRAS.version, fulfillmentType: "takeaway" as const, lines: [{ dishId: dish.id, quantity: 1, optionIds: [] }] };
  const intent = await parseOrderIntent(DEMO_MENU_WITH_EXTRAS, "add egg and no chilli", { apiKey: "test", cartContext: previous, fetch: async () => reply({ fulfillmentType: null, lines: [{ ...previous.lines[0], optionIds: [egg.id, noChilli.id] }], issues: [] }) });
  assert.equal(intent.issues.length, 0);
  assert.equal(intent.fulfillmentType, "takeaway");
  const quote = quoteCart(DEMO_MENU_WITH_EXTRAS, { ...previous, lines: intent.lines });
  assert.equal(quote.totalCents, dish.priceCents + 100);
  assert.equal(quote.lines[0].options.find(option => option.id === noChilli.id)!.priceDeltaCents, 0);
});


test("validated cart mode removes only stale missing-mode clarification on short follow-up", async () => {
  const previous = { ...fixtureCart, lines: [{ ...fixtureCart.lines[0], quantity: 1 }] };
  const result = await parseOrderIntent(menuWithEgg, "can i add egg as well", { apiKey: "test", cartContext: previous, fetch: async () => reply({ fulfillmentType: null, lines: [{ ...previous.lines[0], optionIds: [...previous.lines[0].optionIds, eggId] }], issues: [
    { code: "FULFILLMENT_REQUIRED", message: "Dine in or takeaway?", lineIndex: null },
    { code: "OTHER_CLARIFICATION", message: "Check this separate request.", lineIndex: 0 },
  ] }) });
  assert.equal(result.fulfillmentType, previous.fulfillmentType);
  assert.deepEqual(result.issues.map(issue => issue.code), ["OTHER_CLARIFICATION"]);
  const conflicting = await parseOrderIntent(menuWithEgg, "add egg dine in or takeaway", { apiKey: "test", cartContext: previous, fetch: async () => reply({ fulfillmentType: null, lines: previous.lines, issues: [{ code: "FULFILLMENT_REQUIRED", message: "Choose one mode.", lineIndex: null }] }) });
  assert.equal(conflicting.fulfillmentType, null);
  assert.ok(conflicting.issues.some(issue => issue.code === "FULFILLMENT_REQUIRED"));
});
