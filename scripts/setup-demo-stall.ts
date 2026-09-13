import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { DEMO_MENU, DEMO_RESTAURANT_ID, DEMO_STAFF_EMAIL } from "../src/shared/demo-menu";

// User explicitly requested this dummy staff/stall from Kimberley's mockup.
// No email is sent and no real merchant identity is claimed.
async function main() {
  if (process.argv.slice(2).join(" ") !== "--apply") throw new Error("Run with --apply for the user-approved dummy stall setup.");
  const url = "https://mikpepfrumtglwweolzq.supabase.co";
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== url || !process.env.SUPABASE_SECRET_KEY || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error("Demo setup configuration is incomplete.");
  const client = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const sql = async (query: string) => {
    const response = await fetch("https://api.supabase.com/v1/projects/mikpepfrumtglwweolzq/database/query", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, read_only: false }),
    });
    if (!response.ok) throw new Error("Demo database setup did not complete. Inspect state before retrying.");
    return await response.json();
  };
  const found = await sql(`select id from auth.users where email='${DEMO_STAFF_EMAIL}'`);
  if (!Array.isArray(found) || found.length > 1) throw new Error("Demo identity lookup was not confirmed.");
  let env = await readFile(".env.local", "utf8");
  const setLocal = async (name: string, value: string) => {
    const pattern = new RegExp(`^${name}=.*$`, "m");
    if (pattern.test(env)) env = env.replace(pattern, `${name}=${value}`);
    else env += (env.endsWith("\n") ? "" : "\n") + `${name}=${value}\n`;
    await writeFile(".env.local", env, { mode: 0o600 });
    await chmod(".env.local", 0o600);
  };
  let actor: string;
  if (found.length) {
    actor = found[0].id;
    const { data, error } = await client.auth.admin.getUserById(actor);
    if (error || data.user?.app_metadata.demo_seed !== "jiak-simi-hackathon-20260913" || !process.env.DEMO_STAFF_PASSWORD) throw new Error("Existing account is not this configured demo; no account changed.");
  } else {
    const password = process.env.DEMO_STAFF_PASSWORD || randomBytes(24).toString("base64url");
    await setLocal("DEMO_STAFF_PASSWORD", password);
    const { data, error } = await client.auth.admin.createUser({
      email: DEMO_STAFF_EMAIL, password, email_confirm: true,
      app_metadata: { demo_seed: "jiak-simi-hackathon-20260913" },
    });
    if (error || !data.user) throw new Error("Demo Auth creation was not confirmed; inspect the demo identity before retrying.");
    actor = data.user.id;
  }
  if (!/^[0-9a-f-]{36}$/.test(actor)) throw new Error("Invalid demo identity.");
  // Identifiers and strings below are fixed application constants, never user SQL.
  await sql(`begin;
    insert into public.restaurants(id,name,slug) values('${DEMO_RESTAURANT_ID}','Jiak Simi Roast Meat Demo','jiak-simi-roast-meat-demo') on conflict(id) do nothing;
    do $$ begin if not exists(select 1 from public.restaurants where id='${DEMO_RESTAURANT_ID}' and slug='jiak-simi-roast-meat-demo') then raise exception 'DEMO_STALL_CONFLICT'; end if; end $$;
    insert into public.restaurant_memberships(restaurant_id,user_id,role) values('${DEMO_RESTAURANT_ID}','${actor}','owner') on conflict(restaurant_id,user_id) do nothing;
    commit;`);
  const { data: existing, error: readError } = await client.rpc("read_published_menu", { p_restaurant_id: DEMO_RESTAURANT_ID });
  if (readError && readError.message !== "UNKNOWN_MENU") throw new Error("Published-menu state could not be read; no publication attempted.");
  if (!readError && existing) {
    // Identity/version guard: never publish over a menu that has been edited afterward.
    if (!isDeepStrictEqual(existing, DEMO_MENU)) throw new Error("Existing demo menu differs; preserve it and review manually.");
  } else {
    const { error } = await client.rpc("publish_menu", { p_restaurant_id: DEMO_RESTAURANT_ID, p_actor_id: actor, p_menu: DEMO_MENU });
    if (error) throw new Error("Demo publication outcome requires review; do not blindly repeat it.");
  }
  await setLocal("DEMO_STAFF_EMAIL", DEMO_STAFF_EMAIL);
  await setLocal("DEMO_RESTAURANT_ID", DEMO_RESTAURANT_ID);
  await setLocal("TELEGRAM_RESTAURANT_ID", DEMO_RESTAURANT_ID);
  console.log(JSON.stringify({ status: "demo_ready", restaurantId: DEMO_RESTAURANT_ID, staffUserId: actor, staffEmail: DEMO_STAFF_EMAIL, menuId: DEMO_MENU.id, menuVersion: 1, dishes: 3, credentials: "saved only in ignored .env.local" }));
}

main().catch(() => { console.error("Demo setup stopped. Inspect the specific demo state before repeating; no secrets or upstream response bodies are displayed."); process.exitCode = 1; });
