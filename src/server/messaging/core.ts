import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CartRequestSchema, QuoteSchema, TicketSchema, type CartRequest, type Intent, type Menu, type Quote, type Ticket } from "../../shared/contracts";
import { HttpError } from "../http";
import { OrderIntentError } from "../ai/order-intent";

export const MessagingStateSchema = z.strictObject({
  version: z.literal(1),
  pending: z.strictObject({ cart: CartRequestSchema, quote: QuoteSchema, confirmationNonce: z.uuid(), idempotencyKey: z.uuid() }).nullable(),
  lastTicket: TicketSchema.nullable(),
});
export type MessagingState = z.infer<typeof MessagingStateSchema>;
export const MessagingReplySchema = z.strictObject({ text: z.string().min(1).max(4000), confirmationNonce: z.uuid().nullable() });
export type MessagingReply = z.infer<typeof MessagingReplySchema>;
export type IncomingMessage = { updateId: string; recipientId: string } & ({ kind: "text"; text: string } | { kind: "confirm"; nonce: string } | { kind: "unsupported" });
export type MessagingBinding = { provider: "telegram" | "whatsapp"; accountId: string; restaurantId: string };
export type Claim = { status: "claimed" | "duplicate" | "busy"; conversationId: string; leaseId: string | null; state: MessagingState | null; sessionTokenHash: string | null };
export interface MessagingStore {
  claim(binding: MessagingBinding, incoming: IncomingMessage): Promise<Claim>;
  complete(conversationId: string, leaseId: string, updateId: string, state: MessagingState, reply: MessagingReply): Promise<void>;
  submit(conversationId: string, leaseId: string, updateId: string, nonce: string): Promise<Ticket>;
  claimReply(conversationId: string, updateId: string): Promise<{ status: "claimed" | "already_attempted"; reply: MessagingReply | null }>;
  finishReply(conversationId: string, updateId: string, status: "sent" | "unknown" | "not_sent", providerMessageId: string | null): Promise<void>;
}
export type SendResult = { status: "sent" | "unknown" | "not_sent"; providerMessageId: string | null };
export interface MessagingDependencies {
  store: MessagingStore;
  readMenu(restaurantId: string): Promise<Menu>;
  parseIntent(menu: Menu, text: string, sessionTokenHash: string): Promise<Intent>;
  quote(sessionTokenHash: string, cart: CartRequest): Promise<Quote>;
  send(recipientId: string, reply: MessagingReply): Promise<SendResult>;
}
const emptyState = (): MessagingState => ({ version: 1, pending: null, lastTicket: null });
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
function receipt(ticket: Ticket): MessagingReply {
  return { text: `Order ${ticket.id} received. Total ${money(ticket.cart.totalCents)}. Payment: unpaid. Please pay the stall separately.`, confirmationNonce: null };
}
function quoteReply(quote: Quote, nonce: string): MessagingReply {
  const lines = quote.lines.map((line) => `${line.quantity} × ${line.name}${line.options.length ? ` (${line.options.map(option => option.name).join(", ")})` : ""}: ${money(line.lineTotalCents)}`);
  return MessagingReplySchema.parse({ text: `Please check your order:\n${lines.join("\n")}\nTotal: ${money(quote.totalCents)}\nTap Place order below to send this unpaid order to the kitchen. To change it, send your complete revised order. /cancel clears this draft.`, confirmationNonce: nonce });
}

