"use client";
import { createClient } from "@/lib/supabase/client";
import { ApiError } from "@/shared/api-client";

// Only retrieves the existing session; the API verifies restaurant membership.
export async function getStaffAccessToken(): Promise<string> {
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session?.access_token) {
    throw new ApiError("UNAUTHORIZED", "Please sign in again to open your stall workspace.", 401, false);
  }
  return data.session.access_token;
}
