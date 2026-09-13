"use client";
import { createClient } from "@/lib/supabase/client";
import { PUBLIC_DEMO_BEARER } from "@/shared/public-demo";
import { ApiError } from "@/shared/api-client";

// Public demo uses a labelled sentinel, never an Auth session or privileged key.
// The server separately gates it and enforces the fixed dummy restaurant.
export async function getStaffAccessToken(): Promise<string> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return PUBLIC_DEMO_BEARER;
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session?.access_token) {
    throw new ApiError("UNAUTHORIZED", "Please sign in again to open your stall workspace.", 401, false);
  }
  return data.session.access_token;
}
