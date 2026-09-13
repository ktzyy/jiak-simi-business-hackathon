import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createApiClient } from "../src/shared/api-client";
import { DEMO_RESTAURANT_ID } from "../src/shared/demo-menu";
import { CartRequestSchema } from "../src/shared/contracts";

// Deliberate, durable synthetic acceptance order. A saved attempt is always
// recovered with its original cookie/cart/keys; never replaced after uncertainty.
async function main() {
  assert.equal(process.argv[2], "--place-demo-order");
  const origin = process.env.TEST_APP_ORIGIN || "http://localhost:3000";
  assert.ok(new URL(origin).origin === origin);
  const supabaseUrl = "https://mikpepfrumtglwweolzq.supabase.co";
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, supabaseUrl);
  const statePath = "artifacts/joint-test/web-order-session.json";
  let cookie = "";
  const transport: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers); headers.set("Origin", origin);
    if (cookie) headers.set("Cookie", cookie);
    const response = await fetch(input, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
    const issued = response.headers.getSetCookie().find(value => value.startsWith("jiak_guest_") || value.startsWith("__Host-jiak_guest_"));
    if (issued) cookie = issued.split(";")[0];
    return response;
  };
  const api = createApiClient(origin, transport);
  let state: { cookie: string; cart: ReturnType<typeof CartRequestSchema.parse>; submitKey: string; completionKey: string };
  try { state = JSON.parse(await readFile(statePath, "utf8")); cookie = state.cookie; CartRequestSchema.parse(state.cart); }
  catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    const menu = await api.readMenu(DEMO_RESTAURANT_ID);
    const rice = menu.dishes.find(dish => dish.name === "Char Siew Rice");
    const pork = menu.dishes.find(dish => dish.name === "Braised Pork Knuckle Rice");
    assert.ok(rice && pork);
    await api.startGuest(DEMO_RESTAURANT_ID); assert.ok(cookie);
    state = { cookie, cart: { restaurantId: DEMO_RESTAURANT_ID, menuId: menu.id, menuVersion: menu.version, fulfillmentType: "dine_in",
      lines: [{ dishId: rice.id, quantity: 2, optionIds: [] }, { dishId: pork.id, quantity: 1, optionIds: [] }] }, submitKey: randomUUID(), completionKey: randomUUID() };
    await mkdir("artifacts/joint-test", { recursive: true });
    await writeFile(statePath, JSON.stringify(state), { flag: "wx", mode: 0o600 });
  }
  const quote = await api.quote(state.cart); assert.equal(quote.totalCents, 1400);
  const input = { cart: state.cart, reviewedTotalCents: quote.totalCents, confirmed: true as const };
  const ticket = await api.submit(input, state.submitKey);
  assert.deepEqual(await api.submit(input, state.submitKey), ticket);
  assert.equal(ticket.paymentStatus, "unpaid"); assert.equal(ticket.cart.fulfillmentType, "dine_in");
  const auth = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email: process.env.DEMO_STAFF_EMAIL!, password: process.env.DEMO_STAFF_PASSWORD! });
  assert.equal(error, null); assert.ok(data.session);
  const token = data.session.access_token;
  const before = await api.kitchen(DEMO_RESTAURANT_ID, token);
  assert.equal(before.orders.filter(order => order.id === ticket.id).length, 1);
  const completion = { restaurantId: DEMO_RESTAURANT_ID, orderId: ticket.id, expectedStatusVersion: 1 };
  const done = await api.completeKitchenOrder(completion, state.completionKey, token);
  assert.deepEqual(await api.completeKitchenOrder(completion, state.completionKey, token), done);
  assert.equal(done.status, "done"); assert.equal(done.paymentStatus, "unpaid");
  const after = await api.kitchen(DEMO_RESTAURANT_ID, token);
  assert.equal(after.orders.filter(order => order.id === ticket.id).length, 1);
  assert.equal(after.orders.find(order => order.id === ticket.id)?.status, "done");
  assert.equal(after.counts.total, after.counts.received + after.counts.done);
  await auth.auth.signOut();
  const evidence = { passed: true, restaurantId: DEMO_RESTAURANT_ID, ticketId: ticket.id, totalCents: 1400, fulfillmentType: "dine_in", paymentStatus: "unpaid", sameKeyReplay: "one ticket", completionReplay: "same acknowledgement", queueCounts: after.counts };
  await writeFile("artifacts/joint-test/web-order-result.json", JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(evidence));
}
main().catch(() => { console.error("Web acceptance check stopped. Preserve the saved attempt and inspect its outcome before retrying; no credentials displayed."); process.exitCode = 1; });
