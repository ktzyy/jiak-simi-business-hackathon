import "server-only";
import { z } from "zod";
import { Id, CartRequestSchema, MenuSchema, QuoteSchema, TicketSchema, type Intent, type Menu } from "../../shared/contracts";
import { databaseRpc, getBackendClient, requireSameOrigin, verifiedActor, type BackendClient } from "../supabase-backend";
import { errorResponse, HttpError, readBoundedBody } from "../http";
import { createLiveSession, handsfreeMenuInstructions } from "./live-session";
import { closeLiveSession } from "./live-close";
import { LiveButler, attachButler } from "./live-butler";
import { explicitFulfillmentType, parseOrderIntent } from "./order-intent";
import { speakQuote, transcribeConfirmation } from "./live-confirmation-audio";
import { speakCachedQuote } from "./live-speech-cache";
import { PUBLIC_DEMO_RESTAURANT_ID } from "../../shared/public-demo";
import { HandsfreeCommand as Command, HANDSFREE_BODY_LIMIT } from "./live-handsfree-contract";

const Session = z.object({ id: Id, restaurantId: Id, providerSessionId: z.string(), sessionTokenHash: z.string(), status: z.enum(["active", "closed"]), expiresAt: z.iso.datetime({ offset: true }) });
const Review = z.strictObject({ quote: QuoteSchema, confirmationNonce: Id, revision: z.number().int().positive() });
// Local dev only. Hot reload keeps a single owner. A process restart intentionally
// loses confirmation authority; the old database session cannot be re-armed.
const host = globalThis as typeof globalThis & { jiakLocalButlers?: Map<string, LiveButler> };
const registry = host.jiakLocalButlers ??= new Map<string, LiveButler>();

export const normalizeVoiceDiningText = (text: string) => text.replace(/\b(?:da[ -]?bao|ta[ -]?pao|bungkus)\b/gi, "takeaway").replace(/\b(?:having here|eat here|makan here)\b/gi, "dine in");
const mentionsDiningMode = (text: string) => /\b(?:dine[ -]?in|for here|eat here|take[ -]?away|to go)\b/i.test(normalizeVoiceDiningText(text));
/** Explicitly approved defaults for this voice demo only. Never alter web carts. */
export function applyVoiceDefaults(intent: Intent, menu: Menu, text: string): Intent {
  const fulfillmentType = intent.fulfillmentType ?? (!mentionsDiningMode(text) ? "dine_in" : null);
  const avoidChilli = /\b(?:no|without|less)\s+chill?i\b|\bnot\s+spicy\b/i.test(text);
  return {
    ...intent, fulfillmentType,
    issues: fulfillmentType ? intent.issues.filter(issue => issue.code !== "FULFILLMENT_REQUIRED") : intent.issues,
    lines: intent.lines.map(line => {
      const optionIds = [...line.optionIds];
      if (!avoidChilli) for (const group of menu.dishes.find(dish => dish.id === line.dishId)?.modifierGroups ?? []) {
        const chilli = group.options.find(option => /^chill?i$/i.test(option.name.trim()) && option.priceDeltaCents === 0);
        if (chilli && group.minSelections === 0 && group.maxSelections >= 1 && !group.options.some(option => optionIds.includes(option.id))) optionIds.push(chilli.id);
      }
      return { ...line, optionIds };
    }),
  };
}

