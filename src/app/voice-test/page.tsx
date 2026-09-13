import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HandsfreeVoiceTest } from "./handsfree-voice-test";
import { voiceRelayConfigured } from "@/server/ai/live-relay-proxy";

export default async function VoiceTestPage() {
  if (process.env.NODE_ENV === "production" && !voiceRelayConfigured()) notFound();
  if (process.env.DEMO_MODE === "true") return <HandsfreeVoiceTest publicDemo />;
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login?next=%2Fvoice-test");
  return <HandsfreeVoiceTest />;
}
