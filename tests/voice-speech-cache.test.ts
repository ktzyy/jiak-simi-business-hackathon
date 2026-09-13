import assert from "node:assert/strict";
import test from "node:test";
import { createQuoteSpeaker } from "../src/server/ai/live-speech-cache";

test("readback cache reuses only exact text and credential, expires and returns isolated bytes", async () => {
  let calls = 0, now = 0;
  const speak = createQuoteSpeaker(async text => { calls++; return Buffer.from(text); }, () => now);
  const first = await speak("Rice, egg. Total 5 dollars 50 cents.", "fake"); first.fill(0);
  assert.equal((await speak("Rice, egg. Total 5 dollars 50 cents.", "fake")).toString(), "Rice, egg. Total 5 dollars 50 cents.");
  assert.equal(calls, 1);
  await speak("Rice, no egg. Total 4 dollars 50 cents.", "fake");
  await speak("Rice, egg. Total 5 dollars 50 cents.", "other-fake"); assert.equal(calls, 3);
  now = 300001;
  await speak("Rice, egg. Total 5 dollars 50 cents.", "fake"); assert.equal(calls, 4);
});

test("readback cache bounds entry count and byte size and does not cache failed speech", async () => {
  let calls = 0;
  const speak = createQuoteSpeaker(async text => { calls++; if (text === "failure") throw Error("unavailable"); return Buffer.alloc(text.startsWith("large") ? 3_000_000 : 100); });
  await assert.rejects(speak("failure", "fake")); await assert.rejects(speak("failure", "fake")); assert.equal(calls, 2);
  for (let i = 0; i < 33; i++) await speak(`order${i}`, "fake");
  await speak("order0", "fake"); assert.equal(calls, 36);
  for (let i = 0; i < 3; i++) await speak(`large${i}`, "fake");
  await speak("large0", "fake"); assert.equal(calls, 40);
});