export function handsfreeHandler(deps: { backend?: () => BackendClient; create?: typeof createLiveSession; attach?: typeof attachButler; speech?: typeof speakQuote; transcribe?: typeof transcribeConfirmation; parse?: typeof parseOrderIntent; close?: typeof closeLiveSession; sessions?: Map<string, LiveButler>; now?: () => number } = {}) {
  const sessions = deps.sessions ?? registry;
  return async function POST(request: Request) {
    try {
      if (process.env.NODE_ENV === "production") throw new HttpError(503, "NOT_CONFIGURED", "Hands-free voice currently requires the supervised local runtime.");
      requireSameOrigin(request);
      const client = (deps.backend ?? getBackendClient)(), actor = await verifiedActor(request, client, PUBLIC_DEMO_RESTAURANT_ID);
      if (!request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError(415, "INVALID_CONTENT_TYPE", "Send JSON.");
      let input: z.infer<typeof Command>;
      try { input = Command.parse(JSON.parse(new TextDecoder().decode(await readBoundedBody(request, HANDSFREE_BODY_LIMIT)))); }
      catch { throw new HttpError(400, "INVALID_REQUEST", "Invalid voice command."); }
      const json = (data: unknown) => Response.json(data, { headers: { "Cache-Control": "no-store" } });
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new HttpError(503, "NOT_CONFIGURED", "Voice is not configured.");
      if (input.action === "start") {
        if (input.restaurantId !== PUBLIC_DEMO_RESTAURANT_ID) throw new HttpError(403, "FORBIDDEN", "This local voice demo is restricted to the dummy stall.");
        for (const [id, item] of sessions) if (["closed", "error"].includes(item.status().phase)) sessions.delete(id);
        if ([...sessions.values()].some(item => item.actor === actor && !["closed", "error"].includes(item.status().phase))) throw new HttpError(409, "VOICE_ALREADY_ACTIVE", "Stop your existing voice session first.");
        if (sessions.size >= 10) throw new HttpError(429, "VOICE_LIMIT", "The local voice demo is full.");
        await databaseRpc(client, "consume_staff_ai_budget", { p_actor_id: actor, p_restaurant_id: input.restaurantId, p_operation: "voice" }, Id);
        const menu = await databaseRpc(client, "read_published_menu", { p_restaurant_id: input.restaurantId }, MenuSchema);
        if (menu.restaurantId !== input.restaurantId) throw new Error("Menu mismatch.");
        const answer = await (deps.create ?? createLiveSession)({ sdp: input.sdp, instructions: handsfreeMenuInstructions(menu), handsfree: true }, { apiKey: key, signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]) });
        try {
          const session = await databaseRpc(client, "create_voice_session", { p_actor_id: actor, p_restaurant_id: input.restaurantId, p_provider_session_id: answer.sessionId }, Session);
          if (session.providerSessionId !== answer.sessionId || session.restaurantId !== input.restaurantId) throw new Error("Session mismatch.");
          const args = { p_actor_id: actor, p_voice_session_id: session.id };
          const budget = () => databaseRpc(client, "consume_guest_ai_budget", { p_session_token_hash: session.sessionTokenHash, p_restaurant_id: session.restaurantId }, Id);
          const butler = await (deps.attach ?? attachButler)(answer.sessionId, key, send => new LiveButler(actor, session.id, {
            send, now: deps.now,
            invalidate: async () => { await databaseRpc(client, "begin_voice_review", args, z.object({ revision: z.number() })); },
            prepare: async text => {
              const { revision } = await databaseRpc(client, "begin_voice_review", args, z.object({ revision: z.number().int().positive() }));
              const current = await databaseRpc(client, "read_published_menu", { p_restaurant_id: session.restaurantId }, MenuSchema);
              if (current.restaurantId !== session.restaurantId) throw new Error("Menu mismatch.");
              await budget();
              const normalizedText = normalizeVoiceDiningText(text);
              const selectedMode = explicitFulfillmentType(normalizedText) ?? (!mentionsDiningMode(normalizedText) ? "dine_in" : undefined);
              const parsed = await (deps.parse ?? parseOrderIntent)(current, normalizedText, { apiKey: key, signal: AbortSignal.timeout(25000), fulfillmentType: selectedMode });
              const intent = applyVoiceDefaults(parsed, current, text);
              if (intent.issues.length || !intent.lines.length || !intent.fulfillmentType) return null;
              const cart = CartRequestSchema.parse({ restaurantId: current.restaurantId, menuId: current.id, menuVersion: current.version, fulfillmentType: intent.fulfillmentType, lines: intent.lines });
              return databaseRpc(client, "save_voice_review", { ...args, p_cart: cart, p_revision: revision }, Review);
            },
            speech: async text => { await budget(); return (deps.speech ?? speakCachedQuote)(text, key); },
            transcribe: async wav => { await budget(); return (deps.transcribe ?? transcribeConfirmation)(wav, key); },
            submit: async nonce => {
              // The database keeps the receipt under this nonce. Recover one
              // uncertain transport response using the exact same confirmation.
              const submit = () => databaseRpc(client, "submit_voice_order", { ...args, p_confirmation_nonce: nonce }, TicketSchema);
              let ticket;
              try { ticket = await submit(); }
              catch (error) {
                if (!(error instanceof HttpError) || error.code !== "DATABASE_ERROR") throw error;
                ticket = await submit();
              }
              if (ticket.source !== "voice" || ticket.cart.restaurantId !== session.restaurantId) throw new Error("Ticket mismatch.");
              return ticket;
            },
            close: async () => {
              // Invalidate database confirmation before waiting on the provider.
              await databaseRpc(client, "close_voice_session", args, z.object({ ok: z.literal(true) }));
              await (deps.close ?? closeLiveSession)(answer.sessionId, key);
            },
          }));
          sessions.set(session.id, butler);
          return json({ ...answer, voiceSessionId: session.id, expiresAt: session.expiresAt, handsfree: true });
        } catch (error) { await (deps.close ?? closeLiveSession)(answer.sessionId, key).catch(() => undefined); throw error; }
      }
      const butler = sessions.get(input.voiceSessionId);
      if (!butler || butler.actor !== actor) throw new HttpError(404, "VOICE_SESSION_NOT_FOUND", "Start a new local voice session.");
      // Revalidate membership at every device action, even with a live controller.
      const session = await databaseRpc(client, "read_voice_session", { p_actor_id: actor, p_voice_session_id: input.voiceSessionId }, Session);
      if (session.restaurantId !== PUBLIC_DEMO_RESTAURANT_ID || session.id !== input.voiceSessionId) throw new HttpError(403, "FORBIDDEN", "This voice session is outside the dummy stall.");
      if (input.action === "close") { await butler.stop(); return json({ ok: true }); }
      // Closing invalidates the database review, but its diagnostic/receipt still
      // belongs to this re-authorized device. Do not hide it behind an expiry error.
      if (input.action === "status" && ["closed", "error", "submitted"].includes(butler.status().phase)) return json(butler.status());
      if (session.status !== "active" || Date.parse(session.expiresAt) <= Date.now()) { await butler.stop(); throw new HttpError(409, "VOICE_SESSION_EXPIRED", "Start a new voice session."); }
      if (input.action === "greet") await butler.greet();
      if (input.action === "draft") butler.previewTranscript(input.text);
      if (input.action === "audio") return json({ audio: butler.takeAudio(input.readbackId).toString("base64") });
      if (input.action === "playback") butler.playbackEnded(input.readbackId);
      if (input.action === "confirm") await butler.confirm(input.readbackId, Buffer.from(input.audio, "base64"));
      return json(butler.status());
    } catch (error) { return errorResponse(error); }
  };
}
