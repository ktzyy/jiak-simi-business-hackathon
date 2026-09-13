import type { HourDay } from "./review-state";

// A view of the existing draft, never an automatic rewrite of saved hours.
export function compactHours(day: HourDay): HourDay | null {
  if (!day.intervals) return day;
  const periods = day.intervals;
  if (!periods.length) return { ...day, intervals: undefined };
  if (periods.length === 1) return { ...day, intervals: undefined, start: periods[0].opens, end: periods[0].closes, nextDay: periods[0].closesNextDay, hasBreak: false };
  const [first, last] = periods;
  // Only ordinary, positive daytime gaps can use the simple break controls.
  if (periods.length === 2 && !first.closesNextDay && first.opens < first.closes && first.closes < last.opens) {
    return { ...day, intervals: undefined, start: first.opens, end: last.closes, nextDay: last.closesNextDay, hasBreak: true, breakStart: first.closes, breakEnd: last.opens };
  }
  return null;
}

export function editCompactHours(day: HourDay, patch: Partial<HourDay>): HourDay {
  const compact = compactHours(day);
  return compact ? { ...compact, ...patch, intervals: undefined } : day;
}

export function openDay(day: HourDay, open: boolean): HourDay {
  return { ...day, closed: !open, ...(open && day.intervals?.length === 0 ? { intervals: undefined } : !open && !day.intervals ? { intervals: [] } : {}) };
}

export function individualDays(hours: HourDay[]): HourDay[] {
  const unresolved = hours.slice(1).every(day => !day.closed && !day.start && !day.end && !day.hasBreak && !day.intervals?.length);
  return unresolved ? hours.map(() => structuredClone(hours[0])) : hours;
}

export function openingPeriods(day: HourDay): NonNullable<HourDay["intervals"]> {
  if (day.intervals) return day.intervals.map(period => ({ ...period }));
  return day.hasBreak
    ? [{ opens: day.start, closes: day.breakStart, closesNextDay: false }, { opens: day.breakEnd, closes: day.end, closesNextDay: day.nextDay }]
    : [{ opens: day.start, closes: day.end, closesNextDay: day.nextDay }];
}
