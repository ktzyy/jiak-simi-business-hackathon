import { backendHandlers } from "@/server/supabase-backend";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ restaurantId: string }> }) {
  return backendHandlers().kitchen(request, (await context.params).restaurantId);
}
