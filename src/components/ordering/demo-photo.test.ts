import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";
import { demoPhotoForDish } from "./demo-photo";

const freshId = "b843c218-5b0f-4f77-b057-d44a6c8f42a1";
const seededId = "3d080a59-c16a-4b1e-846e-dd7e8307fec0";

test("new extraction UUIDs retain identity while exact demo names receive photos", () => {
  for (const name of ["Char Siew Rice", "Braised Pork Knuckle Rice", "Braised Pork Knuckle Noodles", "Roasted Sausage Rice", "Chicken Feet Noodle / Hor Fun", "Mushroom Chicken Feet", "Charcoal Char Siew Wanton Noodle", "Wanton Soup", "Dumpling Soup", "Oyster Sauce Kailan"]) {
    const dish = { id: freshId, name };
    assert.ok(demoPhotoForDish(DEMO_RESTAURANT_ID, dish)?.source);
    assert.deepEqual(dish, { id: freshId, name });
  }
});

test("explicit OCR aliases handle case, spaces, slash spacing, and singular noodles", () => {
  for (const [name, file] of [["  CHAR  SIEW Rice ", "char-siew-rice"], ["Chicken Feet Noodle/Hor Fun", "chicken-feet-noodles"], ["Braised Pork Knuckle Noodle", "braised-pork-knuckle-noodles"], ["Charcoal Char Siew Wanton Noodles", "charcoal-char-siew-wanton-noodles"]]) {
    assert.equal(demoPhotoForDish(DEMO_RESTAURANT_ID, { id: freshId, name })?.source, `/demo-food/${file}.jpg`);
  }
});

test("photos never cross restaurants or guess ambiguous dishes", () => {
  assert.equal(demoPhotoForDish(freshId, { id: seededId, name: "Char Siew Rice" }), null);
  for (const name of ["Chicken Feet Hor Fun", "Chicken Feet", "Mushroom Soup", "Wanton Noodles", "Fried Rice", "Char Siew Rice Special"]) {
    assert.equal(demoPhotoForDish(DEMO_RESTAURANT_ID, { id: freshId, name }), null);
  }
  assert.equal(demoPhotoForDish(DEMO_RESTAURANT_ID, { id: seededId, name: "Dumpling Soup" }), null);
});

test("wanton and dumpling soup remain different photos", () => {
  const wanton = demoPhotoForDish(DEMO_RESTAURANT_ID, { id: freshId, name: "Wanton Soup" });
  const dumpling = demoPhotoForDish(DEMO_RESTAURANT_ID, { id: freshId, name: "Dumpling Soup" });
  assert.notEqual(wanton?.source, dumpling?.source);
  assert.notEqual(wanton?.position, dumpling?.position);
});
