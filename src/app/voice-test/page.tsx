import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VoiceTest } from "./voice-test";

export default async function VoiceTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login?next=%2Fvoice-test");
  return <VoiceTest />;
}
