import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { completeAuthConfirmation, safeNextPath } from "@/lib/supabase/auth-redirect";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = params.getAll("next").length <= 1 ? safeNextPath(params.get("next")) : "/";
  const confirmed = await completeAuthConfirmation(params, async () => (await createClient()).auth);
  const destination = new URL(confirmed ? next : "/login", request.url);
  if (!confirmed) destination.searchParams.set("message", "That confirmation link is invalid or expired.");
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
