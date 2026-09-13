import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HttpError } from "../http";
import { type IncomingMessage, type MessagingReply, type SendResult } from "./core";

const numericId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sender = z.object({ id: numericId, is_bot: z.literal(false) });
const privateChat = z.object({ id: numericId, type: z.literal("private") });
const telegramUpdate = z.object({ update_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  message: z.object({ from: sender, chat: privateChat, text: z.string().max(4096).optional() }).optional(),
  callback_query: z.object({ id: z.string().min(1), from: sender, message: z.object({ chat: privateChat }), data: z.string().max(64).optional() }).optional(),
});
export function authenticateTelegramWebhook(request: Request, secret: string) {
  const expected = Buffer.from(secret), supplied = Buffer.from(request.headers.get("x-telegram-bot-api-secret-token") ?? "");
  if (expected.length < 32 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new HttpError(401, "UNAUTHORIZED", "Webhook authentication failed.");
}
export function decodeTelegramUpdate(input: unknown, allowedChatIds: ReadonlySet<string>): IncomingMessage | null {
  // Unknown Telegram update kinds, groups and bot senders are ignored without
  // creating a conversation, spending model tokens or sending a reply.
  const parsed = telegramUpdate.safeParse(input);
  if (!parsed.success) return null;
  const value = parsed.data;
  if (value.message && value.callback_query) return null;
  const payload = value.message ?? value.callback_query;
  const chat = value.message?.chat ?? value.callback_query?.message.chat;
  if (!payload || !chat || payload.from.id !== chat.id || !allowedChatIds.has(String(chat.id))) return null;
  const base = { updateId: String(value.update_id), recipientId: String(chat.id) };
  if (value.callback_query) {
    const nonce = value.callback_query.data?.startsWith("confirm:") ? value.callback_query.data.slice(8) : null;
    return nonce && z.uuid().safeParse(nonce).success ? { ...base, kind: "confirm", nonce } : { ...base, kind: "unsupported" };
  }
  return value.message?.text !== undefined ? { ...base, kind: "text", text: value.message.text } : { ...base, kind: "unsupported" };
}

export async function sendTelegramReply(token: string, recipientId: string, reply: MessagingReply, fetcher: typeof fetch = fetch): Promise<SendResult> {
  if (!/^\d+$/.test(recipientId) || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) return { status: "not_sent", providerMessageId: null };
  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
      // No parse_mode: menu/model strings cannot inject Telegram formatting.
      body: JSON.stringify({ chat_id: recipientId, text: reply.text, ...(reply.confirmationNonce ? { reply_markup: { inline_keyboard: [[{ text: "Place order", callback_data: `confirm:${reply.confirmationNonce}` }]] } } : {}) }),
    });
    const result = z.object({ ok: z.boolean(), result: z.object({ message_id: numericId }).optional() }).safeParse(await response.json());
    if (response.ok && result.success && result.data.ok && result.data.result) return { status: "sent", providerMessageId: String(result.data.result.message_id) };
    // Explicit Telegram errors are non-delivery. An unverified response or server
    // error remains unknown, so a timeout never creates an automatic duplicate.
    if (response.status < 500 && result.success && result.data.ok === false) return { status: "not_sent", providerMessageId: null };
    return { status: "unknown", providerMessageId: null };
  } catch { return { status: "unknown", providerMessageId: null }; }
}
