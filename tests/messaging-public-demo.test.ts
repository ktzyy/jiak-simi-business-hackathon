import test from "node:test";
import assert from "node:assert/strict";
import { decodeTelegramUpdate } from "../src/server/messaging/telegram";
import { telegramSettings, createTelegramDependencies } from "../src/server/messaging/handler";
import { PUBLIC_DEMO_RESTAURANT_ID } from "../src/shared/public-demo";
import { DEMO_MENU_WITH_EXTRAS } from "../src/shared/demo-menu";
import { fixtureMenu } from "../src/shared/fixtures";

const event = (id: number) => ({ update_id: id, message: { from: { id, is_bot: false }, chat: { id, type: "private" }, text: "one rice takeaway" } });
const access = { enabled: true, restaurantId: PUBLIC_DEMO_RESTAURANT_ID };
test("public mode accepts new private humans while default remains allowlisted and identities stay distinct", () => {
  for (const id of [123, 456]) {
    assert.equal(decodeTelegramUpdate(event(id), new Set()), null);
    const incoming = decodeTelegramUpdate(event(id), new Set(), access);
    assert.equal(incoming?.recipientId, String(id));
    assert.equal(incoming?.updateId, String(id));
    assert.equal(decodeTelegramUpdate(event(id), new Set(), { ...access, restaurantId: fixtureMenu.restaurantId }), null);
  }
  const group = event(123); group.message.chat.type = "group";
  assert.equal(decodeTelegramUpdate(group, new Set(), access), null);
  const bot = event(123); bot.message.from.is_bot = true;
  assert.equal(decodeTelegramUpdate(bot, new Set(), access), null);
  const spoof = event(123); spoof.message.from.id = 456;
  assert.equal(decodeTelegramUpdate(spoof, new Set(), access), null);
  assert.equal(decodeTelegramUpdate({ update_id: 3, callback_query: { id: "q", from: { id: 456, is_bot: false }, message: { chat: { id: 123, type: "private" } }, data: "confirm:00000000-0000-4000-8000-000000000001" } }, new Set(), access), null);
});

test("public Telegram configuration is explicit and bound to the one dummy restaurant", t => {
  const keys = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_BOT_ID", "TELEGRAM_RESTAURANT_ID", "TELEGRAM_ALLOWED_CHAT_IDS", "TELEGRAM_PUBLIC_DEMO"];
  const previous = keys.map(k => process.env[k]);
  t.after(() => keys.forEach((k, i) => { if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i]; }));
  Object.assign(process.env, { TELEGRAM_BOT_TOKEN: "12345:test", TELEGRAM_WEBHOOK_SECRET: "s".repeat(32), TELEGRAM_BOT_ID: "12345", TELEGRAM_RESTAURANT_ID: PUBLIC_DEMO_RESTAURANT_ID, TELEGRAM_ALLOWED_CHAT_IDS: "", TELEGRAM_PUBLIC_DEMO: "false" });
  assert.throws(telegramSettings, { status: 503 });
  process.env.TELEGRAM_PUBLIC_DEMO = "true";
  assert.equal(telegramSettings().publicDemo, true);
  process.env.TELEGRAM_RESTAURANT_ID = fixtureMenu.restaurantId;
  assert.throws(telegramSettings, { status: 503 });
  process.env.TELEGRAM_PUBLIC_DEMO = "false";
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = "123";
  assert.deepEqual(telegramSettings().allowedChatIds, ["123"]);
});

test("public paid parsing hits guest then shared restaurant budget; exhaustion stops before OpenAI", async t => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; throw Error("No provider call expected"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const deps = createTelegramDependencies({ token: "12345:test", secret: "s".repeat(32), accountId: "12345", restaurantId: PUBLIC_DEMO_RESTAURANT_ID, allowedChatIds: [], publicDemo: true }, {
    auth: { getUser: async () => { throw Error("No Auth required"); } },
    rpc: async (name, args) => { calls.push({ name, args }); return name === "consume_staff_ai_budget" ? { data: null, error: { code: "P0001", message: "RATE_LIMITED" } } : { data: PUBLIC_DEMO_RESTAURANT_ID, error: null }; },
  });
  await assert.rejects(deps.parseIntent(DEMO_MENU_WITH_EXTRAS, "one rice takeaway", "a".repeat(64)), { status: 429, code: "RATE_LIMITED" });
  assert.deepEqual(calls.map(c => c.name), ["consume_guest_ai_budget", "consume_staff_ai_budget"]);
  assert.equal(calls[0].args.p_session_token_hash, "a".repeat(64));
  assert.deepEqual(calls[1].args, { p_actor_id: "b123ff27-d269-4b0f-97f6-78a3e97170a3", p_restaurant_id: PUBLIC_DEMO_RESTAURANT_ID, p_operation: "voice" });
  assert.equal(providerCalls, 0);
});
