import { backendHandlers } from "@/server/supabase-backend";

export const runtime = "nodejs";
export const POST = backendHandlers().completeKitchenOrder;
