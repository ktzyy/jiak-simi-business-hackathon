import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { DEMO_MENU, DEMO_MENU_WITH_EXTRAS, DEMO_APPROVED_DETAILS, DEMO_RESTAURANT_ID, DEMO_STAFF_EMAIL } from "../src/shared/demo-menu";
import { QuoteSchema } from "../src/shared/contracts";

// Explicitly approved demo data update, not a migration. Every rerun reads exact
// current state first; no automatic mutation retry after an unknown outcome.
async function main() {
  if (process.argv.slice(2).join(" ") !== "--apply") throw new Error("apply_flag_required");
  const url = "https://mikpepfrumtglwweolzq.supabase.co";
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== url || process.env.DEMO_STAFF_EMAIL !== DEMO_STAFF_EMAIL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY || !process.env.DEMO_STAFF_PASSWORD) throw new Error("invalid_demo_configuration");
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) }) } };
  const auth = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
  const backend = createClient(url, process.env.SUPABASE_SECRET_KEY, options);
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await backend.rpc(name, args);
    if (error) throw new Error("rpc_outcome_unconfirmed_read_state_before_retry");
    return data;
  };
  const login = await auth.auth.signInWithPassword({ email: DEMO_STAFF_EMAIL, password: process.env.DEMO_STAFF_PASSWORD });
  if (login.error || !login.data.user || !login.data.session) throw new Error("demo_login_failed");
  try {
    const verified = await auth.auth.getUser(login.data.session.access_token);
    if (verified.error || verified.data.user?.id !== login.data.user.id || verified.data.user.email !== DEMO_STAFF_EMAIL) throw new Error("demo_identity_unverified");
    const actor = verified.data.user.id;
    const scope = { p_actor_id: actor, p_restaurant_id: DEMO_RESTAURANT_ID };
    const before = await rpc("read_published_stall", { p_restaurant_id: DEMO_RESTAURANT_ID });
    if (!isDeepStrictEqual(before.menu, DEMO_MENU) && !isDeepStrictEqual(before.menu, DEMO_MENU_WITH_EXTRAS)) throw new Error("existing_menu_differs_preserve_it");
    let details = (await rpc("read_stall_details", scope)).details;
    const expected = { ...DEMO_APPROVED_DETAILS, restaurantId: DEMO_RESTAURANT_ID, version: 1 };
    if (details !== null && !isDeepStrictEqual(details, expected)) throw new Error("existing_details_differ_preserve_them");
    if (before.menu.version === 2 && (!isDeepStrictEqual(before.details, expected) || details === null)) throw new Error("existing_publication_differs_preserve_it");
    if (details === null) details = (await rpc("save_stall_details", { ...scope, p_expected_version: 0, p_details: DEMO_APPROVED_DETAILS })).details;
    if (!isDeepStrictEqual(details, expected)) throw new Error("saved_details_unconfirmed");
    if (before.menu.version === 1) await rpc("publish_menu", { ...scope, p_menu: DEMO_MENU_WITH_EXTRAS, p_stall_details_version: 1 });
    const published = await rpc("read_published_stall", { p_restaurant_id: DEMO_RESTAURANT_ID });
    if (!isDeepStrictEqual(published.menu, DEMO_MENU_WITH_EXTRAS) || !isDeepStrictEqual(published.details, expected)) throw new Error("publication_unconfirmed");
    const hash = randomBytes(32).toString("hex");
    await rpc("create_guest_session", { p_restaurant_id: DEMO_RESTAURANT_ID, p_token_hash: hash });
    const menu = DEMO_MENU_WITH_EXTRAS;
    const quote = async (lines: { dishId: string; quantity: number; optionIds: string[] }[]) => QuoteSchema.parse(await rpc("quote_cart", { p_session_token_hash: hash, p_cart: { restaurantId: DEMO_RESTAURANT_ID, menuId: menu.id, menuVersion: 2, fulfillmentType: "dine_in", lines } }));
    const base = await quote([{ dishId: menu.dishes[0].id, quantity: 2, optionIds: [] }, { dishId: menu.dishes[1].id, quantity: 1, optionIds: [] }]);
    const extras = await quote([{ dishId: menu.dishes[0].id, quantity: 1, optionIds: menu.dishes[0].modifierGroups[0].options.map(option => option.id) }]);
    if (base.totalCents !== 1400 || extras.totalCents !== 950) throw new Error("price_verification_failed");
    for (const dish of menu.dishes) for (const option of dish.modifierGroups[1].options) {
      if ((await quote([{ dishId: dish.id, quantity: 1, optionIds: [option.id] }])).totalCents !== dish.priceCents) throw new Error("chilli_price_failed");
    }
    const { error: conflict } = await backend.rpc("quote_cart", { p_session_token_hash: hash, p_cart: { restaurantId: DEMO_RESTAURANT_ID, menuId: menu.id, menuVersion: 2, fulfillmentType: "dine_in", lines: [{ dishId: menu.dishes[0].id, quantity: 1, optionIds: menu.dishes[0].modifierGroups[1].options.map(option => option.id) }] } });
    if (!conflict || conflict.message !== "INVALID_OPTIONS") throw new Error("chilli_exclusivity_unconfirmed");
    const evidence = { status: "demo_menu_v2_verified", restaurantId: DEMO_RESTAURANT_ID, menuVersion: 2, detailsVersion: 1, hours: "09:00–18:00 Monday–Sunday, Asia/Singapore", baseTotalCents: base.totalCents, riceAllExtrasCents: extras.totalCents, chilliMutuallyExclusive: true, ordersCreated: 0, verifiedAt: new Date().toISOString() };
    await mkdir("artifacts/demo-menu", { recursive: true });
    await writeFile("artifacts/demo-menu/version-2-verification.json", JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(evidence));
  } finally { await auth.auth.signOut(); }
}
main().catch(error => { console.error(JSON.stringify({ status: "stopped", code: error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "outcome_requires_review_no_automatic_retry" })); process.exitCode = 1; });
