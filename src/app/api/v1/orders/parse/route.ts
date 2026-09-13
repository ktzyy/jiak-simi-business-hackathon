import { z } from "zod";
import { Id, MenuSchema } from "@/shared/contracts";
import { parseOrderIntent, OrderIntentError } from "@/server/ai/order-intent";
import { databaseRpc, getBackendClient, guestTokenHash, requireSameOrigin } from "@/server/supabase-backend";
import { errorResponse, HttpError, readBoundedBody } from "@/server/http";

export const runtime = "nodejs";
const RequestSchema = z.strictObject({ restaurantId: Id, menuId: Id, menuVersion: z.number().int().positive(), text: z.string().trim().min(1).max(4000) });
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(await readBoundedBody(request, 20_000))); }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "INVALID_REQUEST", "Expected a text order and menu version."); }
    const parsed = RequestSchema.safeParse(value);
    if (!parsed.success) throw new HttpError(400, "INVALID_REQUEST", "Expected a text order and menu version.");
    const input = parsed.data, client = getBackendClient();
    const tokenHash = guestTokenHash(request, input.restaurantId);
    await databaseRpc(client, "validate_guest_session", { p_session_token_hash: tokenHash, p_restaurant_id: input.restaurantId }, Id);
    const menu = await databaseRpc(client, "read_published_menu", { p_restaurant_id: input.restaurantId }, MenuSchema);
    if (menu.id !== input.menuId || menu.version !== input.menuVersion) throw new HttpError(409, "STALE_MENU", "The menu changed. Review the current menu.");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new HttpError(503, "NOT_CONFIGURED", "Order interpretation is not configured.");
    await databaseRpc(client, "consume_guest_ai_budget", { p_session_token_hash: tokenHash, p_restaurant_id: input.restaurantId }, Id);
    const intent = await parseOrderIntent(menu, input.text, { apiKey, signal: request.signal });
    return Response.json(intent, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error instanceof OrderIntentError ? new HttpError(502, "MODEL_ERROR", error.message) : error);
  }
}
