import { backendHandlers } from "@/server/supabase-backend";
export const runtime = "nodejs";
export async function POST(request: Request) { return backendHandlers().submit(request); }
