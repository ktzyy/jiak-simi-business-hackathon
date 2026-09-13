import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_MENU_WITH_EXTRAS } from "../src/shared/demo-menu";
import { DEMO_FULL_MENU, DEMO_FULL_MENU_PROPOSAL } from "../src/shared/demo-full-menu-proposal";
import { quoteCart } from "../src/server/orders";
const menu = DEMO_FULL_MENU;
const quote = (dishId: string, optionIds: string[] = []) => quoteCart(menu, { restaurantId: menu.restaurantId, menuId: menu.id, menuVersion: 3, fulfillmentType: "dine_in", lines: [{ dishId, quantity: 1, optionIds }] });
test("full-menu proposal preserves old identities and original unresolved evidence", () => {
  assert.equal(menu.dishes.length, 10);
  assert.equal(DEMO_FULL_MENU_PROPOSAL.dishes.find(d => d.name === "Wanton Soup")?.priceCents, null);
  assert.equal(menu.dishes.find(d => d.name === "Wanton Soup")?.priceCents, 400);
  for (const old of DEMO_MENU_WITH_EXTRAS.dishes) {
    const next = menu.dishes.find(d => d.id === old.id)!;
    for (const option of old.modifierGroups.flatMap(g => g.options)) assert.ok(next.modifierGroups.flatMap(g => g.options).some(o => o.id === option.id && o.priceDeltaCents === option.priceDeltaCents));
  }
});
test("all proposed photo extras and separate Shao Rou price correctly on ten dishes", () => {
  for (const dish of menu.dishes) {
    const extras = dish.modifierGroups.find(g => g.name === "Additional Ingredients")!;
    const required = dish.modifierGroups.filter(g => g.minSelections === 1).map(g => g.options[0].id);
    assert.equal(extras.options.length, 12);
    assert.equal(extras.options.find(o => o.name === "Rice")?.priceDeltaCents, 50);
    for (const option of extras.options) assert.equal(quote(dish.id, [...required, option.id]).totalCents, dish.priceCents + option.priceDeltaCents);
  }
});
test("noodle type is required, single and free; chilli remains mutually exclusive", () => {
  const chicken = menu.dishes.find(d => d.name === "Chicken Feet Noodle / Hor Fun")!;
  assert.throws(() => quote(chicken.id), /Check selections/);
  for (const option of chicken.modifierGroups[0].options) assert.equal(quote(chicken.id, [option.id]).totalCents, 450);
  assert.throws(() => quote(chicken.id, chicken.modifierGroups[0].options.map(o => o.id)), /Check selections/);
  const rice = menu.dishes.find(d => d.name === "Char Siew Rice")!;
  assert.throws(() => quote(rice.id, rice.modifierGroups[1].options.map(o => o.id)), /Check selections/);
  const pork = menu.dishes.find(d => d.name === "Braised Pork Knuckle Rice")!;
  assert.equal(2 * quote(rice.id).totalCents + quote(pork.id).totalCents, 1400);
});
