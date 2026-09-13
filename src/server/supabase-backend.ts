import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CartRequestSchema, CompleteKitchenOrderSchema, Id, KitchenResponseSchema, MenuSchema, QuoteSchema, SubmitSchema, TicketSchema } from "../shared/contracts";
import { errorResponse, HttpError, readBoundedBody } from "./http";

const STAGING_URL = "https://mikpepfrumtglwweolzq.supabase.co";
export interface BackendClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
  auth: { getUser(jwt: string): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
}

export function getBackendClient(): BackendClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url?.replace(/\/$/, "") !== STAGING_URL || !key?.trim()) {
    throw new HttpError(503, "NOT_CONFIGURED", "The staging database service is not configured.");
  }
  return createClient(STAGING_URL, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}

// Only these database-owned business codes may cross the HTTP boundary.
const faults: Record<string, [number, string]> = {
  FORBIDDEN: [403, "Restaurant access is required."],
  INVALID_SESSION: [401, "Start a customer session for this restaurant."],
  SESSION_EXPIRED: [401, "The customer session has expired."],
  MENU_NOT_FOUND: [404, "No published menu was found."],
  RESTAURANT_NOT_FOUND: [404, "The restaurant was not found."],
  UNKNOWN_RESTAURANT: [404, "The restaurant was not found."],
  UNKNOWN_MENU: [404, "No published menu was found."],
  STALE_MENU: [409, "The menu changed. Review a fresh quote before placing your order."],
  STALE_REVIEW: [409, "This review is no longer current. Prepare and confirm a fresh review."],
  STALE_STATUS: [409, "This kitchen ticket changed. Refresh the queue before continuing."],
  INVALID_STATUS_TRANSITION: [409, "This ticket is already done. Refresh the queue."],
  ORDER_NOT_FOUND: [404, "This kitchen ticket could not be found."],
  STALE_STALL_DETAILS: [409, "Stall details changed. Review the latest details before saving or publishing."],
  INVALID_STALL_DETAILS: [400, "Check the stall name and opening hours."],
  STALL_DETAILS_REQUIRED: [409, "Save and review the stall details before publishing."],
  INVALID_LEASE: [409, "This message is being handled by another request. Please wait."],
  IDEMPOTENCY_CONFLICT: [409, "This submission key was already used for different order contents."],
  PRICE_CHANGED: [409, "The total changed. Review a fresh quote before placing your order."],
  INVALID_CART: [400, "The cart could not be validated."],
  INVALID_MENU: [400, "The menu could not be validated."],
  INVALID_QUANTITY: [400, "A quantity is invalid."],
  UNKNOWN_DISH: [400, "A dish is not on the published menu."],
  UNKNOWN_OPTION: [400, "A selected option is not supported."],
  INVALID_MODIFIERS: [400, "Review the selected modifiers."],
  INVALID_OPTIONS: [400, "Review the selected modifiers."],
  INVALID_REQUEST: [400, "The request could not be validated."],
  RATE_LIMITED: [429, "Please wait before making another request."],
  DISH_UNAVAILABLE: [409, "A dish is no longer available."],
};

export async function databaseRpc<T>(client: BackendClient, name: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const code = error.code === "P0001" ? error.message ?? "" : "";
    const fault = Object.hasOwn(faults, code) ? faults[code] : undefined;
    if (fault) throw new HttpError(fault[0], code, fault[1]);
    throw new HttpError(502, "DATABASE_ERROR", "The database could not complete this request.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new HttpError(502, "INVALID_RESPONSE", "The database response did not match the contract.");
  return parsed.data;
}
const rpc = databaseRpc;

export async function verifiedActor(request: Request, client: BackendClient): Promise<string> {
  const token = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) throw new HttpError(401, "UNAUTHORIZED", "Sign in to the restaurant staff account.");
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user || !Id.safeParse(data.user.id).success) throw new HttpError(401, "UNAUTHORIZED", "The staff session could not be verified.");
  return data.user.id;
}

export function requireSameOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN || new URL(request.url).origin;
  if (request.headers.get("origin") !== expected ||
      (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) {
    throw new HttpError(403, "ORIGIN_REJECTED", "Use this application's ordering page.");
  }
}

export function guestCookieName(restaurantId: string): string {
  return `${process.env.NODE_ENV === "production" ? "__Host-" : ""}jiak_guest_${Id.parse(restaurantId)}`;
}
export function hashGuestToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function guestTokenHash(request: Request, restaurantId: string): string {
  const name = guestCookieName(restaurantId);
  const tokens = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
  const token = tokens.length === 1 ? tokens[0].slice(name.length + 1) : "";
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, "INVALID_SESSION", "Start a customer session for this restaurant.");
  return hashGuestToken(token);
}

