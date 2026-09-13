import assert from "node:assert/strict";
import test from "node:test";
import { cleanDemoAddons, cleanDemoDishes, demoMenu } from "../src/components/onboarding/demo-draft";
import { applyGlobalAddons, type DishEdit, type GroupEdit } from "../src/components/onboarding/review-state";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dish = (n = 1, patch: Partial<DishEdit> = {}): DishEdit => ({ id: id(n), name: "Char Siew Rice", price: "4.50", available: true, included: true, confirmed: false, reason: "", groups: [], ...patch });
const group = (patch: Partial<GroupEdit> = {}): GroupEdit => ({ id: id(20), name: "Extras", min: "0", max: "2", options: [{ id: id(21), name: "Egg", price: "1.00" }, { id: id(22), name: "Vegetable", price: "" }], ...patch });
const metadata = { id: id(90), restaurantId: id(91), version: 1, name: "Demo" };

test("demo skips unreadable or excluded dishes without inventing prices or mutating the draft", () => {
  const rows = [dish(), dish(2, { name: "Missing price", price: "" }), dish(3, { name: "", price: "5.00" }), dish(4, { included: false }), dish(5, { name: "Free sample", price: "0" })];
  const snapshot = structuredClone(rows);
  const clean = cleanDemoDishes(rows);
  assert.deepEqual(clean.dishes.map(d => d.id), [id(1), id(5)]);
  assert.equal(clean.skipped.length, 3);
  assert.equal(clean.dishes[0].confirmed, true);
  assert.match(clean.dishes[0].reason, /Automated demo/);
  assert.deepEqual(rows, snapshot);
  assert.deepEqual(demoMenu({ ...metadata, dishes: rows }).dishes.map(d => d.priceCents), [450, 0]);
});

test("optional unreadable options are removed while readable extras retain their exact price", () => {
  const clean = cleanDemoDishes([dish(1, { groups: [group()] })]);
  assert.equal(clean.dishes[0].groups[0].options.length, 1);
  assert.equal(clean.dishes[0].groups[0].max, "1");
  assert.equal(demoMenu({ ...metadata, dishes: clean.dishes }).dishes[0].modifierGroups[0].options[0].priceDeltaCents, 100);
  assert.ok(clean.skipped.some(name => name.includes("Vegetable")));
});

test("invalid optional rules can be skipped but missing required choices remove the dish", () => {
  const clean = cleanDemoDishes([
    dish(1, { groups: [group({ max: "?" })] }),
    dish(2, { groups: [group({ min: "2", max: "2" })] }),
    dish(3, { groups: [group({ min: "", max: "1" })] }),
    dish(4, { groups: [group({ min: "1", max: "1" })] }),
  ]);
  assert.deepEqual(clean.dishes.map(d => d.id), [id(1), id(4)]);
  assert.deepEqual(clean.dishes[0].groups, []);
  assert.equal(clean.dishes[1].groups[0].min, "1");
});

test("all readable shared add-ons can be applied across every included dish", () => {
  const rows = [
    { id: id(30), name: "Egg", price: "1.00", included: true, sourceIds: [] },
    { id: id(31), name: "Chicken Feet", price: "2.00", included: true, sourceIds: [] },
    { id: id(32), name: "Vegetable", price: "", included: true, sourceIds: [] },
    { id: id(33), name: " egg ", price: "1.00", included: true, sourceIds: [] },
    { id: id(34), name: "Chilli", price: "0", included: true, sourceIds: [] },
  ];
  const extras = cleanDemoAddons(rows);
  assert.deepEqual(extras.map(row => row.name), ["Egg", "Chicken Feet", "Chilli"]);
  const applied = applyGlobalAddons([dish(1), dish(2)], extras, id(40));
  const menu = demoMenu({ ...metadata, dishes: applied.dishes });
  for (const entry of menu.dishes) assert.deepEqual(entry.modifierGroups[0].options.map(o => o.priceDeltaCents), [100, 200, 0]);
});

test("empty cleanup gives a clear retry message and does not bypass menu identity validation", () => {
  assert.throws(() => demoMenu({ ...metadata, dishes: [dish(1, { price: "?" })] }), /No readable dishes/);
  assert.throws(() => demoMenu({ ...metadata, id: "bad", dishes: [dish()] }));
  assert.equal(demoMenu({ ...metadata, dishes: [dish(), dish()] }).dishes.length, 1);
});
