import assert from "node:assert/strict";
import test from "node:test";
import { completeAuthConfirmation, safeNextPath } from "../src/lib/supabase/auth-redirect";

test("auth returns stay local after decoding and URL normalization", () => {
  for (const input of [null, "https://evil.test", "//evil.test", "/\\evil.test", "/%5cevil.test", "/%2fevil.test", "/%252fevil.test", "/\nevil.test", "/%0devil.test", "/a/..//evil.test", "/%", " /", "/" + "a".repeat(2048)]) {
    assert.equal(safeNextPath(input), "/", String(input));
  }
  assert.equal(safeNextPath("/?tab=menu#review"), "/?tab=menu#review");
  assert.equal(safeNextPath("/menu/../?tab=orders"), "/?tab=orders");
  assert.equal(safeNextPath("/login?next=%2F"), "/login?next=%2F");
});

test("confirmation validates OTP or PKCE exclusively before contacting Auth", async () => {
  const calls: unknown[] = [];
  const auth = async () => ({
    verifyOtp: async (input: unknown) => { calls.push(input); return { error: null }; },
    exchangeCodeForSession: async (code: string) => { calls.push({ code }); return { error: null }; },
  });
  for (const query of ["", "token_hash=x&type=recovery", "token_hash=x&type=magiclink", "token_hash=x&type=email&code=y", "code=x&code=y", "code=x&error=failed", "token_hash=x&type=email&type=signup", "code=%0a"]) {
    assert.equal(await completeAuthConfirmation(new URLSearchParams(query), auth), false, query);
  }
  assert.deepEqual(calls, []);
  assert.equal(await completeAuthConfirmation(new URLSearchParams("token_hash=hash&type=email"), auth), true);
  assert.equal(await completeAuthConfirmation(new URLSearchParams("token_hash=hash&type=signup"), auth), true);
  assert.equal(await completeAuthConfirmation(new URLSearchParams("code=pkce"), auth), true);
  assert.deepEqual(calls, [{ token_hash: "hash", type: "email" }, { token_hash: "hash", type: "signup" }, { code: "pkce" }]);
});

test("confirmation failures reveal no provider response or credentials", async () => {
  assert.equal(await completeAuthConfirmation(new URLSearchParams("code=secret"), async () => ({
    verifyOtp: async () => ({ error: null }),
    exchangeCodeForSession: async () => ({ error: { message: "sensitive upstream details" } }),
  })), false);
  assert.equal(await completeAuthConfirmation(new URLSearchParams("code=secret"), async () => { throw new Error("sensitive"); }), false);
});
