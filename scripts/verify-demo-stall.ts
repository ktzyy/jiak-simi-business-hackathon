import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { backendHandlers, getBackendClient } from "../src/server/supabase-backend";
import { DEMO_MENU, DEMO_RESTAURANT_ID, DEMO_STAFF_EMAIL } from "../src/shared/demo-menu";

async function main() {
  const url = "https://mikpepfrumtglwweolzq.supabase.co";
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, url);
  assert.ok(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && process.env.DEMO_STAFF_PASSWORD);
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: DEMO_STAFF_EMAIL, password: process.env.DEMO_STAFF_PASSWORD });
  assert.equal(error, null);
  assert.ok(data.session);
  const origin = "http://localhost:3000";
  const handlers = backendHandlers();
  const menu = await handlers.menu(new Request(`${origin}/api/v1/menus/${DEMO_RESTAURANT_ID}`), DEMO_RESTAURANT_ID);
  assert.equal(menu.status, 200);
  assert.deepEqual(await menu.json(), DEMO_MENU);
  const kitchen = await handlers.kitchen(new Request(`${origin}/api/v1/kitchen/${DEMO_RESTAURANT_ID}`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  }), DEMO_RESTAURANT_ID);
  assert.equal(kitchen.status, 200);
  const result = await kitchen.json();
  assert.ok(Array.isArray(result.orders));
  // Exercises the real staff-budget RPC and owner/editor check. No paid AI request.
  const budget = await getBackendClient().rpc("consume_staff_ai_budget", {
    p_actor_id: data.user.id, p_restaurant_id: DEMO_RESTAURANT_ID, p_operation: "extraction",
  });
  assert.equal(budget.error, null);
  assert.equal(budget.data, DEMO_RESTAURANT_ID);
  await client.auth.signOut();
  console.log(JSON.stringify({ verified: true, restaurantId: DEMO_RESTAURANT_ID, staffUserId: data.user.id,
    staffLogin: "passed", publishedMenuVersion: 1, kitchenAccess: "passed", extractionBudget: "passed", paidAiRequests: 0 }));
}
main().catch(() => { console.error("Demo verification failed; credential and upstream details suppressed."); process.exitCode = 1; });
