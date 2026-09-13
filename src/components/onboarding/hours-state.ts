import { z } from "zod";
import { MenuSchema } from "@/shared/contracts";
import { StallDetailsInputSchema, StallDetailsSchema, WeeklyHoursSchema, type StallDetails } from "@/shared/stall-details";
import type { HourDay } from "./review-state";
const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export function weeklyHours(hours: HourDay[], same: boolean) {
  const days = same ? Array.from({ length: 7 }, () => hours[0]) : hours;
  return WeeklyHoursSchema.parse(days.map((day, index) => {
    let intervals = day.intervals ?? [{ opens: day.start, closes: day.end, closesNextDay: day.nextDay }];
    if (!day.intervals && day.hasBreak) {
      const start = minute(day.start), end = minute(day.end) + (day.nextDay ? 1440 : 0);
      const bs = minute(day.breakStart) + (day.nextDay && minute(day.breakStart) < start ? 1440 : 0);
      const be = minute(day.breakEnd) + (day.nextDay && minute(day.breakEnd) < start ? 1440 : 0);
      if (!(start < bs && bs < be && be < end) || be >= 1440) throw new Error("Check the break times. For breaks after midnight, use separate opening periods.");
      intervals = [{ opens: day.start, closes: day.breakStart, closesNextDay: bs >= 1440 }, { opens: day.breakEnd, closes: day.end, closesNextDay: day.nextDay }];
    }
    return { weekday: index + 1, closed: day.closed, intervals: day.closed ? [] : intervals };
  }));
}
export function editorHours(details: StallDetails): HourDay[] {
  return [...details.weeklyHours].sort((a, b) => a.weekday - b.weekday).map(day => ({ closed: day.closed, start: "", end: "", nextDay: false, hasBreak: false, breakStart: "", breakEnd: "", intervals: day.intervals.map(interval => ({ ...interval })) }));
}
export function detailsInput(name: string, hours: HourDay[], same: boolean) { return StallDetailsInputSchema.parse({ name, timezone: "Asia/Singapore", weeklyHours: weeklyHours(hours, same) }); }
export function sameDetailsInput(a: ReturnType<typeof detailsInput>, b: StallDetails) { return JSON.stringify(a) === JSON.stringify(StallDetailsInputSchema.parse({ name: b.name, timezone: b.timezone, weeklyHours: b.weeklyHours })); }
export const PendingPublicationSchema = z.strictObject({ menu: MenuSchema, details: StallDetailsSchema });
export function matchesPublication(pending: z.infer<typeof PendingPublicationSchema>, published: { menu: unknown; details: StallDetails | null }) {
  return JSON.stringify(MenuSchema.parse(published.menu)) === JSON.stringify(pending.menu) && published.details !== null && JSON.stringify(StallDetailsSchema.parse(published.details)) === JSON.stringify(pending.details);
}
