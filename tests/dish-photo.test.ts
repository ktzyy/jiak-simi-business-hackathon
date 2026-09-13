import assert from "node:assert/strict";
import test from "node:test";
import { createDishPhoto } from "../src/server/ai/dish-photo";
import { dishPhotoRequestSchema, type DishPhotoRequest } from "../src/shared/dish-photo";

const id = "e332c1b9-94d2-4fd7-a1a1-8d8576d61f7d";
const sourceId = "a72a59ae-5b11-4f74-8829-2f16e3b00216";
const jpeg = Uint8Array.from([255, 216, 255, 224, 255, 217]);
const generated: DishPhotoRequest = { mode: "generate_similar", dishId: id, dishName: "Chicken Rice" };
const enhanced: DishPhotoRequest = { ...generated, mode: "enhance_visible", merchantConfirmedVisible: true, sourceImageId: sourceId, sourceEntryId: id, region: { x: 0.1, y: 0.2, width: 0.4, height: 0.4 } };
const sourceImage = { sourceImageId: sourceId, bytes: jpeg, mimeType: "image/jpeg" };
function provider(response = Response.json({ data: [{ b64_json: Buffer.from(jpeg).toString("base64") }] })) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (url, init) => { calls.push({ url: String(url), init }); return response; };
  return { apiKey: "test-not-real", fetch: fetcher, calls };
}

test("similar generation carries mandatory AI disclosure and bounded provider settings", async () => {
  const options = provider();
  const result = await createDishPhoto(generated, options);
  const body = JSON.parse(String(options.calls[0].init?.body));
  assert.equal(options.calls[0].url, "https://api.openai.com/v1/images/generations");
  assert.equal(body.model, "gpt-image-2.5-flare");
  assert.equal(body.n, 1);
  assert.equal(body.size, "1024x1024");
  assert.equal(body.quality, "low");
  assert.equal(body.output_format, "jpeg");
  assert.equal(result.candidate.label, "AI-generated illustration");
  assert.equal(result.candidate.disclosureRequired, true);
  assert.equal(result.candidate.status, "needs_review");
  assert.equal(result.candidate.sourceImageId, null);
  assert.match(result.candidate.imageSha256, /^[a-f0-9]{64}$/);
});

test("enhancement sends original bytes as multipart and retains source/hint provenance", async () => {
  const options = provider();
  const result = await createDishPhoto(enhanced, { ...options, sourceImage });
  assert.equal(options.calls[0].url, "https://api.openai.com/v1/images/edits");
  assert.equal(options.calls[0].init?.redirect, "manual");
  const form = options.calls[0].init?.body as FormData;
  assert.equal(form.get("model"), "gpt-image-2.5-sunburst");
  assert.ok(form.get("image[]") instanceof Blob);
  assert.deepEqual(new Uint8Array(await (form.get("image[]") as Blob).arrayBuffer()), jpeg);
  assert.equal((options.calls[0].init?.headers as Record<string, string>)["Content-Type"], undefined);
  assert.equal(result.candidate.label, "AI-enhanced source photo");
  assert.equal(result.candidate.sourceImageId, sourceId);
  assert.equal(result.candidate.sourceEntryId, id);
  assert.deepEqual(result.candidate.region, enhanced.region);
  assert.match(result.candidate.sourceImageSha256!, /^[a-f0-9]{64}$/);
});

test("enhancement requires visibility acknowledgment and matching validated source", async () => {
  const options = provider();
  assert.equal(dishPhotoRequestSchema.safeParse({ ...enhanced, merchantConfirmedVisible: false }).success, false);
  await assert.rejects(createDishPhoto(enhanced, options), { code: "invalid_source" });
  await assert.rejects(createDishPhoto(enhanced, { ...options, sourceImage: { ...sourceImage, sourceImageId: id } }), { code: "invalid_source" });
  await assert.rejects(createDishPhoto(enhanced, { ...options, sourceImage: { ...sourceImage, mimeType: "image/png" } }), { code: "invalid_source" });
  assert.equal(options.calls.length, 0);
});

test("rejects arbitrary URLs, out-of-image hints, and source bytes in generation mode", async () => {
  assert.equal(dishPhotoRequestSchema.safeParse({ ...generated, sourceUrl: "http://169.254.169.254/" }).success, false);
  assert.equal(dishPhotoRequestSchema.safeParse({ ...enhanced, region: { x: 0.9, y: 0, width: 0.2, height: 1 } }).success, false);
  const options = provider();
  await assert.rejects(createDishPhoto(generated, { ...options, sourceImage }), { code: "invalid_source" });
  assert.equal(options.calls.length, 0);
});

test("provider failures do not leak body or trigger billable retries or generation fallback", async () => {
  const options = provider(new Response("sensitive upstream content", { status: 429 }));
  await assert.rejects(createDishPhoto(enhanced, { ...options, sourceImage }), (error: unknown) => error instanceof Error && !error.message.includes("sensitive"));
  assert.equal(options.calls.length, 1);
});

test("definite provider rejections can fail jobs while server errors stay outcome-unknown", async () => {
  for (const status of [302, 400, 403, 429, 500]) {
    await assert.rejects(createDishPhoto(generated, provider(new Response("private provider body", { status }))), { code: "provider_error", definitelyRejected: status >= 400 && status < 500, providerStatus: status });
  }
});

test("rejects URL-only output, invalid image encoding, and oversized response before use", async () => {
  for (const response of [
    Response.json({ data: [{ url: "https://example.com/photo.jpg" }] }),
    Response.json({ data: [{ b64_json: "not an image" }] }),
    Response.json({ data: [{ b64_json: Buffer.from("not jpeg").toString("base64") }] }),
    new Response("{}", { headers: { "Content-Length": String(13 * 1024 * 1024) } }),
  ]) {
    await assert.rejects(createDishPhoto(generated, provider(response)), { code: "invalid_response" });
  }
});
