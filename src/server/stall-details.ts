import "server-only";
import { Id } from "../shared/contracts";
import { PublishedStallSchema, SavedStallDetailsResponseSchema, SaveStallDetailsSchema, StallDetailsResponseSchema } from "../shared/stall-details";
import { errorResponse, HttpError, readBoundedBody } from "./http";
import { databaseRpc, getBackendClient, requireSameOrigin, verifiedActor, type BackendClient } from "./supabase-backend";

export function stallDetailsHandlers(factory: () => BackendClient = getBackendClient) {
  const id = (value: string) => { const result = Id.safeParse(value); if (!result.success) throw new HttpError(400, "INVALID_REQUEST", "A restaurant identifier is required."); return result.data; };
  const json = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
  const run = async (fn: () => Promise<Response>) => { try { return await fn(); } catch (error) { return errorResponse(error); } };
  return {
    read: (request: Request, restaurantId: string) => run(async () => {
      const restaurant = id(restaurantId), client = factory(), actor = await verifiedActor(request, client);
      const result = await databaseRpc(client, "read_stall_details", { p_actor_id: actor, p_restaurant_id: restaurant }, StallDetailsResponseSchema);
      if (result.details && result.details.restaurantId !== restaurant) throw new HttpError(502, "INVALID_RESPONSE", "Stall details did not match the restaurant.");
      return json(result);
    }),
    save: (request: Request, restaurantId: string) => run(async () => {
      requireSameOrigin(request);
      const restaurant = id(restaurantId), client = factory(), actor = await verifiedActor(request, client);
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new HttpError(415, "INVALID_CONTENT_TYPE", "Send JSON stall details.");
      let value: unknown;
      try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(request, 20_000))); }
      catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "INVALID_REQUEST", "Send valid JSON stall details."); }
      const parsed = SaveStallDetailsSchema.safeParse(value);
      if (!parsed.success) throw new HttpError(400, "INVALID_STALL_DETAILS", "Set the stall name and all seven opening days with valid, non-overlapping hours.");
      const { expectedVersion, ...details } = parsed.data;
      const result = await databaseRpc(client, "save_stall_details", { p_actor_id: actor, p_restaurant_id: restaurant, p_expected_version: expectedVersion, p_details: details }, SavedStallDetailsResponseSchema);
      if (result.details.restaurantId !== restaurant || result.details.version !== expectedVersion + 1) throw new HttpError(502, "INVALID_RESPONSE", "The saved stall details did not match the requested version.");
      return json(result);
    }),
    published: (_request: Request, restaurantId: string) => run(async () => {
      const restaurant = id(restaurantId);
      const result = await databaseRpc(factory(), "read_published_stall", { p_restaurant_id: restaurant }, PublishedStallSchema);
      if (result.menu.restaurantId !== restaurant || (result.details && result.details.restaurantId !== restaurant)) throw new HttpError(502, "INVALID_RESPONSE", "Published details did not match the restaurant.");
      return json(result);
    }),
  };
}
