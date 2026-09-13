import { z } from "zod";
import { CartRequestSchema, CompleteKitchenOrderSchema, ErrorSchema, IntentSchema, KitchenResponseSchema, MenuSchema, QuoteSchema, SubmitSchema, TicketSchema, type CartRequest } from "./contracts";
import { dishPhotoJobSchema, dishPhotoRequestSchema, dishPhotoSelectionSchema, publishedDishPhotosSchema, type DishPhotoRequest } from "./dish-photo";
import { extractedMenuDraftSchema } from "./extraction";
import { PublishedStallSchema, SaveStallDetailsSchema, SavedStallDetailsResponseSchema, StallDetailsResponseSchema } from "./stall-details";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public retryable: boolean) { super(message); }
}
// Keep baseUrl same-origin. This client never silently retries order placement.
export function createApiClient(baseUrl = "", fetcher: typeof fetch = fetch) {
  async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try { response = await fetcher(`${baseUrl}/api/v1${path}`, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers } }); }
    catch {
      const placingOrder = path === "/orders" || path === "/live/orders" || path === "/kitchen/orders/complete";
      const message = path === "/kitchen/orders/complete"
        ? "The kitchen update may have succeeded. Refresh the queue or retry the same update with the same key."
        : placingOrder
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
    createDishPhoto: (restaurantId: string, key: string, request: DishPhotoRequest, staffAccessToken: string, source?: File, signal?: AbortSignal) => {
      const form = new FormData(); form.set("restaurantId", restaurantId); form.set("key", z.uuid().parse(key)); form.set("request", JSON.stringify(dishPhotoRequestSchema.parse(request)));
      if (source) form.set("source", source);
      return call("/dish-photos", dishPhotoJobSchema, { method: "POST", body: form, headers: { Authorization: `Bearer ${staffAccessToken}` }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(185_000)]) : AbortSignal.timeout(185_000) });
    },
    readDishPhoto: (restaurantId: string, jobId: string, staffAccessToken: string) => call(`/dish-photos/${encodeURIComponent(jobId)}?restaurantId=${encodeURIComponent(restaurantId)}`, dishPhotoJobSchema, { headers: { Authorization: `Bearer ${staffAccessToken}` } }),
    findDishPhoto: (restaurantId: string, key: string, staffAccessToken: string) => call(`/dish-photos/by-key/${encodeURIComponent(key)}?restaurantId=${encodeURIComponent(restaurantId)}`, dishPhotoJobSchema, { headers: { Authorization: `Bearer ${staffAccessToken}` } }),
    dishPhotoPreview: async (restaurantId: string, jobId: string, staffAccessToken: string) => {
      const response = await fetcher(`${baseUrl}/api/v1/dish-photos/${encodeURIComponent(jobId)}/preview?restaurantId=${encodeURIComponent(restaurantId)}`, { cache: "no-store", credentials: "same-origin", headers: { Authorization: `Bearer ${staffAccessToken}` } });
      if (!response.ok) throw new ApiError("PHOTO_PREVIEW_UNAVAILABLE", "The photo preview is not ready. Check its status again.", response.status, false);
      const blob = await response.blob();
      if (blob.size > 8 * 1024 * 1024 || blob.type !== "image/jpeg") throw new ApiError("INVALID_RESPONSE", "The photo preview could not be verified.", response.status, false);
      return blob;
    },
    readPublishedPhotos: (restaurantId: string, menuId: string, menuVersion: number) => call(`/dish-photos/published?restaurantId=${encodeURIComponent(restaurantId)}&menuId=${encodeURIComponent(menuId)}&menuVersion=${menuVersion}`, publishedDishPhotosSchema),
    publishMenuWithPhotos: (menu: z.infer<typeof MenuSchema>, staffAccessToken: string, stallDetailsVersion: number, selections: z.infer<typeof dishPhotoSelectionSchema>[]) => call("/dish-photos/publish", z.strictObject({ menu: MenuSchema, photos: publishedDishPhotosSchema }), { method: "POST", headers: { Authorization: `Bearer ${staffAccessToken}` }, body: JSON.stringify({ restaurantId: menu.restaurantId, menu: MenuSchema.parse(menu), stallDetailsVersion, selections: z.array(dishPhotoSelectionSchema).max(100).parse(selections) }) }),
    extract: (photo: Blob, restaurantId: string, staffAccessToken: string) => call("/menu-extractions", extractedMenuDraftSchema, { method: "POST", body: photo, headers: { "Content-Type": photo.type, "X-Restaurant-Id": restaurantId, Authorization: `Bearer ${staffAccessToken}` } }),
    startLive: (sdp: string, restaurantId: string, staffAccessToken: string, signal?: AbortSignal) => call("/live/sessions", z.strictObject({ sessionId: z.string(), sdp: z.string(), model: z.literal("gpt-live-1"), orderingEnabled: z.literal(false), voiceSessionId: z.uuid(), expiresAt: z.iso.datetime({ offset: true }), reviewEnabled: z.literal(true) }), { method: "POST", body: JSON.stringify({ sdp, restaurantId }), headers: { Authorization: `Bearer ${staffAccessToken}` }, signal }),
    prepareVoiceReview: (voiceSessionId: string, text: string, fulfillmentType: "dine_in" | "takeaway", staffAccessToken: string) => call("/live/reviews", z.strictObject({ intent: IntentSchema, review: z.strictObject({ quote: QuoteSchema, confirmationNonce: z.uuid(), revision: z.number().int().positive() }).nullable() }), { method: "POST", body: JSON.stringify({ voiceSessionId, text, fulfillmentType }), headers: { Authorization: `Bearer ${staffAccessToken}` } }),
    confirmVoiceOrder: (voiceSessionId: string, confirmationNonce: string, staffAccessToken: string) => call("/live/orders", TicketSchema, { method: "POST", body: JSON.stringify({ voiceSessionId, confirmationNonce, confirmed: true }), headers: { Authorization: `Bearer ${staffAccessToken}` } }),
    closeVoiceSession: (voiceSessionId: string, staffAccessToken: string) => call("/live/close", z.strictObject({ ok: z.literal(true) }), { method: "POST", body: JSON.stringify({ voiceSessionId }), headers: { Authorization: `Bearer ${staffAccessToken}` } }),
    readMenu: (restaurantId: string) => call(`/menus/${encodeURIComponent(restaurantId)}`, MenuSchema),
    startGuest: (restaurantId: string) => call("/guest-sessions", z.strictObject({ restaurantId: z.uuid(), ready: z.literal(true) }), { method: "POST", body: JSON.stringify({ restaurantId }) }),
    publishMenu: (menu: z.infer<typeof MenuSchema>, staffAccessToken: string, stallDetailsVersion: number) => call("/menus/publish", MenuSchema, { method: "POST", headers: { Authorization: `Bearer ${staffAccessToken}` }, body: JSON.stringify({ menu: MenuSchema.parse(menu), stallDetailsVersion: z.number().int().positive().parse(stallDetailsVersion) }) }),
    readStallDetails: (restaurantId: string, staffAccessToken: string) => call(`/restaurants/${encodeURIComponent(restaurantId)}/details`, StallDetailsResponseSchema, { headers: { Authorization: `Bearer ${staffAccessToken}` } }),
    saveStallDetails: (restaurantId: string, input: z.infer<typeof SaveStallDetailsSchema>, staffAccessToken: string) => call(`/restaurants/${encodeURIComponent(restaurantId)}/details`, SavedStallDetailsResponseSchema, { method: "PUT", headers: { Authorization: `Bearer ${staffAccessToken}` }, body: JSON.stringify(SaveStallDetailsSchema.parse(input)) }),
    readPublishedStall: (restaurantId: string) => call(`/restaurants/${encodeURIComponent(restaurantId)}/published`, PublishedStallSchema),
    parseOrder: (restaurantId: string, menuId: string, menuVersion: number, text: string) => call("/orders/parse", IntentSchema, { method: "POST", body: JSON.stringify({ restaurantId, menuId, menuVersion, text }) }),
    quote: (cart: CartRequest) => call("/orders/quote", QuoteSchema, { method: "POST", body: JSON.stringify(CartRequestSchema.parse(cart)) }),
    submit: (input: z.infer<typeof SubmitSchema>, idempotencyKey: string) => {
      z.uuid().parse(idempotencyKey);
      return call("/orders", TicketSchema, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(SubmitSchema.parse(input)) });
    },
    kitchen: (restaurantId: string, staffAccessToken: string) => call(`/kitchen/${encodeURIComponent(restaurantId)}`, KitchenResponseSchema, { headers: { Authorization: `Bearer ${staffAccessToken}` } }),
    completeKitchenOrder: (input: z.infer<typeof CompleteKitchenOrderSchema>, idempotencyKey: string, staffAccessToken: string) => {
      z.uuid().parse(idempotencyKey);
      return call("/kitchen/orders/complete", TicketSchema, { method: "POST", headers: { "Idempotency-Key": idempotencyKey, Authorization: `Bearer ${staffAccessToken}` }, body: JSON.stringify(CompleteKitchenOrderSchema.parse(input)) });
    },
  };
}
