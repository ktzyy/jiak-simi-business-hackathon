import assert from "node:assert/strict";
import test from "node:test";
import { OCR_DRAFT_FIXTURE } from "@/shared/ocr-fixtures";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";
import { draftDishes, reviewedMenu, hoursProblem, emptyHours, titleName } from "./review-state";

function reviewedFixture() {
  const draft = structuredClone(OCR_DRAFT_FIXTURE);
  const dishes = draftDishes(draft).map(d => ({ ...d, confirmed: true, reason: "Checked against the original menu source." }));
  const sources = Object.fromEntries((draft.sourceEntries ?? []).map(source => [source.id, {
    dishIds: dishes.filter(d => draft.items.find(item => item.id === d.id)?.sourceEntryId === source.id).map(d => d.id),
    reason: source.kind === "addon" ? "Left out of this test menu after reviewing its own printed location." : "Verified original source pairing.",
    confirmed: true,
  }]));
  const issues = Object.fromEntries(draft.issues.filter(issue => issue.blocking).map(issue => [issue.id, "Reviewed this issue against the source and recorded a decision."]));
  return { draft, dishes, sources, issues, id: "f285252c-2ba0-4344-bd3f-2fb4e75f2ea1", restaurantId: DEMO_RESTAURANT_ID, version: 2, name: "Hawker Menu" };
}
const open = { ...emptyHours(), start: "11:00", end: "21:00" };

test("the saved extraction needs all 16 reviewed dishes and both printed Rice entries", () => {
  const input = reviewedFixture();
  assert.equal(reviewedMenu(input).dishes.length, 16);
  assert.equal(input.draft.sourceEntries?.filter(source => source.name === "Rice").length, 2);
});

for (const side of [0, 1]) {
  test(`Rice source ${side + 1} requires its own decision even if the other has been reviewed`, () => {
    const input = reviewedFixture();
    const source = input.draft.sourceEntries!.filter(entry => entry.name === "Rice")[side];
    input.sources[source.id].confirmed = false;
    assert.throws(() => reviewedMenu(input), /Confirm the source entry/);
  });
}

test("every blocking issue must be resolved before a menu can be prepared", () => {
  assert.throws(() => reviewedMenu({ ...reviewedFixture(), issues: {} }), /Resolve each highlighted/);
});

test("an unknown price stays blank and cannot silently become free", () => {
  const input = reviewedFixture(); input.dishes[0].price = "";
  assert.throws(() => reviewedMenu(input), /Add a price/);
});

test("an item without explicit approval prevents preparation", () => {
  const input = reviewedFixture(); input.dishes[0].confirmed = false;
  assert.throws(() => reviewedMenu(input), /Done with this dish/);
});

test("excluding an original entry requires a reason", () => {
  const input = reviewedFixture(); input.dishes[0].included = false; input.dishes[0].reason = "";
  assert.throws(() => reviewedMenu(input), /why this entry/);
});

test("publication keeps a merchant’s explicit brand spelling", () => {
  const input = reviewedFixture(); input.dishes[0].name = "McHawker BBQ";
  assert.equal(reviewedMenu(input).dishes[0].name, "McHawker BBQ");
});

test("extracted names get a consistent title-case starting point", () => {
  assert.equal(titleName("char siew rice"), "Char Siew Rice");
  assert.equal(titleName("BBQ pork rice"), "BBQ Pork Rice");
});

test("blank hours never imply a default opening time", () => {
  assert.ok(hoursProblem(Array.from({ length: 7 }, emptyHours), true));
});

test("a complete daily opening period is accepted", () => {
  assert.equal(hoursProblem(Array.from({ length: 7 }, () => ({ ...open })), true), null);
});

test("a break outside opening hours needs correction", () => {
  assert.ok(hoursProblem(Array.from({ length: 7 }, () => ({ ...open, hasBreak: true, breakStart: "09:00", breakEnd: "12:00" })), true));
});

test("a break fully inside opening hours is accepted", () => {
  assert.equal(hoursProblem(Array.from({ length: 7 }, () => ({ ...open, hasBreak: true, breakStart: "15:00", breakEnd: "16:00" })), true), null);
});

test("overnight hours require the explicit next-day choice", () => {
  const hours = Array.from({ length: 7 }, () => ({ ...open, start: "22:00", end: "02:00", nextDay: true }));
  assert.equal(hoursProblem(hours, true), null);
  assert.ok(hoursProblem(hours.map(day => ({ ...day, nextDay: false })), true));
});

test("overnight hours cannot overlap the following day", () => {
  const week = Array.from({ length: 7 }, () => ({ ...emptyHours(), closed: true }));
  week[0] = { ...open, start: "22:00", end: "02:00", nextDay: true };
  week[1] = { ...open, start: "01:00", end: "09:00" };
  assert.ok(hoursProblem(week, false));
});

test("out-of-range hours or minutes are rejected", () => {
  assert.ok(hoursProblem(Array.from({ length: 7 }, () => ({ ...open, start: "25:00" })), true));
  assert.ok(hoursProblem(Array.from({ length: 7 }, () => ({ ...open, start: "11:65" })), true));
});
