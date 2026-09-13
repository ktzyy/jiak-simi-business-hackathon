import test from "node:test";
import assert from "node:assert/strict";
import { detailsInput, editorHours, weeklyHours, matchesPublication, PendingPublicationSchema } from "./hours-state";
import { emptyHours } from "./review-state";
import { fixtureStallDetails } from "@/shared/stall-details";
import { fixtureMenu } from "@/shared/fixtures";
test("unresolved days stay invalid and a reviewed closed week is valid", () => {
  assert.throws(() => detailsInput("Stall", Array.from({ length: 7 }, emptyHours), false));
  assert.equal(weeklyHours(Array.from({ length: 7 }, () => ({ ...emptyHours(), closed: true })), false).length, 7);
});
test("saved four-period hours and minute precision roundtrip without truncation", () => {
  const details = structuredClone(fixtureStallDetails);
  details.weeklyHours[0].intervals = [{ opens: "08:03", closes: "09:17", closesNextDay: false }, { opens: "10:00", closes: "11:00", closesNextDay: false }, { opens: "12:00", closes: "13:00", closesNextDay: false }, { opens: "14:00", closes: "15:00", closesNextDay: false }];
  assert.deepEqual(weeklyHours(editorHours(details), false), details.weeklyHours);
});
test("same-hours choice creates seven explicit days and split breaks become canonical intervals", () => {
  const day = { ...emptyHours(), start: "09:00", end: "18:00", hasBreak: true, breakStart: "12:00", breakEnd: "13:00" };
  const week = weeklyHours(Array.from({ length: 7 }, () => day), true);
  assert.deepEqual(week.map(day => day.weekday), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(week[0].intervals.length, 2);
});
test("publication recovery requires exact reviewed details, not only matching menu", () => {
  const attempt = PendingPublicationSchema.parse({ menu: fixtureMenu, details: fixtureStallDetails });
  assert.equal(matchesPublication(attempt, attempt), true);
  assert.equal(matchesPublication(attempt, { menu: fixtureMenu, details: null }), false);
  assert.equal(matchesPublication(attempt, { menu: fixtureMenu, details: { ...fixtureStallDetails, version: 2 } }), false);
  assert.equal(PendingPublicationSchema.safeParse(fixtureMenu).success, false);
});
