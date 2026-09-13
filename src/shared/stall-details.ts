import { z } from "zod";
import { Id, MenuSchema } from "./contracts";

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm in 24-hour time.");
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export const HoursIntervalSchema = z.strictObject({ opens: time, closes: time, closesNextDay: z.boolean() }).superRefine((interval, ctx) => {
  const duration = minutes(interval.closes) + (interval.closesNextDay ? 1440 : 0) - minutes(interval.opens);
  if (duration <= 0 || duration > 1440) ctx.addIssue({ code: "custom", message: "An interval must last more than zero and at most 24 hours. Mark overnight closing explicitly.", path: ["closes"] });
});
export const HoursDaySchema = z.strictObject({ weekday: z.number().int().min(1).max(7), closed: z.boolean(), intervals: z.array(HoursIntervalSchema).max(4) }).superRefine((day, ctx) => {
  if (day.closed && day.intervals.length) ctx.addIssue({ code: "custom", message: "A closed day cannot have opening intervals.", path: ["intervals"] });
  if (!day.closed && !day.intervals.length) ctx.addIssue({ code: "custom", message: "An open day requires at least one interval.", path: ["intervals"] });
});
export const WeeklyHoursSchema = z.array(HoursDaySchema).length(7).superRefine((days, ctx) => {
  if (new Set(days.map(day => day.weekday)).size !== 7) ctx.addIssue({ code: "custom", message: "Set each ISO weekday 1–7 exactly once." });
  const week = 7 * 1440;
  const spans: { start: number; end: number; day: number; interval: number }[] = [];
  days.forEach((day, dayIndex) => day.intervals.forEach((interval, intervalIndex) => {
    const start = (day.weekday - 1) * 1440 + minutes(interval.opens);
    const end = (day.weekday - 1) * 1440 + minutes(interval.closes) + (interval.closesNextDay ? 1440 : 0);
    spans.push({ start, end: Math.min(end, week), day: dayIndex, interval: intervalIndex });
    if (end > week) spans.push({ start: 0, end: end - week, day: dayIndex, interval: intervalIndex });
  }));
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < spans.length; index++) {
    if (spans[index].start < spans[index - 1].end) ctx.addIssue({ code: "custom", message: "Opening intervals overlap, including overnight service from the previous day.", path: [spans[index].day, "intervals", spans[index].interval] });
  }
});
export const StallDetailsInputSchema = z.strictObject({ name: z.string().trim().min(1).max(120), timezone: z.literal("Asia/Singapore"), weeklyHours: WeeklyHoursSchema });
export const SaveStallDetailsSchema = StallDetailsInputSchema.extend({ expectedVersion: z.number().int().nonnegative() });
export const StallDetailsSchema = StallDetailsInputSchema.extend({ restaurantId: Id, version: z.number().int().positive() });
export const StallDetailsResponseSchema = z.strictObject({ details: StallDetailsSchema.nullable() });
export const SavedStallDetailsResponseSchema = z.strictObject({ details: StallDetailsSchema });
export const PublishedStallSchema = z.strictObject({ menu: MenuSchema, details: StallDetailsSchema.nullable() });
export type StallDetails = z.infer<typeof StallDetailsSchema>;
export type SaveStallDetails = z.infer<typeof SaveStallDetailsSchema>;

// Synthetic fixture only. Never silently default a merchant's actual schedule.
export const fixtureStallDetails: StallDetails = {
  restaurantId: "00000000-0000-4000-8000-000000000002", version: 1, name: "Synthetic test stall", timezone: "Asia/Singapore",
  weeklyHours: Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, closed: index >= 5, intervals: index < 5 ? [{ opens: "09:00", closes: "18:00", closesNextDay: false }] : [] })),
};
