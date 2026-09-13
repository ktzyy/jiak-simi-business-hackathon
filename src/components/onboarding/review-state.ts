import { MenuSchema, type Menu } from "@/shared/contracts";
import type { ExtractedMenuDraft } from "@/shared/extraction";
import { weeklyHours } from "./hours-state";
import { buildReviewedMenu } from "@/shared/menu-review";

export type OptionEdit = { id: string; name: string; price: string };
export type GroupEdit = { id: string; name: string; min: string; max: string; options: OptionEdit[] };
export type DishEdit = { id: string; name: string; price: string; available: boolean; groups: GroupEdit[]; included: boolean; confirmed: boolean; reason: string; draftItemId?: string };
export type SourceDecision = { dishIds: string[]; reason: string; confirmed: boolean };
export type HourDay = { intervals?: { opens: string; closes: string; closesNextDay: boolean }[]; closed: boolean; start: string; end: string; nextDay: boolean; breakStart: string; breakEnd: string; hasBreak: boolean };
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
export function hoursProblem(hours: HourDay[], same: boolean): string | null {
  try { weeklyHours(hours, same); return null; } catch (error) { return error instanceof Error ? ("issues" in error ? "Set all seven days and check opening periods, breaks and overnight overlaps." : error.message) : "Check your opening hours."; }
}
export function timeLabel(value: string) {
  if (!value) return "—";
  const hour = Number(value.slice(0, 2));
  return `${hour % 12 || 12}:${value.slice(3)} ${hour < 12 ? "am" : "pm"}`;
}
export function hoursSummary(hours: HourDay[], same: boolean) {
  const describe = (day: HourDay) => day.closed ? "Closed" : day.intervals ? day.intervals.map(period => `${timeLabel(period.opens)}–${timeLabel(period.closes)}${period.closesNextDay ? " next day" : ""}`).join(", ") : `${timeLabel(day.start)}–${timeLabel(day.end)}${day.nextDay ? " next day" : ""}${day.hasBreak ? ` (break ${timeLabel(day.breakStart)}–${timeLabel(day.breakEnd)})` : ""}`;
  return same ? `Mon–Sun ${describe(hours[0])}` : hours.map((day, i) => `${DAYS[i]} ${describe(day)}`).join(" · ");
}

export type GlobalAddonEdit = { id: string; name: string; price: string; included: boolean; sourceIds: string[] };
export function globalAddonRows(draft: ExtractedMenuDraft | null, dishes: DishEdit[]): GlobalAddonEdit[] {
  if (draft) return (draft.sourceEntries ?? []).filter(entry => entry.kind === "addon").map(entry => ({ id: entry.id, name: titleName(entry.name ?? ""), price: dollars(entry.priceCents), included: true, sourceIds: [entry.id] }));
  const first = dishes.find(dish => dish.included)?.groups.find(group => group.min === "0" && /^(additional ingredients|add-ons|extras)$/i.test(group.name));
  return first?.options.map(option => ({ ...option, included: true, sourceIds: [] })) ?? [];
}
export function applyGlobalAddons(dishes: DishEdit[], rows: GlobalAddonEdit[], groupId: string) {
  const included = rows.filter(row => row.included);
  if (included.length > 20) throw new Error("Use at most 20 shared add-ons. Leave out any duplicate printed entries.");
  const names = new Set<string>();
  for (const row of included) {
    const normalized = row.name.trim().toLowerCase();
    if (!normalized || row.name.trim().length > 120) throw new Error("Give each included add-on a name.");
    if (names.has(normalized)) throw new Error("The same add-on appears twice. Keep one row and leave the duplicate out.");
    names.add(normalized);
    const cents = amount(row.price);
    if (!Number.isInteger(cents) || cents < 0 || cents > 1_000_000) throw new Error(`Check the price for ${row.name}. Enter 0 only when it is free.`);
  }
  const affected = dishes.filter(dish => dish.included);
  if (!affected.length) throw new Error("Include at least one dish before applying add-ons.");
  const group: GroupEdit = { id: groupId, name: "Additional Ingredients", min: "0", max: String(included.length), options: included.map(row => ({ id: row.id, name: row.name.trim(), price: row.price.trim() })) };
  const updated = affected.map(dish => {
    // Only replace this editor's group, or the dedicated optional add-on panel.
    // Required noodle alternatives and chilli groups remain untouched.
    const groups = dish.groups.filter(g => g.id !== groupId && !(g.min === "0" && /^(additional ingredients|add-ons|extras)$/i.test(g.name)));
    if (included.length) groups.push(group);
    if (groups.length > 20) throw new Error(`Too many option groups for ${dish.name}.`);
    return { ...dish, groups, confirmed: false };
  });
  const sources: Record<string, SourceDecision> = {};
  for (const row of rows) for (const sourceId of row.sourceIds) sources[sourceId] = row.included ? { dishIds: affected.map(dish => dish.id), confirmed: true, reason: `Reviewed ${row.name} at S$${Number(row.price).toFixed(2)} as an optional add-on for every included dish; each add-on can be selected once.` } : { dishIds: [], confirmed: true, reason: `Explicitly left ${row.name || "this printed add-on"} out of the shared add-on list.` };
  return { dishes: updated, sources };
}
