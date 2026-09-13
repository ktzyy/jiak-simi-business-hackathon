"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/supabase/auth-redirect";

function loginUrl(message: string, next = "/") {
  const params = new URLSearchParams({ message });
  if (next !== "/") params.set("next", next);
  return `/login?${params.toString()}`;
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));

  if (!email || !password) redirect(loginUrl("Enter your email and password.", next));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) redirect(loginUrl("Sign-in failed. Check your details and try again.", next));
  redirect(next);
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));

  if (!email || password.length < 8) {
    redirect(loginUrl("Use a valid email and a password of at least 8 characters.", next));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) redirect(loginUrl("Account creation could not be completed. Please try again.", next));
  if (data.session) redirect(next);
  redirect(loginUrl("Check your email to confirm your account, then sign in.", next));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
