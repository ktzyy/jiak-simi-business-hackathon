import assert from "node:assert/strict";
import test from "node:test";
import { explicitVoiceConfirmation, quoteReadback } from "../src/server/ai/live-confirmation-audio";
import { fixtureQuote } from "../src/shared/fixtures";

test("short completed voice confirmations accept natural affirmative phrases", () => {
  for (const phrase of ["Confirm.", "Yes!", "Yes, confirm.", "Confirm order", "Yes, place order", "Yes, place this order.", "  YES   CONFIRM  ", "Can confirm", "Confirm lah!", "Yes, confirm lah."]) {
    assert.equal(explicitVoiceConfirmation(phrase), true, phrase);
  }
});

test("short confirmation never accepts negation, order edits or embedded words", () => {
  for (const phrase of ["", "no", "don't confirm", "unconfirmed", "yes but no chilli", "confirm, actually cancel", "one char siew rice and confirm", "no yes", "please don't place this order", "confirm two instead", "Yes? No!", "okay", "can", "cannot confirm lah", "confirm lah but takeaway", "can confirm? Actually no"]) {
    assert.equal(explicitVoiceConfirmation(phrase), false, phrase);
  }
});

test("canonical quote asks for a short confirmation while preserving unpaid meaning", () => {
  const text = quoteReadback(fixtureQuote);
  assert.match(text, /After the beep, say confirm\.$/);
  assert.match(text, /Total .*dollars/);
  assert.match(text, /Pay at the stall/);
  assert.doesNotMatch(text, /say exactly|wait quietly|To change or cancel/);
});

test("confirmation readback uses local phrasing without changing the quoted order", () => {
  for (const fulfillmentType of ["dine_in", "takeaway"] as const) {
    const text = quoteReadback({ ...fixtureQuote, fulfillmentType });
    assert.match(text, fulfillmentType === "dine_in" ? /Having here/ : /Dabao/);
    for (const line of fixtureQuote.lines) {
      assert.ok(text.includes(`${line.quantity} ${line.name}`));
      for (const option of line.options) assert.ok(text.includes(option.name));
    }
    assert.match(text, /Pay at the stall later/);
    assert.equal((text.match(/say confirm/g) ?? []).length, 1);
  }
});
