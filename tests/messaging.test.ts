import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixtureCart, fixtureMenu, fixtureQuote, fixtureTicket } from "../src/shared/fixtures";
import { DEMO_PAYMENT_LOADING, DEMO_PAYMENT_VERIFIED, type IncomingMessage, type MessagingState, type MessagingReply, type MessagingDependencies, type MessagingStore, processMessagingUpdate } from "../src/server/messaging/core";
import { authenticateTelegramWebhook, decodeTelegramUpdate, sendTelegramReply } from "../src/server/messaging/telegram";
import { telegramWebhook } from "../src/server/messaging/handler";
import { HttpError } from "../src/server/http";

const binding = { provider: "telegram" as const, accountId: "12345", restaurantId: fixtureMenu.restaurantId };
const incoming = (id: string, text: string): IncomingMessage => ({ updateId: id, recipientId: "67890", kind: "text", text });
// Durable fake persists across dependency/handler reconstruction; tests verify
// orchestrator crash boundaries, not the production SQL locking implementation.
function harness() {
  let state: MessagingState | null = null;
  const done = new Map<string, MessagingReply>(), attempted = new Set<string>();
  const tickets = new Map<string, typeof fixtureTicket>();
  const committedUpdates = new Map<string, typeof fixtureTicket>();
  let active: string | null = null, submitCalls = 0, failAfterCommit = false, sendUnknown = false;
  const sent: MessagingReply[] = [];
  const store: MessagingStore = {
    async claim(_binding, update) {
      const status = done.has(update.updateId) ? "duplicate" : active && active !== update.updateId ? "busy" : "claimed";
      if (status === "claimed") active = update.updateId;
      return { status, conversationId: fixtureMenu.restaurantId, leaseId: randomUUID(), state: structuredClone(state), sessionTokenHash: "a".repeat(64) };
    },
    async complete(_conversation, _lease, updateId, next, reply) { state = structuredClone(next); done.set(updateId, structuredClone(reply)); active = null; },
    async submit(_conversation, _lease, updateId, nonce) {
      if (committedUpdates.has(updateId)) { submitCalls++; return committedUpdates.get(updateId)!; }
      if (state?.pending?.confirmationNonce !== nonce) throw new HttpError(409, "STALE_REVIEW", "stale");
      const key = state!.pending!.idempotencyKey;
      submitCalls++;
      if (!tickets.has(key)) tickets.set(key, structuredClone(fixtureTicket));
      committedUpdates.set(updateId, tickets.get(key)!);
      state = { version: 1, pending: null, lastTicket: tickets.get(key)! };
      if (failAfterCommit) { failAfterCommit = false; throw new Error("connection lost after commit"); }
      return tickets.get(key)!;
    },
    async claimReply(_conversation, updateId) { if (attempted.has(updateId)) return { status: "already_attempted", reply: null }; attempted.add(updateId); return { status: "claimed", reply: done.get(updateId)! }; },
    async finishReply() {},
  };
  const dependencies = (): MessagingDependencies => ({ store, readMenu: async () => fixtureMenu,
    parseIntent: async () => ({ restaurantId: fixtureCart.restaurantId, menuId: fixtureCart.menuId, menuVersion: fixtureCart.menuVersion, fulfillmentType: fixtureCart.fulfillmentType, lines: fixtureCart.lines, issues: [] }),
    quote: async () => fixtureQuote,
    send: async (_recipient, reply) => { sent.push(reply); return { status: sendUnknown ? "unknown" : "sent", providerMessageId: sendUnknown ? null : "99" }; },
  });
  return { dependencies, sent, state: () => state, ticketCount: () => tickets.size, submitCalls: () => submitCalls, failCommit: () => { failAfterCommit = true; }, unknownSend: () => { sendUnknown = true; } };
}

test("message quotes before explicit callback and duplicate delivery survives process restart", async () => {
  const h = harness();
  await processMessagingUpdate(binding, incoming("1", "two large noodles"), h.dependencies());
  assert.equal(h.ticketCount(), 0);
  const nonce = h.state()!.pending!.confirmationNonce;
  await processMessagingUpdate(binding, { ...incoming("2", ""), kind: "confirm", nonce }, h.dependencies());
  assert.equal(h.ticketCount(), 1);
  assert.equal(h.sent.length, 2);
  await processMessagingUpdate(binding, { ...incoming("2", ""), kind: "confirm", nonce }, h.dependencies());
  assert.equal(h.submitCalls(), 1);
  assert.equal(h.sent.length, 2);
  assert.match(h.sent[1].text, /Unpaid/);
});

