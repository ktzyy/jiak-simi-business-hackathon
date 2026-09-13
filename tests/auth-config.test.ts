import test from "node:test";
import assert from "node:assert/strict";
import { getPublicSupabaseConfig } from "../src/lib/supabase/config";

test("browser Auth refuses another project and server-only credentials", () => {
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  try {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mikpepfrumtglwweolzq.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_fixture";
  assert.equal(getPublicSupabaseConfig().url, "https://mikpepfrumtglwweolzq.supabase.co");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://another-project.supabase.co";
  assert.throws(getPublicSupabaseConfig, /hackathon project/);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mikpepfrumtglwweolzq.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_test_fixture";
  assert.throws(getPublicSupabaseConfig, /publishable key/);
  } finally {
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});
