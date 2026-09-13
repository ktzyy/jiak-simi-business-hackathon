import { MenuSchema, type Menu } from "@/shared/contracts";
import type { ExtractedMenuDraft } from "@/shared/extraction";
import { buildReviewedMenu } from "@/shared/menu-review";

export type OptionEdit = { id: string; name: string; price: string };
export type GroupEdit = { id: string; name: string; min: string; max: string; options: OptionEdit[] };
export type DishEdit = { id: string; name: string; price: string; available: boolean; groups: GroupEdit[]; included: boolean; confirmed: boolean; reason: string; draftItemId?: string };
export type SourceDecision = { dishIds: string[]; reason: string; confirmed: boolean };
export type HourDay = { closed: boolean; start: string; end: string; nextDay: boolean; breakStart: string; breakEnd: string; hasBreak: boolean };
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const emptyHours = (): HourDay => ({ closed: false, start: "", end: "", nextDay: false, breakStart: "", breakEnd: "", hasBreak: false });
export const titleName = (value: string) => value.trim().replace(/[A-Za-z]+(?:'[A-Za-z]+)?/g, word => /^(BBQ|XL|XXL|DIY|SGD)$/.test(word) ? word : word[0].toUpperCase() + word.slice(1).toLowerCase());
export const dollars = (value: number | null) => value === null ? "" : (value / 100).toFixed(2);
export const amount = (value: string, negative = false) => {
  if (!(negative ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/).test(value.trim())) return NaN;
  return Math.round(Number(value) * 100);
};
export function draftDishes(draft: ExtractedMenuDraft): DishEdit[] {
  return draft.items.map(item => ({ id: item.id, draftItemId: item.id, name: titleName(item.name ?? ""), price: dollars(item.priceCents), available: true, included: true, confirmed: false, reason: "", groups: item.modifierGroups.map(group => ({ id: group.id, name: group.name ?? "", min: group.minSelections === null ? "" : String(group.minSelections), max: group.maxSelections === null ? "" : String(group.maxSelections), options: group.options.map(option => ({ id: option.id, name: titleName(option.name ?? ""), price: dollars(option.priceDeltaCents) })) })) }));
}
export function existingDishes(menu: Menu): DishEdit[] {
  return menu.dishes.map(dish => ({ id: dish.id, name: dish.name, price: dollars(dish.priceCents), available: dish.available, included: true, confirmed: false, reason: "", groups: dish.modifierGroups.map(group => ({ id: group.id, name: group.name, min: String(group.minSelections), max: String(group.maxSelections), options: group.options.map(option => ({ id: option.id, name: option.name, price: dollars(option.priceDeltaCents) })) })) }));
}
export function newDish(): DishEdit {
  return { id: crypto.randomUUID(), name: "", price: "", available: true, included: true, confirmed: false, reason: "", groups: [] };
}
export function dishProblem(dish: DishEdit): string | null {
  if (!dish.included) return dish.reason.trim() ? null : "Tell us why this entry is being left out.";
  if (!dish.name.trim() || dish.name.trim().length > 120) return "Add a dish name of 1–120 characters.";
  const price = amount(dish.price);
  if (!Number.isInteger(price) || price < 0 || price > 1_000_000) return "Add a price from S$0.00 to S$10,000.00, with up to two decimal places.";
  if (dish.groups.length > 20) return "Use up to 20 groups of options per dish.";
  for (const group of dish.groups) {
    if (!group.name.trim() || group.name.trim().length > 120) return "Give each group of options a name.";
    if (!/^\d+$/.test(group.min) || !/^\d+$/.test(group.max)) return "Choose the minimum and maximum selections for each option group.";
    if (Number(group.min) > Number(group.max) || Number(group.max) > group.options.length || Number(group.max) > 20) return "The maximum must cover the minimum and cannot exceed the number of options (up to 20).";
    for (const option of group.options) {
      if (!option.name.trim() || option.name.trim().length > 120) return "Give each option a name.";
      const extra = amount(option.price, true);
      if (!Number.isInteger(extra) || Math.abs(extra) > 1_000_000) return "Add each option’s price. Use 0 for no extra charge.";
    }
  }
  return null;
}
export function reviewedMenu(input: { draft: ExtractedMenuDraft | null; dishes: DishEdit[]; sources: Record<string, SourceDecision>; issues: Record<string, string>; id: string; restaurantId: string; version: number; name: string }): Menu {
  for (const dish of input.dishes) {
    const problem = dishProblem(dish);
    if (problem) throw new Error(`${dish.name || "Unnamed dish"}: ${problem}`);
    if (!dish.confirmed) throw new Error(`Check ${dish.name || "the unnamed dish"}, then choose “Done with this dish”.`);
  }
  const menu = MenuSchema.parse({ id: input.id, restaurantId: input.restaurantId, version: input.version, currency: "SGD", name: input.name.trim(), dishes: input.dishes.filter(d => d.included).map(d => ({ id: d.id, name: d.name.trim(), priceCents: amount(d.price), available: d.available, modifierGroups: d.groups.map(g => ({ id: g.id, name: g.name.trim(), minSelections: Number(g.min), maxSelections: Number(g.max), options: g.options.map(o => ({ id: o.id, name: o.name.trim(), priceDeltaCents: amount(o.price, true) })) })) })) });
  if (!input.draft) return menu;
  for (const source of input.draft.sourceEntries ?? []) {
    if (!input.sources[source.id]?.confirmed) throw new Error(`Confirm the source entry “${source.name ?? source.kind}” at ${source.region}.`);
  }
  for (const issue of input.draft.issues.filter(i => i.blocking)) {
    if (!input.issues[issue.id]?.trim()) throw new Error("Resolve each highlighted check before previewing your menu.");
  }
  return buildReviewedMenu(input.draft, {
    draftId: input.draft.id, confirmed: true, menu,
    itemResolutions: input.dishes.filter(d => d.draftItemId).map(d => ({ draftItemId: d.draftItemId, dishId: d.included ? d.id : null, reason: d.reason })),
    sourceResolutions: (input.draft.sourceEntries ?? []).map(s => ({ sourceEntryId: s.id, dishIds: input.sources[s.id].dishIds, reason: input.sources[s.id].reason })),
    issueResolutions: input.draft.issues.filter(i => i.blocking).map(i => ({ issueId: i.id, reason: input.issues[i.id] })),
    manualDishIds: input.dishes.filter(d => !d.draftItemId && d.included).map(d => d.id),
  });
}
const minute = (v: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : NaN;
export function hoursProblem(hours: HourDay[], same: boolean): string | null {
  const effective = same ? DAYS.map(() => hours[0]) : hours;
  if (effective.every(day => day.closed)) return "Choose at least one day when your stall is open.";
  const occupied: { start: number; end: number; day: string }[] = [];
  for (let i = 0; i < effective.length; i++) {
    const day = effective[i];
    if (day.closed) continue;
    const start = minute(day.start), end = minute(day.end) + (day.nextDay ? 1440 : 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 1440) return `Check the opening and closing times for ${same ? "each day" : DAYS[i]}. For overnight hours, tick “Closes next day”.`;
    if (day.hasBreak) {
      let bs = minute(day.breakStart), be = minute(day.breakEnd);
      if (day.nextDay && bs < start) bs += 1440;
      if (day.nextDay && be < start) be += 1440;
      if (!Number.isFinite(bs) || !Number.isFinite(be) || bs <= start || be >= end || bs >= be) return `Put ${same ? "your" : DAYS[i] + "’s"} midday break inside the opening hours.`;
      occupied.push({ start: i * 1440 + start, end: i * 1440 + bs, day: DAYS[i] }, { start: i * 1440 + be, end: i * 1440 + end, day: DAYS[i] });
    } else occupied.push({ start: i * 1440 + start, end: i * 1440 + end, day: DAYS[i] });
  }
  const segments = occupied.flatMap(s => s.end > 10080 ? [{ ...s, end: 10080 }, { ...s, start: 0, end: s.end - 10080 }] : [s]).sort((a, b) => a.start - b.start);
  if (segments.some((s, i) => i > 0 && s.start < segments[i - 1].end)) return "Two opening periods overlap. Check the overnight hours and the following day.";
  return null;
}
export function timeLabel(value: string) {
  if (!value) return "—";
  const hour = Number(value.slice(0, 2));
  return `${hour % 12 || 12}:${value.slice(3)} ${hour < 12 ? "am" : "pm"}`;
}
export function hoursSummary(hours: HourDay[], same: boolean) {
  const describe = (day: HourDay) => day.closed ? "Closed" : `${timeLabel(day.start)}–${timeLabel(day.end)}${day.nextDay ? " next day" : ""}${day.hasBreak ? ` (break ${timeLabel(day.breakStart)}–${timeLabel(day.breakEnd)})` : ""}`;
  return same ? `Mon–Sun ${describe(hours[0])}` : hours.map((day, i) => `${DAYS[i]} ${describe(day)}`).join(" · ");
}
