import { z } from "zod";
import { ApiError } from "@/shared/api-client";
import { CartRequestSchema, QuoteSchema, TicketSchema, type CartRequest, type Menu, type Quote, type Ticket } from "@/shared/contracts";

export const money = (cents: number) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(cents / 100);

export function quoteMatchesCart(cart: CartRequest, quote: Quote): boolean {
  return cart.restaurantId === quote.restaurantId && cart.menuId === quote.menuId && cart.menuVersion === quote.menuVersion &&
    cart.lines.length === quote.lines.length && quote.totalCents === quote.lines.reduce((sum, line) => sum + line.lineTotalCents, 0) &&
    cart.lines.every((line, i) => {
      const priced = quote.lines[i];
      return line.dishId === priced.dishId && line.quantity === priced.quantity && priced.lineTotalCents === priced.unitPriceCents * priced.quantity &&
        new Set(line.optionIds).size === line.optionIds.length && line.optionIds.length === priced.options.length &&
        new Set(priced.options.map(option => option.id)).size === priced.options.length && line.optionIds.every(id => priced.options.some(option => option.id === id));
    });
}

const pendingSchema = z.strictObject({ kind: z.literal("pending"), key: z.uuid(), cart: CartRequestSchema, quote: QuoteSchema });
const receiptSchema = z.strictObject({ kind: z.literal("receipt"), key: z.uuid(), cart: CartRequestSchema, quote: QuoteSchema, ticket: TicketSchema });
export const savedOrderSchema = z.discriminatedUnion("kind", [pendingSchema, receiptSchema]).superRefine((saved, ctx) => {
  if (!quoteMatchesCart(saved.cart, saved.quote) || (saved.kind === "receipt" && !receiptMatches(saved.cart, saved.quote, saved.ticket))) {
    ctx.addIssue({ code: "custom", message: "Stored order details do not match." });
  }
});
export type PendingOrder = z.infer<typeof pendingSchema>;
export type SavedOrder = z.infer<typeof savedOrderSchema>;

export function receiptMatches(cart: CartRequest, quote: Quote, ticket: Ticket): boolean {
  return ticket.source === "web" && quoteMatchesCart(cart, ticket.cart) && JSON.stringify(ticket.cart) === JSON.stringify(quote);
}

// Only explicit rejection codes prove that this first attempt did not place an order.
// A rejection after an uncertain attempt never proves that the earlier attempt failed.
export function definitelyNotSent(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && new Set([
    "NOT_SENT", "STALE_MENU", "PRICE_CHANGED", "INVALID_CART", "INVALID_QUANTITY", "UNKNOWN_DISH", "UNKNOWN_OPTION", "INVALID_MODIFIERS", "INVALID_OPTIONS",
    "INVALID_REQUEST", "DISH_UNAVAILABLE", "INVALID_SESSION", "SESSION_EXPIRED", "ORIGIN_REJECTED", "RATE_LIMITED", "UNKNOWN_MENU", "MENU_NOT_FOUND", "RESTAURANT_NOT_FOUND",
    // Route body guards and the transactional price check all precede inserting an order.
    "INVALID_CONTENT_TYPE", "BODY_TOO_LARGE", "INVALID_MENU",
  ]).has(error.code);
}

export function cartProblems(menu: Menu, lines: CartRequest["lines"]): string[] {
  const issues: string[] = [];
  if (lines.length > 50) issues.push("Please keep this order to 50 different items or fewer.");
  lines.forEach((line, index) => {
    const dish = menu.dishes.find(item => item.id === line.dishId);
    if (!dish || !dish.available) { issues.push(`Item ${index + 1} is no longer available. Please remove it.`); return; }
    if (line.quantity < 1 || line.quantity > 20) issues.push(`Choose 1–20 portions of ${dish.name}.`);
    const options = dish.modifierGroups.flatMap(group => group.options);
    if (new Set(line.optionIds).size !== line.optionIds.length || line.optionIds.some(id => !options.some(option => option.id === id))) issues.push(`Please check the options for ${dish.name}.`);
    for (const group of dish.modifierGroups) {
      const count = group.options.filter(option => line.optionIds.includes(option.id)).length;
      if (count < group.minSelections || count > group.maxSelections) issues.push(`${dish.name}: choose ${group.minSelections === group.maxSelections ? group.minSelections : `${group.minSelections}–${group.maxSelections}`} for ${group.name}.`);
    }
    const unit = dish.priceCents + options.filter(option => line.optionIds.includes(option.id)).reduce((sum, option) => sum + option.priceDeltaCents, 0);
    if (unit < 0 || unit > 1_000_000) issues.push(`Please ask the stall to check the price of ${dish.name}.`);
  });
  return issues;
}

/** Display estimate only. Real orders always use the shared client's server quote. */
export function previewQuote(menu: Menu, lines: CartRequest["lines"]): Quote {
  const quotedLines = lines.map(line => {
    const dish = menu.dishes.find(item => item.id === line.dishId)!;
    const options = dish.modifierGroups.flatMap(group => group.options).filter(option => line.optionIds.includes(option.id));
    const unitPriceCents = dish.priceCents + options.reduce((sum, option) => sum + option.priceDeltaCents, 0);
    return { dishId: dish.id, name: dish.name, quantity: line.quantity, options, unitPriceCents, lineTotalCents: unitPriceCents * line.quantity };
  });
  return { restaurantId: menu.restaurantId, menuId: menu.id, menuVersion: menu.version, currency: "SGD", lines: quotedLines, totalCents: quotedLines.reduce((sum, line) => sum + line.lineTotalCents, 0) };
}
