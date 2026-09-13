import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixtureCart, fixtureMenu, fixtureQuote, fixtureTicket } from "../src/shared/fixtures";
import { type IncomingMessage, type MessagingState, type MessagingReply, type MessagingDependencies, type MessagingStore, processMessagingUpdate } from "../src/server/messaging/core";
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
    parseIntent: async () => ({ restaurantId: fixtureCart.restaurantId, menuId: fixtureCart.menuId, menuVersion: fixtureCart.menuVersion, lines: fixtureCart.lines, issues: [] }),
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
  assert.match(h.sent[1].text, /Payment: unpaid/);
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
  deps.parseIntent = async () => ({ restaurantId: fixtureMenu.restaurantId, menuId: fixtureMenu.id, menuVersion: 1, lines: fixtureCart.lines, issues: [{ code: "UNSUPPORTED", message: "Spicy isn't an approved option.", lineIndex: 0 }] });
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
