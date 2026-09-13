import { type Menu, type CartRequest, type Quote, type Ticket } from "./contracts";

// Synthetic contract data only. Never publish as a merchant-approved real menu.
export const fixtureMenu: Menu = {
  id: "00000000-0000-4000-8000-000000000001", restaurantId: "00000000-0000-4000-8000-000000000002", version: 1, currency: "SGD", name: "Synthetic test stall",
  dishes: [{ id: "00000000-0000-4000-8000-000000000003", name: "Test noodles", priceCents: 450, available: true, modifierGroups: [{ id: "00000000-0000-4000-8000-000000000004", name: "Portion", minSelections: 1, maxSelections: 1, options: [{ id: "00000000-0000-4000-8000-000000000005", name: "Regular", priceDeltaCents: 0 }, { id: "00000000-0000-4000-8000-000000000006", name: "Large", priceDeltaCents: 100 }] }] }],
};
export const fixtureCart: CartRequest = { restaurantId: fixtureMenu.restaurantId, menuId: fixtureMenu.id, menuVersion: 1, fulfillmentType: "dine_in", lines: [{ dishId: fixtureMenu.dishes[0].id, quantity: 2, optionIds: [fixtureMenu.dishes[0].modifierGroups[0].options[1].id] }] };
export const fixtureQuote: Quote = { restaurantId: fixtureMenu.restaurantId, menuId: fixtureMenu.id, menuVersion: 1, fulfillmentType: "dine_in", currency: "SGD", lines: [{ dishId: fixtureMenu.dishes[0].id, name: "Test noodles", quantity: 2, options: [fixtureMenu.dishes[0].modifierGroups[0].options[1]], unitPriceCents: 550, lineTotalCents: 1100 }], totalCents: 1100 };
export const fixtureTicket: Ticket = { id: "00000000-0000-4000-8000-000000000007", createdAt: "2026-09-13T03:00:00.000Z", source: "web", status: "received", statusVersion: 1, completedAt: null, paymentStatus: "unpaid", cart: fixtureQuote };
export const fixtureDoneTicket: Ticket = { ...fixtureTicket, status: "done", statusVersion: 2, completedAt: "2026-09-13T03:05:00.000Z" };
export const fixtureKitchenReceived = { orders: [fixtureTicket], counts: { received: 1, done: 0, total: 1 } };
export const fixtureKitchenDone = { orders: [fixtureDoneTicket], counts: { received: 0, done: 1, total: 1 } };
export const fixtureErrors = {
  stale: { error: { code: "STALE_MENU", message: "The menu changed. Review a new quote.", retryable: false } },
  conflict: { error: { code: "IDEMPOTENCY_CONFLICT", message: "This key was used for a different order.", retryable: false } },
  unavailable: { error: { code: "NOT_CONFIGURED", message: "This service is not configured yet.", retryable: false } },
  staleStatus: { error: { code: "STALE_STATUS", message: "This kitchen ticket changed. Refresh the queue before continuing.", retryable: false } },
};
