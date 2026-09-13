import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { DEMO_MENU_WITH_EXTRAS, DEMO_APPROVED_DETAILS, DEMO_RESTAURANT_ID, DEMO_STAFF_EMAIL } from "../src/shared/demo-menu";
import { DEMO_FULL_MENU } from "../src/shared/demo-full-menu-proposal";
import { QuoteSchema } from "../src/shared/contracts";

// Requires explicit approval for full-menu availability/global extras/base choices,
// not only obscured prices. Reads exact existing state before each intentional run.
async function main() {
  if (process.argv.slice(2).join(" ") !== "--apply") throw new Error("apply_flag_required");
  const url = "https://mikpepfrumtglwweolzq.supabase.co";
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== url || process.env.DEMO_STAFF_EMAIL !== DEMO_STAFF_EMAIL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY || !process.env.DEMO_STAFF_PASSWORD) throw new Error("invalid_demo_configuration");
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) }) } };
  const auth = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
  const backend = createClient(url, process.env.SUPABASE_SECRET_KEY, options);
  const rpc = async (name: string, args: Record<string, unknown>) => { const { data, error } = await backend.rpc(name, args); if (error) throw new Error("rpc_outcome_unconfirmed_read_before_retry"); return data; };
  const login = await auth.auth.signInWithPassword({ email: DEMO_STAFF_EMAIL, password: process.env.DEMO_STAFF_PASSWORD });
  if (login.error || !login.data.user || !login.data.session) throw new Error("demo_login_failed");
  try {
    const verified = await auth.auth.getUser(login.data.session.access_token);
    if (verified.error || verified.data.user?.id !== login.data.user.id || verified.data.user.email !== DEMO_STAFF_EMAIL) throw new Error("demo_identity_unverified");
    const scope = { p_actor_id: verified.data.user.id, p_restaurant_id: DEMO_RESTAURANT_ID };
    const expected = { ...DEMO_APPROVED_DETAILS, restaurantId: DEMO_RESTAURANT_ID, version: 1 };
    const before = await rpc("read_published_stall", { p_restaurant_id: DEMO_RESTAURANT_ID });
    if (!isDeepStrictEqual(before.menu, DEMO_MENU_WITH_EXTRAS) && !isDeepStrictEqual(before.menu, DEMO_FULL_MENU)) throw new Error("existing_menu_differs_preserve_it");
    if (!isDeepStrictEqual(before.details, expected) || !isDeepStrictEqual((await rpc("read_stall_details", scope)).details, expected)) throw new Error("existing_details_differ_preserve_them");
    if (before.menu.version === 2) await rpc("publish_menu", { ...scope, p_menu: DEMO_FULL_MENU, p_stall_details_version: 1 });
    const published = await rpc("read_published_stall", { p_restaurant_id: DEMO_RESTAURANT_ID });
    if (!isDeepStrictEqual(published.menu, DEMO_FULL_MENU) || !isDeepStrictEqual(published.details, expected)) throw new Error("publication_unconfirmed");
    const hash = randomBytes(32).toString("hex");
    await rpc("create_guest_session", { p_restaurant_id: DEMO_RESTAURANT_ID, p_token_hash: hash });
    const menu = DEMO_FULL_MENU;
    const cart = (lines: { dishId: string; quantity: number; optionIds: string[] }[]) => ({ restaurantId: DEMO_RESTAURANT_ID, menuId: menu.id, menuVersion: 3, fulfillmentType: "dine_in", lines });
    const quote = async (lines: Parameters<typeof cart>[0]) => QuoteSchema.parse(await rpc("quote_cart", { p_session_token_hash: hash, p_cart: cart(lines) }));
    const rice = menu.dishes.find(d => d.name === "Char Siew Rice")!;
    const pork = menu.dishes.find(d => d.name === "Braised Pork Knuckle Rice")!;
    const wanton = menu.dishes.find(d => d.name === "Wanton Soup")!;
    const chicken = menu.dishes.find(d => d.name === "Chicken Feet Noodle / Hor Fun")!;
    const base = await quote([{ dishId: rice.id, quantity: 2, optionIds: [] }, { dishId: pork.id, quantity: 1, optionIds: [] }]);
    const riceOption = rice.modifierGroups[0].options.find(option => option.name === "Rice")!;
    const riceQuote = await quote([{ dishId: rice.id, quantity: 1, optionIds: [riceOption.id] }]);
    const soup = await quote([{ dishId: wanton.id, quantity: 1, optionIds: [] }]);
    if (menu.dishes.length !== 10 || base.totalCents !== 1400 || soup.totalCents !== 400 || riceQuote.totalCents !== 500) throw new Error("price_verification_failed");
    for (const dish of menu.dishes) {
      const extras = dish.modifierGroups.find(group => group.name === "Additional Ingredients")!;
      if (extras.options.length !== 12) throw new Error("extras_incomplete");
      const required = dish.modifierGroups.filter(group => group.minSelections === 1).map(group => group.options[0].id);
      for (const option of extras.options) if ((await quote([{ dishId: dish.id, quantity: 1, optionIds: [...required, option.id] }])).totalCents !== dish.priceCents + option.priceDeltaCents) throw new Error("extra_price_failed");
    }
    for (const option of chicken.modifierGroups[0].options) if ((await quote([{ dishId: chicken.id, quantity: 1, optionIds: [option.id] }])).totalCents !== 450) throw new Error("noodle_price_failed");
    const invalidQuote = async (dishId: string, optionIds: string[]) => { const { error } = await backend.rpc("quote_cart", { p_session_token_hash: hash, p_cart: cart([{ dishId, quantity: 1, optionIds }]) }); if (error?.message !== "INVALID_OPTIONS") throw new Error("selection_guard_unconfirmed"); };
    await invalidQuote(chicken.id, []);
    await invalidQuote(rice.id, rice.modifierGroups[1].options.map(option => option.id));
    const evidence = { status: "full_demo_menu_v3_verified", restaurantId: DEMO_RESTAURANT_ID, menuVersion: 3, detailsVersion: 1, mainDishes: 10, photoExtrasPerDish: 11, userAddedShaoRouPerDish: 1, baseTotalCents: base.totalCents, wantonSoupCents: soup.totalCents, riceExtraCents: riceQuote.totalCents - rice.priceCents, perDishExtraPricesVerified: 120, noodleChoiceRequired: true, chilliMutuallyExclusive: true, ordersCreated: 0, verifiedAt: new Date().toISOString() };
    await mkdir("artifacts/demo-menu", { recursive: true });
    await writeFile("artifacts/demo-menu/version-3-verification.json", JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(evidence));
  } finally { await auth.auth.signOut(); }
}
main().catch(error => { console.error(JSON.stringify({ status: "stopped", code: error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "outcome_requires_review_no_automatic_retry" })); process.exitCode = 1; });
