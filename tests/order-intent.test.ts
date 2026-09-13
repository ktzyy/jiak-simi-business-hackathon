import test from "node:test";
import assert from "node:assert/strict";
import { parseOrderIntent } from "../src/server/ai/order-intent";
import { fixtureCart, fixtureMenu } from "../src/shared/fixtures";

const reply = (value: unknown) => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] }), { status: 200 });
test("parse retains clarification and never confers order or price authority", async () => {
  const result = await parseOrderIntent(fixtureMenu, "two large noodles, more vinegar", { apiKey: "test", fetch: async () => reply({ lines: fixtureCart.lines, issues: [{ code: "UNSUPPORTED_OPTION", message: "More vinegar is not approved.", lineIndex: 0 }] }) });
  assert.equal(result.issues.length, 1); assert.equal(result.menuVersion, fixtureMenu.version); assert.equal("totalCents" in result, false);
});
test("invented dish IDs produce a deterministic blocking issue", async () => {
  const result = await parseOrderIntent(fixtureMenu, "noodles", { apiKey: "test", fetch: async () => reply({ lines: [{ ...fixtureCart.lines[0], dishId: fixtureMenu.id }], issues: [] }) });
  assert.equal(result.issues[0].code, "UNKNOWN_DISH");
});
test("model-supplied prices fail strict schema and stop after bounded retry", async () => {
  let attempts = 0;
  await assert.rejects(parseOrderIntent(fixtureMenu, "noodles", { apiKey: "test", fetch: async () => { attempts++; return reply({ lines: fixtureCart.lines, issues: [], totalCents: 1 }); } }));
  assert.equal(attempts, 2);
});