async function transition(binding: MessagingBinding, incoming: IncomingMessage, claim: Claim, deps: MessagingDependencies): Promise<{ state: MessagingState; reply: MessagingReply }> {
  const state = claim.state ? MessagingStateSchema.parse(claim.state) : emptyState();
  if (incoming.kind === "confirm") {
    // DB validates the lease and persisted nonce, recalculates current-menu prices,
    // and submits atomically with the persisted key. The model cannot invoke this.
    try {
      const ticket = await deps.store.submit(claim.conversationId, claim.leaseId!, incoming.updateId, incoming.nonce);
      return { state: { version: 1, pending: null, lastTicket: ticket }, reply: receipt(ticket) };
    } catch (error) {
      if (error instanceof HttpError && error.code === "STALE_REVIEW") return { state, reply: { text: "This confirmation is no longer current. Send your complete order for a fresh review, or /status for your last receipt.", confirmationNonce: null } };
      if (error instanceof HttpError && ["STALE_MENU", "PRICE_CHANGED", "UNKNOWN_DISH", "DISH_UNAVAILABLE", "INVALID_OPTIONS", "INVALID_MODIFIERS", "SESSION_EXPIRED"].includes(error.code)) {
        return { state: { ...state, pending: null }, reply: { text: "The menu or ordering session changed. Send your complete order again to review a fresh quote before placing it.", confirmationNonce: null } };
      }
      // Unknown commit outcome: preserve the original quote/key and let the same
      // provider update recover; never tell the customer it definitely failed.
      throw error;
    }
  }
  if (incoming.kind === "unsupported") return { state, reply: { text: "Please send your order as text. Photos, voice notes and group orders aren't supported here yet.", confirmationNonce: null } };
  const text = incoming.text.trim();
  if (text === "/status") return { state, reply: state.lastTicket ? receipt(state.lastTicket) : state.pending ? quoteReply(state.pending.quote, state.pending.confirmationNonce) : { text: "You have no confirmed order in this session. Send /menu to start.", confirmationNonce: null } };
  if (text === "/cancel") return { state: { ...state, pending: null }, reply: { text: "Draft cleared. This doesn't cancel an order already sent to the kitchen.", confirmationNonce: null } };
  if (text === "/start" || text === "/menu") {
    const menu = await deps.readMenu(binding.restaurantId);
    const dishLines = menu.dishes.filter(dish => dish.available).slice(0, 15).map(dish => `${dish.name}: ${money(dish.priceCents)}${dish.modifierGroups.length ? `; options: ${dish.modifierGroups.map(group => `${group.name} (${group.minSelections}–${group.maxSelections}): ${group.options.map(option => `${option.name} ${option.priceDeltaCents >= 0 ? "+" : "-"}${money(Math.abs(option.priceDeltaCents))}`).join(", ")}`).join("; ")}` : ""}`);
    const text = `${menu.name}\n${dishLines.join("\n")}\nSend your complete order with quantities and options. We'll show the total before you place it.`;
    return { state, reply: { text: text.length <= 4000 ? text : `${menu.name}\nSend the dish names, quantities and options from the stall's menu. We'll check availability and show the total before you place it.`, confirmationNonce: null } };
  }
  // Each text message replaces the draft, avoiding accidental accumulation or
  // silently treating a fragment like "yes" as approval of old contents.
  const cleared = { ...state, pending: null };
  if (!text || text.length > 4000) return { state: cleared, reply: { text: "Please send your complete order in at most 4,000 characters.", confirmationNonce: null } };
  const menu = await deps.readMenu(binding.restaurantId);
  let intent: Intent;
  try { intent = await deps.parseIntent(menu, text, claim.sessionTokenHash!); }
  catch (error) {
    if (error instanceof HttpError && error.code === "RATE_LIMITED") return { state: cleared, reply: { text: "Please wait a few minutes before sending another order. Your draft has not been placed.", confirmationNonce: null } };
    if (!(error instanceof OrderIntentError)) throw error;
    return { state: cleared, reply: { text: "I couldn’t check that order just now. Please send your complete order again. Your draft has not been placed.", confirmationNonce: null } };
  }
  if (intent.issues.length || !intent.lines.length) return { state: cleared, reply: { text: `Please check your order: ${intent.issues.map(issue => issue.message).join(" ").slice(0, 2800) || "Choose dishes and quantities from the menu."} Send your complete revised order.`, confirmationNonce: null } };
  const cart = CartRequestSchema.parse({ restaurantId: binding.restaurantId, menuId: menu.id, menuVersion: menu.version, lines: intent.lines });
  let quote: Quote;
  try { quote = await deps.quote(claim.sessionTokenHash!, cart); }
  catch (error) {
    if (!(error instanceof HttpError) || !["STALE_MENU", "PRICE_CHANGED", "UNKNOWN_DISH", "DISH_UNAVAILABLE", "INVALID_OPTIONS", "INVALID_MODIFIERS", "UNKNOWN_OPTION", "SESSION_EXPIRED"].includes(error.code)) throw error;
    return { state: cleared, reply: { text: "The menu or options changed while I checked your order. Please send your complete order again for a fresh review.", confirmationNonce: null } };
  }
  const nonce = randomUUID();
  let reply: MessagingReply;
  try { reply = quoteReply(quote, nonce); }
  catch { return { state: cleared, reply: { text: "This order is too long to review safely in one message. Please place a smaller order.", confirmationNonce: null } }; }
  return { state: { ...state, pending: { cart, quote, confirmationNonce: nonce, idempotencyKey: randomUUID() } }, reply };
}

export async function processMessagingUpdate(binding: MessagingBinding, incoming: IncomingMessage, deps: MessagingDependencies): Promise<"processed" | "duplicate"> {
  const claim = await deps.store.claim(binding, incoming);
  if (claim.status === "busy") throw new HttpError(503, "CONVERSATION_BUSY", "The previous message is still being processed.");
  if (claim.status === "claimed") {
    if (!claim.leaseId || !claim.sessionTokenHash) throw new Error("Missing conversation lease or session");
    const next = await transition(binding, incoming, claim, deps);
    await deps.store.complete(claim.conversationId, claim.leaseId, incoming.updateId, MessagingStateSchema.parse(next.state), MessagingReplySchema.parse(next.reply));
  }
  // Also recover a crash between durable complete and first send on redelivery.
  const outbox = await deps.store.claimReply(claim.conversationId, incoming.updateId);
  if (outbox.status === "claimed" && outbox.reply) {
    let result: SendResult;
    try { result = await deps.send(incoming.recipientId, outbox.reply); }
    catch { result = { status: "unknown", providerMessageId: null }; }
    await deps.store.finishReply(claim.conversationId, incoming.updateId, result.status, result.providerMessageId);
  }
  return claim.status === "duplicate" ? "duplicate" : "processed";
}
