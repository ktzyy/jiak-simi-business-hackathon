import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { isPublicCustomerPath, updateSession } from "../src/lib/supabase/proxy";

const restaurant = "ba2ad996-da84-4653-89a9-c028d77c050d";
test("signed-out customer can pass the proxy for exactly the restaurant order page", async () => {
  const request = new NextRequest(`https://demo.test/order/${restaurant}?table=1`);
  assert.equal(request.cookies.getAll().length, 0);
  const response = await updateSession(request);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(isPublicCustomerPath(`/order/${restaurant}/`), true);
});
test("public customer exception does not include merchant or nested routes", () => {
  for (const path of ["/", "/onboarding", "/kitchen", "/storefront", "/voice-test", "/order", "/order/not-a-uuid", `/order/${restaurant}/admin`, `/order/${restaurant}/settings`, `/order/${restaurant}/../kitchen`, `/order/${restaurant}%2fadmin`, `/orders/${restaurant}`]) {
    assert.equal(isPublicCustomerPath(path), false, path);
  }
});
