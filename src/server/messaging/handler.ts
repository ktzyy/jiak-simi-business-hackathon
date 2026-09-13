import "server-only";
import { z } from "zod";
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
  accountId: z.string().regex(/^\d+$/), restaurantId: z.uuid(), allowedChatIds: z.array(z.string().regex(/^[1-9]\d*$/)).min(1).max(20),
}).refine(value => value.token.split(":")[0] === value.accountId);
export function telegramSettings() {
  const parsed = settingsSchema.safeParse({ token: process.env.TELEGRAM_BOT_TOKEN, secret: process.env.TELEGRAM_WEBHOOK_SECRET, accountId: process.env.TELEGRAM_BOT_ID, restaurantId: process.env.TELEGRAM_RESTAURANT_ID, allowedChatIds: process.env.TELEGRAM_ALLOWED_CHAT_IDS?.split(",").map(id => id.trim()) });
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
    const incoming = decodeTelegramUpdate(body, new Set(settings.allowedChatIds));
    if (!incoming) return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    const dependencies = overrides?.dependencies ?? createTelegramDependencies(settings);
    await processMessagingUpdate({ provider: "telegram", accountId: settings.accountId, restaurantId: settings.restaurantId }, incoming, dependencies);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export function createTelegramDependencies(settings: ReturnType<typeof telegramSettings>, client: BackendClient = getBackendClient()): MessagingDependencies {
  return {
    store: createMessagingStore(client),
    readMenu: restaurantId => databaseRpc(client, "read_published_menu", { p_restaurant_id: restaurantId }, MenuSchema),
    parseIntent: async (menu, text, hash, cartContext) => {
      await databaseRpc(client, "consume_guest_ai_budget", { p_session_token_hash: hash, p_restaurant_id: settings.restaurantId }, Id);
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
      await databaseRpc(client, "consume_guest_ai_budget", { p_session_token_hash: hash, p_restaurant_id: settings.restaurantId }, Id);
      await reserveAudioAttempt(marker);
      return transcribeWithGptLive(pcm, process.env.OPENAI_API_KEY ?? "");
    },
    send: (recipientId, reply) => sendTelegramReply(settings.token, recipientId, reply),
  };
}