async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new HttpError(415, "INVALID_CONTENT_TYPE", "Send a JSON request.");
  }
  const bytes = await readBoundedBody(request, 256_000);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new HttpError(400, "INVALID_REQUEST", "The JSON request is invalid."); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "INVALID_REQUEST", "The request did not match the contract.");
  return parsed.data;
}
function uuid(value: string | null): string {
  const parsed = Id.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "INVALID_REQUEST", "A valid identifier is required.");
  return parsed.data;
}
function json(value: unknown, headers?: HeadersInit) {
  return Response.json(value, { headers: { "Cache-Control": "no-store", ...headers } });
}

// Injectable client is for offline integration tests. Routes use the fail-closed factory.
export function backendHandlers(factory: () => BackendClient = getBackendClient) {
  async function run(action: () => Promise<Response>) { try { return await action(); } catch (error) { return errorResponse(error); } }
  return {
    menu: (request: Request, restaurantId: string) => run(async () => json(await rpc(factory(), "read_published_menu", { p_restaurant_id: uuid(restaurantId) }, MenuSchema))),
    guest: (request: Request) => run(async () => {
      requireSameOrigin(request);
      const { restaurantId } = await body(request, z.strictObject({ restaurantId: Id }));
      const client = factory();
      // A reload must not replace the capability needed to recover an uncertain order.
      try {
        const hash = guestTokenHash(request, restaurantId);
        await rpc(client, "validate_guest_session", { p_session_token_hash: hash, p_restaurant_id: restaurantId }, Id);
        return json({ restaurantId, ready: true });
      } catch (error) {
        if (!(error instanceof HttpError) || error.code !== "INVALID_SESSION") throw error;
      }
      const token = randomBytes(32).toString("hex");
      await rpc(client, "create_guest_session", { p_restaurant_id: restaurantId, p_token_hash: hashGuestToken(token) }, Id);
      return json({ restaurantId, ready: true }, { "Set-Cookie": `${guestCookieName(restaurantId)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${process.env.NODE_ENV === "production" ? "; Secure" : ""}` });
    }),
    quote: (request: Request) => run(async () => {
      requireSameOrigin(request);
      const cart = await body(request, CartRequestSchema);
      return json(await rpc(factory(), "quote_cart", { p_session_token_hash: guestTokenHash(request, cart.restaurantId), p_cart: cart }, QuoteSchema));
    }),
    submit: (request: Request) => run(async () => {
      requireSameOrigin(request);
      const input = await body(request, SubmitSchema);
      const key = uuid(request.headers.get("idempotency-key"));
      return json(await rpc(factory(), "submit_order", { p_session_token_hash: guestTokenHash(request, input.cart.restaurantId), p_cart: input.cart, p_reviewed_total_cents: input.reviewedTotalCents, p_source: "web", p_idempotency_key: key }, TicketSchema));
    }),
    kitchen: (request: Request, restaurantId: string) => run(async () => {
      const id = uuid(restaurantId), client = factory();
      const actor = await verifiedActor(request, client);
      return json(await rpc(client, "read_kitchen_orders", { p_restaurant_id: id, p_actor_id: actor }, KitchenResponseSchema));
    }),
    completeKitchenOrder: (request: Request) => run(async () => {
      requireSameOrigin(request);
      const client = factory(), actor = await verifiedActor(request, client);
      const input = await body(request, CompleteKitchenOrderSchema);
      const key = uuid(request.headers.get("idempotency-key"));
      return json(await rpc(client, "complete_kitchen_order", { p_actor_id: actor, p_restaurant_id: input.restaurantId, p_order_id: input.orderId, p_expected_status_version: input.expectedStatusVersion, p_idempotency_key: key }, TicketSchema));
    }),
    publish: (request: Request) => run(async () => {
      requireSameOrigin(request);
      const client = factory(), actor = await verifiedActor(request, client);
      const { menu, stallDetailsVersion } = await body(request, z.strictObject({ menu: MenuSchema, stallDetailsVersion: z.number().int().positive() }));
      return json(await rpc(client, "publish_menu", { p_restaurant_id: menu.restaurantId, p_actor_id: actor, p_menu: menu, p_stall_details_version: stallDetailsVersion }, MenuSchema));
    }),
  };
}
