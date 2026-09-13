import { stallDetailsHandlers } from "@/server/stall-details";

export const runtime = "nodejs";
const handlers = stallDetailsHandlers();
export async function GET(request: Request, context: { params: Promise<{ restaurantId: string }> }) {
  return handlers.read(request, (await context.params).restaurantId);
}
export async function PUT(request: Request, context: { params: Promise<{ restaurantId: string }> }) {
  return handlers.save(request, (await context.params).restaurantId);
}
