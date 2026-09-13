import assert from "node:assert/strict";
import test from "node:test";
import { explicitVoiceConfirmation, quoteReadback } from "../src/server/ai/live-confirmation-audio";
import { fixtureQuote } from "../src/shared/fixtures";

test("short completed voice confirmations accept natural affirmative phrases", () => {
  for (const phrase of ["Confirm.", "Yes!", "Yes, confirm.", "Confirm order", "Yes, place order", "Yes, place this order.", "  YES   CONFIRM  "]) {
    assert.equal(explicitVoiceConfirmation(phrase), true, phrase);
  }
});

test("short confirmation never accepts negation, order edits or embedded words", () => {
  for (const phrase of ["", "no", "don't confirm", "unconfirmed", "yes but no chilli", "confirm, actually cancel", "one char siew rice and confirm", "no yes", "please don't place this order", "confirm two instead", "Yes? No!", "okay"]) {
    assert.equal(explicitVoiceConfirmation(phrase), false, phrase);
  }
});

test("canonical quote asks for a short confirmation while preserving unpaid meaning", () => {
  const text = quoteReadback(fixtureQuote);
  assert.match(text, /After the beep, say confirm\.$/);
  assert.match(text, /Total .*Singapore dollars/);
  assert.match(text, /Payment is still due at the stall/);
  assert.doesNotMatch(text, /say exactly|wait quietly|To change or cancel/);
});
