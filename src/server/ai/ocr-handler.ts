import "server-only";
import { Id } from "../../shared/contracts";
import { errorResponse, HttpError, readBoundedBody } from "../http";
import { databaseRpc, getBackendClient, requireSameOrigin, verifiedActor, type BackendClient } from "../supabase-backend";
import { extractMenu, MAX_MENU_IMAGE_BYTES, MenuExtractionError, validateMenuImage } from "./menu-extraction";

export function createOcrHandler(dependencies: {
  backend?: () => BackendClient;
  apiKey?: () => string | undefined;
  extract?: typeof extractMenu;
} = {}) {
  return async (request: Request): Promise<Response> => {
    try {
      requireSameOrigin(request);
      const restaurant = Id.safeParse(request.headers.get("x-restaurant-id"));
      if (!restaurant.success) throw new HttpError(400, "INVALID_REQUEST", "Choose the stall whose menu you're uploading.");
      const client = (dependencies.backend ?? getBackendClient)();
      const actor = await verifiedActor(request, client, restaurant.data);
      const apiKey = (dependencies.apiKey ?? (() => process.env.OPENAI_API_KEY))();
      if (!apiKey?.trim()) throw new HttpError(503, "NOT_CONFIGURED", "Menu photo reading isn't available yet. Please enter your menu manually.");
      const image = await readBoundedBody(request, MAX_MENU_IMAGE_BYTES);
      const mimeType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      validateMenuImage(image, mimeType);
      // The database validates active owner/editor membership and atomically consumes the paid budget.
      await databaseRpc(client, "consume_staff_ai_budget", {
        p_actor_id: actor, p_restaurant_id: restaurant.data, p_operation: "extraction",
      }, Id);
      const draft = await (dependencies.extract ?? extractMenu)({ image, mimeType }, { apiKey, signal: request.signal });
      return Response.json(draft, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof MenuExtractionError) {
        return errorResponse(new HttpError(error.code === "invalid_image" ? 400 : 502, error.code.toUpperCase(), error.message));
      }
      return errorResponse(error);
    }
  };
}
