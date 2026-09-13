export function getPublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured. Add the project URL and publishable key to .env.local.",
    );
  }

  if (url.replace(/\/$/, "") !== "https://mikpepfrumtglwweolzq.supabase.co") {
    throw new Error("Auth must use the approved Jiak Simi hackathon project.");
  }
  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error("Use the Supabase publishable key for browser Auth.");
  }

  return { url, publishableKey };
}