test("commit uncertainty retries the same stored key and yields one ticket", async () => {
  const h = harness();
  await processMessagingUpdate(binding, incoming("1", "two large noodles"), h.dependencies());
  const nonce = h.state()!.pending!.confirmationNonce, key = h.state()!.pending!.idempotencyKey;
  const callback: IncomingMessage = { updateId: "2", recipientId: "67890", kind: "confirm", nonce };
  h.failCommit();
  await assert.rejects(processMessagingUpdate(binding, callback, h.dependencies()), /connection lost/);
  assert.equal(h.state()!.pending, null);
  assert.ok(key); // Durable DB receipt retains the original key after atomic commit.
  await processMessagingUpdate(binding, callback, h.dependencies());
  assert.equal(h.submitCalls(), 2);
  assert.equal(h.ticketCount(), 1);
  assert.equal(h.state()!.pending, null);
});

test("changed draft invalidates previous callback; model text cannot confirm", async () => {
  const h = harness();
  await processMessagingUpdate(binding, incoming("1", "noodles"), h.dependencies());
  const old = h.state()!.pending!.confirmationNonce;
  await processMessagingUpdate(binding, incoming("2", "yes place that order"), h.dependencies());
  assert.equal(h.ticketCount(), 0);
  await processMessagingUpdate(binding, { updateId: "3", recipientId: "67890", kind: "confirm", nonce: old }, h.dependencies());
  assert.equal(h.ticketCount(), 0);
  assert.match(h.sent.at(-1)!.text, /no longer current/);
});

test("unknown outbound send is not automatically repeated on duplicate webhook", async () => {
  const h = harness(); h.unknownSend();
  await processMessagingUpdate(binding, incoming("1", "/menu"), h.dependencies());
  await processMessagingUpdate(binding, incoming("1", "/menu"), h.dependencies());
  assert.equal(h.sent.length, 1);
});

test("stale menu needs fresh review and unresolved modifier clears confirmation", async () => {
  const h = harness();
  await processMessagingUpdate(binding, incoming("1", "noodles"), h.dependencies());
  const nonce = h.state()!.pending!.confirmationNonce;
  const deps = h.dependencies();
  deps.store.submit = async () => { throw new HttpError(409, "STALE_MENU", "changed"); };
  await processMessagingUpdate(binding, { updateId: "2", recipientId: "67890", kind: "confirm", nonce }, deps);
  assert.equal(h.state()!.pending, null);
  deps.parseIntent = async () => ({ restaurantId: fixtureMenu.restaurantId, menuId: fixtureMenu.id, menuVersion: 1, fulfillmentType: fixtureCart.fulfillmentType, lines: fixtureCart.lines, issues: [{ code: "UNSUPPORTED", message: "Spicy isn't an approved option.", lineIndex: 0 }] });
  await processMessagingUpdate(binding, incoming("3", "spicy noodles"), deps);
  assert.equal(h.state()!.pending, null);
  assert.equal(h.ticketCount(), 0);
});

