import test from "node:test";
import assert from "node:assert/strict";
import { compactHours, editCompactHours, individualDays, openDay, openingPeriods } from "./hours-presentation";
import { emptyHours } from "./review-state";
import { weeklyHours } from "./hours-state";
const period = (opens: string, closes: string, closesNextDay = false) => ({ opens, closes, closesNextDay });
const dayWith = (...intervals: ReturnType<typeof period>[]) => ({ ...emptyHours(), intervals });
const week = (day: ReturnType<typeof emptyHours>) => weeklyHours([day, ...Array.from({ length: 6 }, () => ({ ...emptyHours(), closed: true }))], false);

test("viewing saved hours does not rewrite them; off-grid minutes survive editing", () => {
  const day = dayWith(period("08:03", "18:17"));
  const before = structuredClone(day);
  assert.equal(compactHours(day)?.start, "08:03");
  assert.deepEqual(day, before);
  assert.deepEqual(week(editCompactHours(day, { end: "19:11" }))[0].intervals, [period("08:03", "19:11")]);
});
test("saved midday split has compact break fields and retains both periods", () => {
  const day = dayWith(period("09:00", "12:30"), period("13:30", "21:00"));
  const compact = compactHours(day)!;
  assert.equal(compact.hasBreak, true);
  assert.deepEqual(week(compact)[0].intervals, day.intervals);
  assert.deepEqual(week(editCompactHours(day, { breakEnd: "14:00" }))[0].intervals, [period("09:00", "12:30"), period("14:00", "21:00")]);
  assert.deepEqual(week(editCompactHours(day, { hasBreak: false }))[0].intervals, [period("09:00", "21:00")]);
});
test("longer, adjacent and overnight split schedules stay in the full period editor", () => {
  for (const periods of [
    [period("08:03", "09:17"), period("10:00", "11:00"), period("12:00", "13:00"), period("14:00", "15:00")],
    [period("09:00", "12:00"), period("12:00", "18:00")],
    [period("00:30", "02:00"), period("20:00", "00:00", true)],
  ]) {
    const day = dayWith(...periods);
    if (periods.length !== 2 || periods[0].closes === periods[1].opens) assert.equal(compactHours(day), null);
    assert.deepEqual(openingPeriods(day), periods);
    assert.deepEqual(week(day)[0].intervals, periods);
  }
  const afterMidnight = dayWith(period("20:00", "01:00", true), period("02:00", "04:00"));
  assert.equal(compactHours(afterMidnight), null);
});
test("overnight and 24-hour selections remain explicit", () => {
  for (const p of [period("20:00", "02:00", true), period("09:00", "09:00", true)]) {
    const day = dayWith(p);
    assert.equal(compactHours(day)?.nextDay, true);
    assert.deepEqual(week(compactHours(day)!)[0].intervals, [p]);
  }
});
test("closed/open retains draft times; a saved closed day reopens unresolved", () => {
  const day = dayWith(period("09:00", "18:00"));
  assert.deepEqual(openDay(openDay(day, false), true), day);
  const reopened = openDay({ ...emptyHours(), closed: true, intervals: [] }, true);
  assert.equal(reopened.intervals, undefined);
  assert.equal(reopened.start, "");
  assert.throws(() => week(reopened));
});
test("closing a day bypasses an unfinished break without losing its draft", () => {
  const day = { ...emptyHours(), start: "09:00", end: "18:00", hasBreak: true };
  const closed = openDay(day, false);
  assert.deepEqual(week(closed)[0].intervals, []);
  const reopened = openDay(closed, true);
  assert.equal(reopened.hasBreak, true);
  assert.equal(reopened.start, "09:00");
  assert.throws(() => week(reopened));
});
test("switching to individual days retains existing schedules across remounts", () => {
  const days = [dayWith(period("09:00", "18:00")), ...Array.from({ length: 6 }, () => dayWith(period("11:00", "20:00")))];
  assert.deepEqual(individualDays(days), days);
  const newDays = [days[0], ...Array.from({ length: 6 }, emptyHours)];
  assert.deepEqual(individualDays(newDays), Array.from({ length: 7 }, () => days[0]));
});
