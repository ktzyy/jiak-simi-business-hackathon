import { backendHandlers } from "@/server/supabase-backend";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ restaurantId: string }> }) {
  return backendHandlers().menu(request, (await context.params).restaurantId);
}
