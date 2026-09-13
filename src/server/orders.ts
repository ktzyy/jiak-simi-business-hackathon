import { createHash } from "node:crypto";
import { CartRequestSchema, MenuSchema, type Menu, type Quote } from "../shared/contracts";

export class OrderValidationError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const reject = (code: string, message: string): never => { throw new OrderValidationError(code, message); };

// Call with a menu loaded by the server, never one supplied with the customer request.
export function quoteCart(approvedMenu: Menu, input: unknown): Quote {
  const menu = MenuSchema.parse(approvedMenu);
  const parsed = CartRequestSchema.safeParse(input);
  if (!parsed.success) return reject("INVALID_CART", "Cart has invalid fields, quantities or supplied prices.");
  const cart = parsed.data;
  if (cart.restaurantId !== menu.restaurantId || cart.menuId !== menu.id) return reject("UNKNOWN_MENU", "Menu does not belong to this restaurant.");
  if (cart.menuVersion !== menu.version) return reject("STALE_MENU", "The menu changed. Review a new quote.");
  const lines = cart.lines.map(line => {
    const dish = menu.dishes.find(d => d.id === line.dishId);
    if (!dish || !dish.available) return reject("UNKNOWN_DISH", "Dish is not available on this menu.");
    const selected = new Set(line.optionIds);
    if (selected.size !== line.optionIds.length) return reject("INVALID_OPTIONS", "An option may only be selected once.");
    const options = dish.modifierGroups.flatMap(group => {
      if (group.minSelections > group.maxSelections || group.maxSelections > group.options.length) return reject("INVALID_MENU", "Merchant must correct modifier limits.");
      const chosen = group.options.filter(o => selected.has(o.id));
      if (chosen.length < group.minSelections || chosen.length > group.maxSelections) return reject("INVALID_OPTIONS", `Check selections for ${group.name}.`);
      return chosen;
    });
    if (options.length !== selected.size) return reject("UNKNOWN_OPTION", "An option is not approved for this dish.");
    const unitPriceCents = dish.priceCents + options.reduce((sum, o) => sum + o.priceDeltaCents, 0);
    if (unitPriceCents < 0 || unitPriceCents > 1_000_000) return reject("INVALID_MENU", "Merchant must correct this price.");
    return { dishId: dish.id, name: dish.name, quantity: line.quantity, options, unitPriceCents, lineTotalCents: unitPriceCents * line.quantity };
  });
  return { restaurantId: menu.restaurantId, menuId: menu.id, menuVersion: menu.version, fulfillmentType: cart.fulfillmentType, currency: "SGD", lines, totalCents: lines.reduce((sum, l) => sum + l.lineTotalCents, 0) };
}

// Scope a database uniqueness constraint by restaurant + trusted session + key.
// This hash is not persistence or an idempotency implementation by itself.
export function cartFingerprint(input: unknown, source: "web" | "whatsapp" | "telegram" | "voice"): string {
  const cart = CartRequestSchema.parse(input);
  const lines = cart.lines.map(l => ({ ...l, optionIds: [...l.optionIds].sort() }));
  return createHash("sha256").update(JSON.stringify({ ...cart, lines, source })).digest("hex");
}
