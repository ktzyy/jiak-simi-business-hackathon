import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CartRequestSchema, QuoteSchema, TicketSchema, type CartRequest, type Intent, type Menu, type Quote, type Ticket } from "../../shared/contracts";
import { HttpError } from "../http";
import { type TelegramAudio } from "./audio";
import { OrderIntentError } from "../ai/order-intent";

export const MessagingStateSchema = z.strictObject({
  version: z.literal(1),
  pending: z.strictObject({ cart: CartRequestSchema, quote: QuoteSchema, confirmationNonce: z.uuid(), idempotencyKey: z.uuid() }).nullable(),
  lastTicket: TicketSchema.nullable(),
});
export type MessagingState = z.infer<typeof MessagingStateSchema>;
export const MessagingReplySchema = z.strictObject({ text: z.string().min(1).max(4000), confirmationNonce: z.uuid().nullable() });
export type MessagingReply = z.infer<typeof MessagingReplySchema>;
export type IncomingMessage = { updateId: string; recipientId: string } & ({ kind: "text"; text: string } | { kind: "confirm"; nonce: string } | { kind: "audio"; audio: TelegramAudio; caption: string } | { kind: "unsupported" });
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
  parseIntent(menu: Menu, text: string, sessionTokenHash: string, cartContext?: CartRequest): Promise<Intent>;
  quote(sessionTokenHash: string, cart: CartRequest): Promise<Quote>;
  transcribeAudio?(incoming: Extract<IncomingMessage, { kind: "audio" }>, sessionTokenHash: string): Promise<string>;
  send(recipientId: string, reply: MessagingReply): Promise<SendResult>;
}
const emptyState = (): MessagingState => ({ version: 1, pending: null, lastTicket: null });
export const DEMO_PAYMENT_LOADING = "Demo PayNow • No money moved\nChecking demo payment…";
export const DEMO_PAYMENT_VERIFIED = "Demo payment verified ✓\nDemo only — no money moved.\nYour actual order remains unpaid.";
const modeLabel = (mode: "dine_in" | "takeaway" | null) => mode === "dine_in" ? "Dine in" : mode === "takeaway" ? "Takeaway" : "Not specified";
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
function receipt(ticket: Ticket): MessagingReply {
  return { text: `Order #${ticket.id.slice(-6).toUpperCase()} received ✓\n${money(ticket.cart.totalCents)} · ${modeLabel(ticket.cart.fulfillmentType)} · Unpaid\nTry the payment demo: /paydemo`, confirmationNonce: null };
}
function quoteReply(quote: Quote, nonce: string): MessagingReply {
  const lines = quote.lines.map((line) => `${line.quantity} × ${line.name}${line.options.length ? ` (${line.options.map(option => option.name).join(", ")})` : ""}: ${money(line.lineTotalCents)}`);
  return MessagingReplySchema.parse({ text: `Your order · ${modeLabel(quote.fulfillmentType)}\n${lines.join("\n")}\nTotal ${money(quote.totalCents)} · Unpaid\nTap Place order, or resend your order to change it.`, confirmationNonce: nonce });
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
  if (incoming.kind === "unsupported") return { state, reply: { text: "Send text or an audio recording under 20 seconds and 5 MB. Photos and group orders aren't supported.", confirmationNonce: null } };
  let text: string;
  if (incoming.kind === "audio") {
    try {
      if (!deps.transcribeAudio) throw new Error("Audio unavailable");
      const transcript = await deps.transcribeAudio(incoming, claim.sessionTokenHash!);
      text = `${transcript}${incoming.caption ? `\nCustomer caption: ${incoming.caption}` : ""}`.trim();
    } catch {
      return { state: { ...state, pending: null }, reply: { text: "I couldn't verify that audio. Please type your full order, or send a new voice note under 20 seconds. Include dine in or takeaway.", confirmationNonce: null } };
    }
  } else text = incoming.text.trim();
  if (incoming.kind !== "audio" && text === "/paydemo") return { state, reply: { text: state.lastTicket ? DEMO_PAYMENT_LOADING : "Place an order first, then try /paydemo.\nDemo only — no money moved.", confirmationNonce: null } };
  if (incoming.kind !== "audio" && text === "/status") return { state, reply: state.lastTicket ? receipt(state.lastTicket) : state.pending ? quoteReply(state.pending.quote, state.pending.confirmationNonce) : { text: "You have no confirmed order in this session. Send /menu to start.", confirmationNonce: null } };
  if (incoming.kind !== "audio" && text === "/cancel") return { state: { ...state, pending: null }, reply: { text: "Draft cleared. This doesn't cancel an order already sent to the kitchen.", confirmationNonce: null } };
  if (incoming.kind !== "audio" && (text === "/start" || text === "/menu")) {
    const menu = await deps.readMenu(binding.restaurantId);
    const dishes = menu.dishes.filter(dish => dish.available);
    const dishLines = dishes.slice(0, 15).map(dish => `${dish.name} · ${money(dish.priceCents)}`);
    const text = `${menu.name}\n${dishLines.join("\n")}\n\nWhat would you like? Send dishes + quantities + dine in or takeaway.\n/menu · /options · /status · /cancel`;
    return { state, reply: { text, confirmationNonce: null } };
  }
  if (incoming.kind !== "audio" && text === "/options") {
    const menu = await deps.readMenu(binding.restaurantId);
    const lines = menu.dishes.filter(dish => dish.available && dish.modifierGroups.length).slice(0, 15).map(dish => `${dish.name}\n${dish.modifierGroups.map(group => `${group.name} (choose ${group.minSelections}–${group.maxSelections}): ${group.options.map(option => `${option.name}${option.priceDeltaCents ? ` ${option.priceDeltaCents > 0 ? "+" : "-"}${money(Math.abs(option.priceDeltaCents))}` : ""}`).join(", ")}`).join("\n")}`);
    const text = lines.length ? lines.join("\n\n") : "No extra options on this menu.";
    return { state, reply: { text: text.length <= 3900 ? `${text}\n\nInclude your choices with your order.` : "Ask for a dish with your order. I'll check which options it needs.", confirmationNonce: null } };
  }

  // Short follow-ups edit only the current unplaced cart; never a lastTicket.
  // Any new edit retires the previous confirmation, including ambiguous edits.
  const cleared = { ...state, pending: null };
  if (!text || text.length > 4000) return { state: cleared, reply: { text: "Please send your complete order in at most 4,000 characters.", confirmationNonce: null } };
  const menu = await deps.readMenu(binding.restaurantId);
  const previous = state.pending && state.pending.cart.menuId === menu.id && state.pending.cart.menuVersion === menu.version ? state.pending : null;
  const retained = previous ? { ...state, pending: { ...previous, confirmationNonce: randomUUID(), idempotencyKey: randomUUID() } } : cleared;
  if (previous && /^(?:one|two|both|all|each|first|second|1|2)(?: plate| plates)?(?: please)?[.!]?$/i.test(text)) return { state: retained, reply: { text: "Please include the change too—for example, ‘add egg to one plate’ or ‘no chilli on both plates’. Your draft is kept.", confirmationNonce: null } };
  let intent: Intent;
  try { intent = await deps.parseIntent(menu, text, claim.sessionTokenHash!, previous?.cart); }
  catch (error) {
    if (error instanceof HttpError && error.code === "RATE_LIMITED") return { state: retained, reply: { text: "Please wait a few minutes before sending another order. Your draft has not been placed.", confirmationNonce: null } };
    if (!(error instanceof OrderIntentError)) throw error;
    return { state: retained, reply: { text: "I couldn’t check that order just now. Please send your complete order again. Your draft has not been placed.", confirmationNonce: null } };
  }
  if (!intent.fulfillmentType) return { state: retained, reply: { text: "Dine in or takeaway? Resend your order with your choice.", confirmationNonce: null } };
  if (intent.issues.length || !intent.lines.length) return { state: retained, reply: { text: `${intent.issues.map(issue => issue.message).join(" ").slice(0, 2800) || "Choose dishes and quantities from the menu."}${previous ? " Your existing items and dine-in/takeaway choice are kept. Repeat the change with the dish and plate count." : " Send your complete revised order."}`, confirmationNonce: null } };
  const cart = CartRequestSchema.parse({ restaurantId: binding.restaurantId, menuId: menu.id, menuVersion: menu.version, fulfillmentType: intent.fulfillmentType, lines: intent.lines });
  let quote: Quote;
  try { quote = await deps.quote(claim.sessionTokenHash!, cart); }
  catch (error) {
    if (!(error instanceof HttpError) || !["STALE_MENU", "PRICE_CHANGED", "UNKNOWN_DISH", "DISH_UNAVAILABLE", "INVALID_OPTIONS", "INVALID_MODIFIERS", "UNKNOWN_OPTION", "SESSION_EXPIRED"].includes(error.code)) throw error;
    return { state: cleared, reply: { text: "The menu or options changed while I checked your order. Please send your complete order again for a fresh review.", confirmationNonce: null } };
  }
  const nonce = randomUUID();
  let reply: MessagingReply;
  try {
    reply = quoteReply(quote, nonce);
    const missingChilli = cart.lines.some(line => {
      const dish = menu.dishes.find(dish => dish.id === line.dishId);
      const chilli = dish?.modifierGroups.find(group => /chill?i/i.test(group.name));
      return chilli && !chilli.options.some(option => line.optionIds.includes(option.id));
    });
    if (missingChilli) reply = MessagingReplySchema.parse({ ...reply, text: `${reply.text}\nChilli or no chilli? Tell me, or place it as shown.` });
    if (incoming.kind === "audio") reply = MessagingReplySchema.parse({ ...reply, text: `From your audio — check every item.\n${reply.text}` }); }
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
