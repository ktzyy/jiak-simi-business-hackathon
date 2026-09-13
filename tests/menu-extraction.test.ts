import assert from "node:assert/strict";
import test from "node:test";
import { extractMenu, MAX_MENU_IMAGE_BYTES, MenuExtractionError, parseMenuPriceCents, validateMenuImage } from "../src/server/ai/menu-extraction";

const image = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const input = { image, mimeType: "image/png" };
const entry = { kind: "item", name: "Chicken rice", category: null, description: null, itemNumber: "1", menuLabel: null, region: "top left", photoRegion: null, rawPriceText: "$4.50", currency: "SGD", priceUncertain: false, uncertainty: null };
const body = (menu: unknown) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(menu) }] }] });
function fakeFetch(responses: Response[]) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const response = responses.shift();
    assert.ok(response, "Unexpected provider retry");
    return response;
  };
  return { fetch: fetcher, requests, apiKey: "test-key-not-real" };
}

 test("creates server IDs, source links, and a review-only draft from exact raw prices", async () => {
  const options = fakeFetch([Response.json(body({ entries: [entry], issues: [] }))]);
  const draft = await extractMenu(input, options);
  assert.equal(draft.status, "needs_review");
  assert.equal(draft.items[0].priceCents, 450);
  assert.equal(draft.items[0].rawPriceText, "$4.50");
  assert.match(draft.items[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(draft.items[0].sourceEntryId, draft.sourceEntries?.[0].id);
  assert.equal(draft.sourceEntries?.[0].itemNumber, "1");
  assert.ok(draft.issues.some((issue) => issue.code === "human_review_required" && issue.blocking));
  assert.equal(options.requests[0].url, "https://api.openai.com/v1/responses");
  assert.equal(options.requests[0].body.model, "gpt-5.4-mini");
  assert.equal(options.requests[0].body.store, false);
  assert.match(JSON.stringify(options.requests[0].body), /data:image\/png;base64,/);
});

test("scalar parser never merges slash prices, selects ranges, or strips quantity/currency evidence", () => {
  for (const raw of ["$12/$18", "$12 / $18", "12/18", "$4-6", "$4.50 each", "2 for $5", "US$4.50", "$4.500", "", null, "$10000.01", "NaN", "$1,200", "free"]) {
    assert.equal(parseMenuPriceCents(raw), null, String(raw));
  }
  assert.equal(parseMenuPriceCents("$0"), 0);
  assert.equal(parseMenuPriceCents("S$ 12.8"), 1280);
  assert.equal(parseMenuPriceCents("SGD 4.50"), 450);
  assert.equal(parseMenuPriceCents("4.50"), 450);
  assert.equal(parseMenuPriceCents("$4.50", "other"), null);
  assert.equal(parseMenuPriceCents("$4.50", "unknown"), null);
  assert.equal(parseMenuPriceCents("$4.50", "SGD", true), null);
});

test("ambiguous and missing prices stay null with blocking issues and no retry", async () => {
  for (const rawPriceText of [null, "$12/$18"]) {
    const options = fakeFetch([Response.json(body({ entries: [{ ...entry, rawPriceText }], issues: [] }))]);
    const draft = await extractMenu(input, options);
    assert.equal(draft.items[0].priceCents, null);
    assert.equal(draft.items[0].rawPriceText, rawPriceText);
    assert.ok(draft.issues.some((issue) => issue.code === "unknown_price" && issue.blocking));
    assert.equal(options.requests.length, 1);
  }
});

test("addon, fee, category and multiple board evidence never silently become dishes or modifiers", async () => {
  const draft = await extractMenu(input, fakeFetch([Response.json(body({ entries: [
    { ...entry, menuLabel: "Soup stall" },
    { ...entry, kind: "addon", name: "Rice", rawPriceText: "$0.50", menuLabel: "Soup stall" },
    { ...entry, kind: "fee", name: "Takeaway", rawPriceText: "$0.20", menuLabel: "Soup stall" },
    { ...entry, kind: "category", name: "Noodles", rawPriceText: null, menuLabel: "Noodle stall" },
  ], issues: [{ message: "Confirm rice applicability", entryIndex: 1 }] }))]));
  assert.equal(draft.items.length, 1);
  assert.deepEqual(draft.items[0].modifierGroups, []);
  assert.equal(draft.sourceEntries?.length, 4);
  assert.equal(draft.sourceEntries?.[1].priceCents, 50);
  assert.equal(draft.issues.filter((issue) => issue.code === "source_mapping_required").length, 3);
  assert.equal(draft.issues.find((issue) => issue.message === "Confirm rice applicability")?.itemId, null);
});

test("source issue maps to correct item after non-dish entries are filtered", async () => {
  const draft = await extractMenu(input, fakeFetch([Response.json(body({ entries: [
    { ...entry, kind: "category", rawPriceText: null }, entry,
  ], issues: [{ message: "Check dish spelling", entryIndex: 1 }] }))]));
  assert.equal(draft.issues.find((issue) => issue.message === "Check dish spelling")?.itemId, draft.items[0].id);
});

test("rejects MIME mismatches, unsupported images, and oversized files before provider calls", async () => {
  const options = fakeFetch([]);
  await assert.rejects(extractMenu({ ...input, mimeType: "image/jpeg" }, options), { code: "invalid_image" });
  assert.throws(() => validateMenuImage(new Uint8Array(), "image/svg+xml"), MenuExtractionError);
  const large = new Uint8Array(MAX_MENU_IMAGE_BYTES + 1);
  large.set(image);
  assert.throws(() => validateMenuImage(large, "image/png"), { code: "invalid_image" });
  assert.equal(options.requests.length, 0);
});

test("retries schema failure once with the same model, rejecting model-calculated cents", async () => {
  const options = fakeFetch([
    Response.json(body({ entries: [{ ...entry, priceCents: 450 }], issues: [] })),
    Response.json(body({ entries: [entry], issues: [] })),
  ]);
  assert.equal((await extractMenu(input, options)).items.length, 1);
  assert.deepEqual(options.requests.map((request) => request.body.model), ["gpt-5.4-mini", "gpt-5.4-mini"]);
});

test("refusals and credential failures never trigger retry or expose provider messages", async () => {
  for (const response of [
    Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] }),
    new Response("provider body that must not leak", { status: 401 }),
  ]) {
    const options = fakeFetch([response]);
    await assert.rejects(extractMenu(input, options), (error: unknown) => error instanceof MenuExtractionError && !error.message.includes("must not leak"));
    assert.equal(options.requests.length, 1);
  }
});

