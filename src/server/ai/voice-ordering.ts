import "server-only";
import { z } from "zod";
import { CartRequestSchema, FulfillmentTypeSchema, Id, MenuSchema, QuoteSchema, TicketSchema } from "../../shared/contracts";
import { errorResponse, HttpError, readBoundedBody } from "../http";
import { databaseRpc, getBackendClient, requireSameOrigin, verifiedActor, type BackendClient } from "../supabase-backend";
import { createLiveSession, liveMenuInstructions } from "./live-session";
import { closeLiveSession } from "./live-close";
import { parseOrderIntent } from "./order-intent";

const Session = z.object({ id: Id, restaurantId: Id, providerSessionId: z.string().min(1).max(512), status: z.enum(["active", "closed"]), sessionTokenHash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.iso.datetime({ offset: true }) });
const Review = z.strictObject({ quote: QuoteSchema, confirmationNonce: Id, revision: z.number().int().positive() });

async function body<T>(request: Request, schema: z.ZodType<T>, limit = 20_000): Promise<T> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new HttpError(415, "INVALID_CONTENT_TYPE", "Send a JSON request.");
  let input: unknown;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(request, limit))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "INVALID_REQUEST", "Send a valid voice request."); }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "INVALID_REQUEST", "Send a valid voice request.");
  return parsed.data;
}

export function voiceHandlers(dependencies: {
  backend?: () => BackendClient;
  create?: typeof createLiveSession;
  parse?: typeof parseOrderIntent;
  closeProvider?: (sessionId: string, apiKey: string) => Promise<void>;
} = {}) {
  const factory = dependencies.backend ?? getBackendClient;
  const closeProvider = dependencies.closeProvider ?? closeLiveSession;
  const run = (fn: (request: Request) => Promise<Response>) => async (request: Request) => {
    try { requireSameOrigin(request); return await fn(request); } catch (error) { return errorResponse(error); }
  };
  const json = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
  const key = () => { const value = process.env.OPENAI_API_KEY; if (!value) throw new HttpError(503, "NOT_CONFIGURED", "Voice is not configured."); return value; };
  async function owned(request: Request, id: string) {
    const client = factory(), actor = await verifiedActor(request, client);
    const session = await databaseRpc(client, "read_voice_session", { p_actor_id: actor, p_voice_session_id: id }, Session);
    if (session.id !== id) throw new HttpError(502, "INVALID_RESPONSE", "Voice session mismatch.");
    return { client, actor, session };
  }
  function active(session: z.infer<typeof Session>) {
    if (session.status !== "active" || Date.parse(session.expiresAt) <= Date.now()) throw new HttpError(409, "VOICE_SESSION_EXPIRED", "Start a fresh voice order.");
  }
  return {
    create: run(async request => {
      // Until a server scheduler enforces provider audio lifetime, supervise locally.
      if (process.env.NODE_ENV === "production") throw new HttpError(503, "NOT_CONFIGURED", "Voice ordering is a supervised local demo pending server-enforced audio lifetime.");
      const input = await body(request, z.strictObject({ restaurantId: Id, sdp: z.string().startsWith("v=0").max(65_536) }), 70_000);
      const client = factory(), actor = await verifiedActor(request, client), apiKey = key();
      await databaseRpc(client, "consume_staff_ai_budget", { p_actor_id: actor, p_restaurant_id: input.restaurantId, p_operation: "voice" }, Id);
      const menu = await databaseRpc(client, "read_published_menu", { p_restaurant_id: input.restaurantId }, MenuSchema);
      if (menu.restaurantId !== input.restaurantId) throw new HttpError(502, "INVALID_RESPONSE", "Menu restaurant mismatch.");
      const result = await (dependencies.create ?? createLiveSession)({ sdp: input.sdp, instructions: liveMenuInstructions(menu) }, { apiKey, signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]) });
      try {
        const session = await databaseRpc(client, "create_voice_session", { p_actor_id: actor, p_restaurant_id: input.restaurantId, p_provider_session_id: result.sessionId }, Session);
        if (session.restaurantId !== input.restaurantId || session.providerSessionId !== result.sessionId) throw new HttpError(502, "INVALID_RESPONSE", "Voice session mismatch.");
        return json({ ...result, voiceSessionId: session.id, expiresAt: session.expiresAt, reviewEnabled: true });
      } catch (error) {
        // Do not return audio when durable ownership was not saved.
        await closeProvider(result.sessionId, apiKey).catch(() => undefined);
        throw error;
      }
    }),
    review: run(async request => {
      const input = await body(request, z.strictObject({ voiceSessionId: Id, text: z.string().trim().min(1).max(4000), fulfillmentType: FulfillmentTypeSchema }));
      const { client, actor, session } = await owned(request, input.voiceSessionId);
      active(session);
      const { revision } = await databaseRpc(client, "begin_voice_review", { p_actor_id: actor, p_voice_session_id: session.id }, z.strictObject({ revision: z.number().int().positive() }));
      const menu = await databaseRpc(client, "read_published_menu", { p_restaurant_id: session.restaurantId }, MenuSchema);
      if (menu.restaurantId !== session.restaurantId) throw new HttpError(502, "INVALID_RESPONSE", "Menu restaurant mismatch.");
      const apiKey = key();
      await databaseRpc(client, "consume_guest_ai_budget", { p_session_token_hash: session.sessionTokenHash, p_restaurant_id: session.restaurantId }, Id);
      const intent = await (dependencies.parse ?? parseOrderIntent)(menu, input.text, { apiKey, signal: request.signal, fulfillmentType: input.fulfillmentType });
      if (intent.fulfillmentType !== input.fulfillmentType) {
        intent.fulfillmentType = null;
        intent.issues.push({ code: "FULFILLMENT_REQUIRED", message: "Your spoken order and selected dining option need clarification.", lineIndex: null });
      }
      if (intent.issues.length || !intent.lines.length) return json({ intent, review: null });
      const cart = CartRequestSchema.parse({ restaurantId: menu.restaurantId, menuId: menu.id, menuVersion: menu.version, fulfillmentType: input.fulfillmentType, lines: intent.lines });
      const review = await databaseRpc(client, "save_voice_review", { p_actor_id: actor, p_voice_session_id: session.id, p_cart: cart, p_revision: revision }, Review);
      return json({ intent, review });
    }),
    submit: run(async request => {
      // This handler is called by the user's review button, never by the model.
      const input = await body(request, z.strictObject({ voiceSessionId: Id, confirmationNonce: Id, confirmed: z.literal(true) }));
      const client = factory(), actor = await verifiedActor(request, client);
      const ticket = await databaseRpc(client, "submit_voice_order", { p_actor_id: actor, p_voice_session_id: input.voiceSessionId, p_confirmation_nonce: input.confirmationNonce }, TicketSchema);
      if (ticket.source !== "voice") throw new HttpError(502, "INVALID_RESPONSE", "Order channel mismatch.");
      return json(ticket);
    }),
    close: run(async request => {
      const input = await body(request, z.strictObject({ voiceSessionId: Id }));
      const { client, actor, session } = await owned(request, input.voiceSessionId);
      if (session.status !== "closed") {
        await closeProvider(session.providerSessionId, key());
        await databaseRpc(client, "close_voice_session", { p_actor_id: actor, p_voice_session_id: session.id }, z.strictObject({ ok: z.literal(true) }));
      }
      return json({ ok: true });
    }),
  };
}
