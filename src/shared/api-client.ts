import { z } from "zod";
import { CartRequestSchema, ErrorSchema, IntentSchema, MenuSchema, QuoteSchema, SubmitSchema, TicketSchema, type CartRequest } from "./contracts";
import { extractedMenuDraftSchema } from "./extraction";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public retryable: boolean) { super(message); }
}
// Keep baseUrl same-origin. This client never silently retries order placement.
export function createApiClient(baseUrl = "", fetcher: typeof fetch = fetch) {
  async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try { response = await fetcher(`${baseUrl}/api/v1${path}`, { ...init, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } }); }
    catch {
      const placingOrder = path === "/orders" || path === "/live/orders";
      const message = placingOrder
        ? "Connection interrupted. A submitted order may have been received; retry the same confirmation with the same key."
        : path === "/menu-extractions"
          ? "The upload result is unknown. Wait before choosing to upload again, or enter the menu manually."
          : "Connection interrupted. The result could not be verified.";
      throw new ApiError("ACKNOWLEDGEMENT_UNKNOWN", message, 0, placingOrder);
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw new ApiError("INVALID_RESPONSE", "Server response could not be verified. Preserve the submission key.", response.status, false); }
    if (!response.ok) {
      const error = ErrorSchema.safeParse(body);
      if (error.success) throw new ApiError(error.data.error.code, error.data.error.message, response.status, error.data.error.retryable);
      throw new ApiError("SERVER_ERROR", "Request failed.", response.status, false);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ApiError("INVALID_RESPONSE", "Server response did not match the contract. Preserve the submission key.", response.status, false);
    return parsed.data;
  }
  return {
    extract: (photo: Blob, restaurantId: string, staffAccessToken: string) => call("/menu-extractions", extractedMenuDraftSchema, { method: "POST", body: photo, headers: { "Content-Type": photo.type, "X-Restaurant-Id": restaurantId, Authorization: `Bearer ${staffAccessToken}` } }),
    startLive: (sdp: string, restaurantId: string, staffAccessToken: string, signal?: AbortSignal) => call("/live/sessions", z.strictObject({ sessionId: z.string(), sdp: z.string(), model: z.literal("gpt-live-1"), orderingEnabled: z.literal(false), voiceSessionId: z.uuid(), expiresAt: z.iso.datetime(), reviewEnabled: z.literal(true) }), { method: "POST", body: JSON.stringify({ sdp, restaurantId }), headers: { Authorization: `Bearer ${staffAccessToken}` }, signal }),
    prepareVoiceReview: (voiceSessionId: string, text: string, staffAccessToken: string) => call("/live/reviews", z.strictObject({ intent: IntentSchema, review: z.strictObject({ quote: QuoteSchema, confirmationNonce: z.uuid(), revision: z.number().int().positive() }).nullable() }), { method: "POST", body: JSON.stringify({ voiceSessionId, text }), headers: { Authorization: `Bearer ${staffAccessToken}` } }),
    confirmVoiceOrder: (voiceSessionId: string, confirmationNonce: string, staffAccessToken: string) => call("/live/orders", TicketSchema, { method: "POST", body: JSON.stringify({ voiceSessionId, confirmationNonce, confirmed: true }), headers: { Authorization: `Bearer ${staffAccessToken}` } }),
    closeVoiceSession: (voiceSessionId: string, staffAccessToken: string) => call("/live/close", z.strictObject({ ok: z.literal(true) }), { method: "POST", body: JSON.stringify({ voiceSessionId }), headers: { Authorization: `Bearer ${staffAccessToken}` } }),
    readMenu: (restaurantId: string) => call(`/menus/${encodeURIComponent(restaurantId)}`, MenuSchema),
    startGuest: (restaurantId: string) => call("/guest-sessions", z.strictObject({ restaurantId: z.uuid(), ready: z.literal(true) }), { method: "POST", body: JSON.stringify({ restaurantId }) }),
    publishMenu: (menu: z.infer<typeof MenuSchema>, staffAccessToken: string) => call("/menus/publish", MenuSchema, { method: "POST", headers: { Authorization: `Bearer ${staffAccessToken}` }, body: JSON.stringify(MenuSchema.parse(menu)) }),
    parseOrder: (restaurantId: string, menuId: string, menuVersion: number, text: string) => call("/orders/parse", IntentSchema, { method: "POST", body: JSON.stringify({ restaurantId, menuId, menuVersion, text }) }),
    quote: (cart: CartRequest) => call("/orders/quote", QuoteSchema, { method: "POST", body: JSON.stringify(CartRequestSchema.parse(cart)) }),
    submit: (input: z.infer<typeof SubmitSchema>, idempotencyKey: string) => {
      z.uuid().parse(idempotencyKey);
      return call("/orders", TicketSchema, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(SubmitSchema.parse(input)) });
    },
    kitchen: (restaurantId: string, staffAccessToken: string) => call(`/kitchen/${encodeURIComponent(restaurantId)}`, z.strictObject({ orders: z.array(TicketSchema) }), { headers: { Authorization: `Bearer ${staffAccessToken}` } }),
  };
}
