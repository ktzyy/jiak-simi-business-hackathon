import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApiClient } from "../src/shared/api-client";
import { fixtureMenu } from "../src/shared/fixtures";

test("photo client sends one frozen multipart request and looks up lost acknowledgment without redispatch", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const key = randomUUID(), jobId = randomUUID();
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init?.method === "POST") throw new Error("lost response");
    return Response.json({ jobId, status: "dispatch_unknown", candidate: null });
  };
  const api = createApiClient("", fetcher);
  const request = { mode: "generate_similar" as const, dishId: fixtureMenu.dishes[0].id, dishName: fixtureMenu.dishes[0].name };
  await assert.rejects(api.createDishPhoto(fixtureMenu.restaurantId, key, request, "test"), { code: "ACKNOWLEDGEMENT_UNKNOWN" });
  assert.equal(calls.length, 1);
  const form = calls[0].init?.body as FormData;
  assert.equal(form.get("key"), key);
  assert.deepEqual(JSON.parse(String(form.get("request"))), request);
  assert.equal((calls[0].init?.headers as Record<string, string>)["Content-Type"], undefined);
  assert.equal((await api.findDishPhoto(fixtureMenu.restaurantId, key, "test")).jobId, jobId);
  assert.match(calls[1].url, new RegExp(`/dish-photos/by-key/${key}\\?restaurantId=`));
  assert.equal(calls.filter(call => call.init?.method === "POST").length, 1);
});

test("photo publication freezes exact job selections alongside menu and details version", async () => {
  let sent: unknown;
  const api = createApiClient("", async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ menu: fixtureMenu, photos: [] });
  });
  const selections = [{ dishId: fixtureMenu.dishes[0].id, jobId: randomUUID() }];
  await api.publishMenuWithPhotos(fixtureMenu, "test", 3, selections);
  assert.deepEqual(sent, { restaurantId: fixtureMenu.restaurantId, menu: fixtureMenu, stallDetailsVersion: 3, selections });
});

test("preview downloads require the JPEG contract and use staff auth", async () => {
  let authorization: unknown;
  const api = createApiClient("", async (_url, init) => {
    authorization = (init?.headers as Record<string, string>).Authorization;
    return new Response("wrong format", { headers: { "Content-Type": "text/plain" } });
  });
  await assert.rejects(api.dishPhotoPreview(fixtureMenu.restaurantId, randomUUID(), "test"), { code: "INVALID_RESPONSE" });
  assert.equal(authorization, "Bearer test");
});


test("cancelling a polish request aborts transport without redispatching", async () => {
  const controller = new AbortController();
  let calls = 0;
  let transportSignal: AbortSignal | null | undefined;
  const api = createApiClient("", async (_url, init) => {
    calls++;
    transportSignal = init?.signal;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  });
  const pending = api.createDishPhoto(fixtureMenu.restaurantId, randomUUID(), { mode: "generate_similar", dishId: fixtureMenu.dishes[0].id, dishName: fixtureMenu.dishes[0].name }, "test", undefined, controller.signal);
  controller.abort();
  await assert.rejects(pending, { code: "ACKNOWLEDGEMENT_UNKNOWN" });
  assert.equal(transportSignal?.aborted, true);
  assert.equal(calls, 1);
});
