import "server-only";
import { z } from "zod";
import { PUBLIC_DEMO_RESTAURANT_ID } from "../../shared/public-demo";
import { Id, MenuSchema, QuoteSchema } from "../../shared/contracts";
import { parseOrderIntent } from "../ai/order-intent";
import { errorResponse, HttpError, readBoundedBody } from "../http";
import { databaseRpc, getBackendClient, type BackendClient } from "../supabase-backend";
import { processMessagingUpdate, type MessagingDependencies } from "./core";
import { createMessagingStore } from "./store";
import { AudioOrderError, downloadTelegramAudio, decodeTelegramAudio } from "./audio";
import { audioAttemptPath, ensureNoAudioAttempt, reserveAudioAttempt, transcribeWithGptLive } from "./live-audio";
import { authenticateTelegramWebhook, decodeTelegramUpdate, sendTelegramReply } from "./telegram";

const settingsSchema = z.strictObject({
  token: z.string().regex(/^\d+:[A-Za-z0-9_-]+$/), secret: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  accountId: z.string().regex(/^\d+$/), restaurantId: z.uuid(), allowedChatIds: z.array(z.string().regex(/^[1-9]\d*$/)).max(20), publicDemo: z.boolean().optional(),
}).refine(value => value.token.split(":")[0] === value.accountId)
  .refine(value => value.publicDemo ? value.restaurantId === PUBLIC_DEMO_RESTAURANT_ID : value.allowedChatIds.length > 0);
export function telegramSettings() {
  const parsed = settingsSchema.safeParse({ token: process.env.TELEGRAM_BOT_TOKEN, secret: process.env.TELEGRAM_WEBHOOK_SECRET, accountId: process.env.TELEGRAM_BOT_ID, restaurantId: process.env.TELEGRAM_RESTAURANT_ID, allowedChatIds: process.env.TELEGRAM_ALLOWED_CHAT_IDS?.split(",").map(id => id.trim()).filter(Boolean) ?? [], publicDemo: process.env.TELEGRAM_PUBLIC_DEMO === "true" });
  if (!parsed.success) throw new HttpError(503, "NOT_CONFIGURED", "The Telegram pilot is not configured.");
  return parsed.data;
}
export async function telegramWebhook(request: Request, overrides?: { settings: ReturnType<typeof telegramSettings>; dependencies: MessagingDependencies }): Promise<Response> {
  try {
    const settings = overrides?.settings ?? telegramSettings();
    authenticateTelegramWebhook(request, settings.secret);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new HttpError(415, "INVALID_CONTENT_TYPE", "Send a JSON update.");
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(request, 64_000))); }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "INVALID_REQUEST", "The update is not valid JSON."); }
    const incoming = decodeTelegramUpdate(body, new Set(settings.allowedChatIds), { enabled: settings.publicDemo === true, restaurantId: settings.restaurantId });
    if (!incoming) return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    const dependencies = overrides?.dependencies ?? createTelegramDependencies(settings);
    await processMessagingUpdate({ provider: "telegram", accountId: settings.accountId, restaurantId: settings.restaurantId }, incoming, dependencies);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export function createTelegramDependencies(settings: ReturnType<typeof telegramSettings>, client: BackendClient = getBackendClient()): MessagingDependencies {
  settings = settingsSchema.parse(settings);
  async function consumeAiBudget(hash: string) {
    await databaseRpc(client, "consume_guest_ai_budget", { p_session_token_hash: hash, p_restaurant_id: settings.restaurantId }, Id);
    // Public Telegram shares the approved restaurant voice budget (20 / 10 min)
    // across chats and both paid stages: Live transcription and intent parsing.
    if (settings.publicDemo) await databaseRpc(client, "consume_staff_ai_budget", { p_actor_id: "b123ff27-d269-4b0f-97f6-78a3e97170a3", p_restaurant_id: PUBLIC_DEMO_RESTAURANT_ID, p_operation: "voice" }, Id);
  }
  return {
    store: createMessagingStore(client),
    readMenu: restaurantId => databaseRpc(client, "read_published_menu", { p_restaurant_id: restaurantId }, MenuSchema),
    parseIntent: async (menu, text, hash, cartContext) => {
      await consumeAiBudget(hash);
      return parseOrderIntent(menu, text, { apiKey: process.env.OPENAI_API_KEY ?? "", cartContext });
    },
    quote: (hash, cart) => databaseRpc(client, "quote_cart", { p_session_token_hash: hash, p_cart: cart }, QuoteSchema),
    transcribeAudio: async (incoming, hash) => {
      if (process.env.NODE_ENV === "production" || process.platform !== "darwin") throw new AudioOrderError("Audio ordering currently needs the laptop decoder. Please type your order.");
      const identity = JSON.stringify([settings.accountId, incoming.recipientId, incoming.updateId]);
      const marker = audioAttemptPath(settings.secret, identity);
      await ensureNoAudioAttempt(marker);
      const bytes = await downloadTelegramAudio(settings.token, incoming.audio);
      const pcm = await decodeTelegramAudio(bytes, incoming.audio.mimeType);
      await consumeAiBudget(hash);
      await reserveAudioAttempt(marker);
      return transcribeWithGptLive(pcm, process.env.OPENAI_API_KEY ?? "");
    },
    send: (recipientId, reply) => sendTelegramReply(settings.token, recipientId, reply),
  };
}