test("OCR rejects provider redirects without following or retrying with its bearer", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++; assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init?.redirect, "manual");
    return new Response("untrusted redirect body", { status: 302, headers: { Location: "https://untrusted.example/collect" } });
  };
  await assert.rejects(extractMenu(input, { apiKey: "fake-key", fetch: fetcher }), (error: unknown) => error instanceof MenuExtractionError && error.code === "provider_error" && !error.message.includes("untrusted"));
  assert.equal(calls, 1);
});

test("incomplete response and repeated provider failures stop after two attempts", async () => {
  for (const responses of [
    [Response.json({ status: "incomplete", output: [] }), Response.json({ status: "incomplete", output: [] })],
    [new Response("sensitive provider text", { status: 503 }), new Response("sensitive provider text", { status: 503 })],
  ]) {
    const options = fakeFetch(responses);
    await assert.rejects(extractMenu(input, options), (error: unknown) => error instanceof MenuExtractionError && !error.message.includes("sensitive"));
    assert.equal(options.requests.length, 2);
  }
});

test("rejects invented IDs and out-of-range issue references", async () => {
  for (const menu of [
    { entries: [{ ...entry, id: "model-invented" }], issues: [] },
    { entries: [entry], issues: [{ message: "Unclear price", entryIndex: 1 }] },
  ]) {
    const options = fakeFetch([Response.json(body(menu)), Response.json(body(menu))]);
    await assert.rejects(extractMenu(input, options), { code: "invalid_response" });
  }
});

test("empty menus remain blocked for manual entry", async () => {
  const draft = await extractMenu(input, fakeFetch([Response.json(body({ entries: [], issues: [] }))]));
  assert.ok(draft.issues.some((issue) => issue.code === "empty_menu" && issue.blocking));
});
