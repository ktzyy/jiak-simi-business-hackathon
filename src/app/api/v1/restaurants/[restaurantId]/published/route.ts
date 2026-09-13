import { stallDetailsHandlers } from "@/server/stall-details";

export const runtime = "nodejs";
const handlers = stallDetailsHandlers();
export async function GET(request: Request, context: { params: Promise<{ restaurantId: string }> }) {
  return handlers.published(request, (await context.params).restaurantId);
}