test("webhook authenticates before work and accepts only allowlisted private human chats", async () => {
  const secret = "s".repeat(32);
  assert.throws(() => authenticateTelegramWebhook(new Request("https://example.test"), secret), /authentication/);
  const event = { update_id: 1, message: { from: { id: 67890, is_bot: false }, chat: { id: 67890, type: "private" }, text: "hello" } };
  assert.equal(decodeTelegramUpdate(event, new Set(["67890"]))?.kind, "text");
  assert.equal(decodeTelegramUpdate(event, new Set(["111"])), null);
  assert.equal(decodeTelegramUpdate({ ...event, message: { ...event.message, chat: { id: 67890, type: "group" } } }, new Set(["67890"])), null);
  assert.equal(decodeTelegramUpdate({ ...event, message: { ...event.message, from: { id: 111, is_bot: false } } }, new Set(["67890"])), null);
  const h = harness();
  const response = await telegramWebhook(new Request("https://example.test/api/v1/messaging/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) }), { settings: { token: "12345:abc", secret, accountId: "12345", restaurantId: fixtureMenu.restaurantId, allowedChatIds: ["67890"] }, dependencies: h.dependencies() });
  assert.equal(response.status, 401); assert.equal(h.sent.length, 0);
});

test("Telegram sends plain text with explicit confirmation and classifies timeout unknown", async () => {
  const nonce = randomUUID();
  const result = await sendTelegramReply("12345:abc", "67890", { text: "Review <dish>", confirmationNonce: nonce }, async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    assert.equal(body.parse_mode, undefined);
    assert.equal(body.reply_markup.inline_keyboard[0][0].callback_data, `confirm:${nonce}`);
    return Response.json({ ok: true, result: { message_id: 9 } });
  });
  assert.equal(result.status, "sent");
  const unknown = await sendTelegramReply("12345:abc", "67890", { text: "Receipt", confirmationNonce: null }, async () => { throw new Error("timeout"); });
  assert.equal(unknown.status, "unknown");
});

test("polling replays an interrupted batch without duplicating prior replies", async () => {
  const { processTelegramBatch } = await import("../src/server/messaging/polling");
  const h = harness();
  const update = (id: number, text: string) => ({ update_id: id, message: { from: { id: 67890, is_bot: false }, chat: { id: 67890, type: "private" }, text } });
  const deps = h.dependencies();
  const original = deps.readMenu;
  let reads = 0;
  deps.readMenu = async id => { if (++reads === 2) throw new Error("temporary database loss"); return original(id); };
  const batch = { ok: true, result: [update(10, "/menu"), update(11, "/menu")] };
  await assert.rejects(processTelegramBatch(batch, binding, new Set(["67890"]), deps, 0));
  assert.equal(h.sent.length, 1);
  const offset = await processTelegramBatch(batch, binding, new Set(["67890"]), h.dependencies(), 0);
  assert.equal(offset, 12);
  assert.equal(h.sent.length, 2);
});

test("paid intent parsing consumes the durable guest budget before model access", async () => {
  const { createTelegramDependencies } = await import("../src/server/messaging/handler");
  const names: string[] = [];
  const deps = createTelegramDependencies({ token: "12345:abc", secret: "s".repeat(32), accountId: "12345", restaurantId: fixtureMenu.restaurantId, allowedChatIds: ["67890"] }, {
    rpc: async (name, args) => { names.push(name); assert.equal(args.p_session_token_hash, "a".repeat(64)); return { data: null, error: { code: "P0001", message: "RATE_LIMITED" } }; },
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
  await assert.rejects(deps.parseIntent(fixtureMenu, "noodles", "a".repeat(64)), (error: unknown) => error instanceof HttpError && error.code === "RATE_LIMITED");
  assert.deepEqual(names, ["consume_guest_ai_budget"]);
});

test("authenticated webhook ignores customer-supplied restaurant and recipient fields", async () => {
  const h = harness();
  const deps = h.dependencies();
  let menuRestaurant = "";
  deps.readMenu = async id => { menuRestaurant = id; return fixtureMenu; };
  const secret = "s".repeat(32);
  const response = await telegramWebhook(new Request("https://example.test/api/v1/messaging/telegram", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret, "X-Restaurant-Id": randomUUID() },
    body: JSON.stringify({ update_id: 1, restaurantId: randomUUID(), recipientId: "11111", message: { from: { id: 67890, is_bot: false }, chat: { id: 67890, type: "private" }, text: "/menu" } }),
  }), { settings: { token: "12345:abc", secret, accountId: "12345", restaurantId: fixtureMenu.restaurantId, allowedChatIds: ["67890"] }, dependencies: deps });
  assert.equal(response.status, 200);
  assert.equal(menuRestaurant, fixtureMenu.restaurantId);
  assert.equal(h.sent.length, 1);
});


test("payment demo requires this conversation's receipt and never creates or pays a ticket", async () => {
  const h = harness();
  await processMessagingUpdate(binding, incoming("1", "/paydemo"), h.dependencies());
  assert.match(h.sent[0].text, /Place an order first/);
  assert.equal(h.ticketCount(), 0);
  await processMessagingUpdate(binding, incoming("2", "noodles"), h.dependencies());
  const nonce = h.state()!.pending!.confirmationNonce;
  await processMessagingUpdate(binding, { updateId: "3", recipientId: "67890", kind: "confirm", nonce }, h.dependencies());
  const prior = structuredClone(h.state());
  await processMessagingUpdate(binding, incoming("4", "/paydemo"), h.dependencies());
  assert.equal(h.sent.at(-1)!.text, DEMO_PAYMENT_LOADING);
  const replies = h.sent.length;
  await processMessagingUpdate(binding, incoming("4", "/paydemo"), h.dependencies());
  assert.equal(h.sent.length, replies);
  assert.deepEqual(h.state(), prior);
  assert.equal(h.state()!.lastTicket!.paymentStatus, "unpaid");
  assert.equal(h.ticketCount(), 1);
});

test("demo payment edits the same message after two seconds without payment calls", async () => {
  const methods: string[] = [], pauses: number[] = [];
  const result = await sendTelegramReply("12345:abc", "67890", { text: DEMO_PAYMENT_LOADING, confirmationNonce: null }, async (url, init) => {
    methods.push(String(url).split("/").at(-1)!);
    const body = JSON.parse(String(init!.body));
    if (methods.length === 2) {
      assert.equal(body.message_id, 44);
      assert.equal(body.chat_id, "67890");
      assert.equal(body.text, DEMO_PAYMENT_VERIFIED);
      assert.match(body.text, /no money moved/);
      assert.match(body.text, /remains unpaid/);
    }
    return Response.json({ ok: true, result: { message_id: 44 } });
  }, async milliseconds => { pauses.push(milliseconds); });
  assert.deepEqual(methods, ["sendMessage", "editMessageText"]);
  assert.deepEqual(pauses, [2000]);
  assert.equal(result.status, "sent");
});

test("unknown demo send never edits and unknown edit never resends", async () => {
  let calls = 0;
  const reply = { text: DEMO_PAYMENT_LOADING, confirmationNonce: null };
  const failedSend = await sendTelegramReply("12345:abc", "67890", reply, async () => { calls++; throw new Error("timeout"); }, async () => { assert.fail("No loading delay after unknown send"); });
  assert.equal(failedSend.status, "unknown"); assert.equal(calls, 1);
  calls = 0;
  const failedEdit = await sendTelegramReply("12345:abc", "67890", reply, async () => {
    if (++calls === 2) throw new Error("timeout");
    return Response.json({ ok: true, result: { message_id: 44 } });
  }, async () => {});
  assert.equal(failedEdit.status, "unknown"); assert.equal(calls, 2);
  assert.equal(failedEdit.providerMessageId, "44");
});


test("Telegram requires explicit fulfillment before quote and preserves it in review", async () => {
  const h = harness();
  const deps = h.dependencies();
  let quotes = 0;
  deps.parseIntent = async () => ({ restaurantId: fixtureMenu.restaurantId, menuId: fixtureMenu.id, menuVersion: 1, fulfillmentType: null, lines: fixtureCart.lines, issues: [] });
  deps.quote = async () => { quotes++; return fixtureQuote; };
  await processMessagingUpdate(binding, incoming("1", "two noodles"), deps);
  assert.equal(quotes, 0);
  assert.equal(h.state()!.pending, null);
  assert.match(h.sent.at(-1)!.text, /Dine in or takeaway/);
  deps.parseIntent = async () => ({ restaurantId: fixtureMenu.restaurantId, menuId: fixtureMenu.id, menuVersion: 1, fulfillmentType: "dine_in", lines: fixtureCart.lines, issues: [] });
  deps.quote = async (_hash, cart) => { assert.equal(cart.fulfillmentType, "dine_in"); return { ...fixtureQuote, fulfillmentType: "dine_in" }; };
  await processMessagingUpdate(binding, incoming("2", "two noodles dine in"), deps);
  assert.equal(h.state()!.pending!.cart.fulfillmentType, "dine_in");
  assert.match(h.sent.at(-1)!.text, /Dine in/);
});

test("voice note transcript only prepares a reviewed quote; duplicate audio never repeats work", async () => {
  const h = harness();
  const deps = h.dependencies(); let transcriptions = 0;
  deps.transcribeAudio = async () => { transcriptions++; return "two large noodles dine in"; };
  const note: IncomingMessage = { updateId: "1", recipientId: "67890", kind: "audio", caption: "", audio: { fileId: "audio_1", mimeType: "audio/ogg", durationSeconds: 2, sizeBytes: 4 } };
  await processMessagingUpdate(binding, note, deps);
  assert.equal(h.ticketCount(), 0);
  assert.ok(h.state()!.pending);
  assert.match(h.sent.at(-1)!.text, /From your audio/);
  await processMessagingUpdate(binding, note, deps);
  assert.equal(transcriptions, 1);
  const nonce = h.state()!.pending!.confirmationNonce;
  await processMessagingUpdate(binding, { updateId: "2", recipientId: "67890", kind: "confirm", nonce }, deps);
  assert.equal(h.ticketCount(), 1);
});

test("unknown audio provider outcome completes a safe reply rather than auto-rebilling", async () => {
  const h = harness(); const deps = h.dependencies(); let transcriptions = 0;
  deps.transcribeAudio = async () => { transcriptions++; throw new Error("paid dispatch result unknown"); };
  const note: IncomingMessage = { updateId: "1", recipientId: "67890", kind: "audio", caption: "", audio: { fileId: "audio_1", mimeType: "audio/ogg", durationSeconds: 2, sizeBytes: 4 } };
  await processMessagingUpdate(binding, note, deps);
  await processMessagingUpdate(binding, note, deps);
  assert.equal(transcriptions, 1);
  assert.equal(h.state()!.pending, null);
  assert.match(h.sent.at(-1)!.text, /type your full order/);
});

test("conversational cart edit preserves mode and quantity, rotates review, and retains base on ambiguity", async () => {
  const h = harness(); const deps = h.dependencies();
  await processMessagingUpdate(binding, incoming("1", "two large noodles dine in"), deps);
  const oldNonce = h.state()!.pending!.confirmationNonce;
  deps.parseIntent = async (_menu, text, _hash, current) => {
    assert.equal(text, "can i add egg as well");
    assert.deepEqual(current, fixtureCart);
    return { restaurantId: fixtureMenu.restaurantId, menuId: fixtureMenu.id, menuVersion: fixtureMenu.version, fulfillmentType: current!.fulfillmentType, lines: current!.lines, issues: [{ code: "EDIT_SCOPE_REQUIRED", message: "Egg on one plate or both?", lineIndex: null }] };
  };
  await processMessagingUpdate(binding, incoming("2", "can i add egg as well"), deps);
  assert.deepEqual(h.state()!.pending!.cart, fixtureCart);
  assert.notEqual(h.state()!.pending!.confirmationNonce, oldNonce);
  assert.match(h.sent.at(-1)!.text, /one plate or both/);
  assert.doesNotMatch(h.sent.at(-1)!.text, /^Dine in or takeaway/);
  assert.equal(h.sent.at(-1)!.confirmationNonce, null);
  await processMessagingUpdate(binding, incoming("3", "one"), deps);
  assert.deepEqual(h.state()!.pending!.cart, fixtureCart);
  assert.match(h.sent.at(-1)!.text, /include the change too/);
  await processMessagingUpdate(binding, { updateId: "4", recipientId: "67890", kind: "confirm", nonce: oldNonce }, deps);
  assert.equal(h.ticketCount(), 0);
});

test("egg follow-up produces a fresh priced quote from the persisted cart, preserving mode", async () => {
  const { DEMO_MENU_WITH_EXTRAS } = await import("../src/shared/demo-menu");
  const { parseOrderIntent } = await import("../src/server/ai/order-intent");
  const { quoteCart } = await import("../src/server/orders");
  const h = harness(); const deps = h.dependencies();
  const dish = DEMO_MENU_WITH_EXTRAS.dishes[0], egg = dish.modifierGroups.flatMap(group => group.options).find(option => option.name === "Egg")!;
  const menu = { ...DEMO_MENU_WITH_EXTRAS, restaurantId: binding.restaurantId };
  deps.readMenu = async () => menu;
  deps.quote = async (_hash, cart) => quoteCart(menu, cart);
  deps.parseIntent = async (currentMenu, text, _hash, cartContext) => parseOrderIntent(currentMenu, text, { apiKey: "test", cartContext, fetch: async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ fulfillmentType: cartContext ? null : "takeaway", lines: [{ dishId: dish.id, quantity: 1, optionIds: cartContext ? [egg.id] : [] }], issues: [] }) }] }] }) });
  await processMessagingUpdate(binding, incoming("1", "one rice takeaway"), deps);
  const oldNonce = h.state()!.pending!.confirmationNonce;
  assert.match(h.sent.at(-1)!.text, /Chilli or no chilli/);
  await processMessagingUpdate(binding, incoming("2", "can i add egg as well"), deps);
  assert.equal(h.state()!.pending!.cart.fulfillmentType, "takeaway");
  assert.equal(h.state()!.pending!.cart.lines[0].quantity, 1);
  assert.deepEqual(h.state()!.pending!.cart.lines[0].optionIds, [egg.id]);
  assert.equal(h.state()!.pending!.quote.totalCents, dish.priceCents + 100);
  assert.notEqual(h.state()!.pending!.confirmationNonce, oldNonce);
  assert.equal(h.ticketCount(), 0);
});
