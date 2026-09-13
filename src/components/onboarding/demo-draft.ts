import { Id, MenuSchema, type Menu } from "@/shared/contracts";
import { amount, type DishEdit, type GlobalAddonEdit, type GroupEdit } from "./review-state";

const DEMO_REASON = "Automated demo cleanup: retained readable names and prices; skipped incomplete entries.";
const validName = (value: string) => value.trim().length > 0 && value.trim().length <= 120;
const validPrice = (value: string, negative = false) => {
  const cents = amount(value, negative);
  return Number.isInteger(cents) && Math.abs(cents) <= 1_000_000 && (negative || cents >= 0);
};
const selection = (value: string) => /^\d+$/.test(value.trim()) ? Number(value) : NaN;

/** The demo caller opts into skipping unreadable rows; normal merchant review is unchanged. */
export function cleanDemoDishes(input: DishEdit[]): { dishes: DishEdit[]; skipped: string[] } {
  const dishes: DishEdit[] = [], skipped: string[] = [];
  const dishIds = new Set<string>();
  for (const dish of input) {
    const label = dish.name.trim() || "Unnamed dish";
    if (!dish.included || !validName(dish.name) || !validPrice(dish.price) || !Id.safeParse(dish.id).success || dishIds.has(dish.id) || dishes.length >= 100) {
      skipped.push(label);
      continue;
    }
    const groups: GroupEdit[] = [], groupIds = new Set<string>(), optionIds = new Set<string>();
    let requiredInvalid = false;
    for (const group of dish.groups) {
      const groupLabel = `${label}: ${group.name.trim() || "Unnamed options"}`;
      const min = selection(group.min), max = selection(group.max);
      const optional = min === 0;
      const validRules = Number.isInteger(min) && Number.isInteger(max) && min >= 0 && min <= max && max <= 20 && max <= group.options.length;
      if (!validRules || !validName(group.name) || !Id.safeParse(group.id).success || groupIds.has(group.id) || groups.length >= 20) {
        if (!optional) { requiredInvalid = true; break; }
        skipped.push(groupLabel);
        continue;
      }
      const localIds = new Set<string>();
      const options = group.options.filter(option => {
        if (!validName(option.name) || !validPrice(option.price, true) || !Id.safeParse(option.id).success || optionIds.has(option.id) || localIds.has(option.id) || localIds.size >= 20) {
          skipped.push(`${groupLabel}: ${option.name.trim() || "Unnamed add-on"}`);
          return false;
        }
        localIds.add(option.id);
        return true;
      }).map(option => ({ ...option, name: option.name.trim(), price: option.price.trim() }));
      if (options.length < min) { requiredInvalid = true; break; }
      if (!options.length || max === 0) {
        skipped.push(groupLabel);
        continue;
      }
      for (const id of localIds) optionIds.add(id);
      groupIds.add(group.id);
      groups.push({ ...group, name: group.name.trim(), min: String(min), max: String(Math.min(max, options.length)), options });
    }
    if (requiredInvalid) { skipped.push(`${label} (incomplete required options)`); continue; }
    dishIds.add(dish.id);
    dishes.push({ ...dish, name: dish.name.trim(), price: dish.price.trim(), groups, included: true, confirmed: true, reason: DEMO_REASON });
  }
  return { dishes, skipped };
}

/** Repeated or unreadable printed extras never become free or invented options. */
export function cleanDemoAddons(rows: GlobalAddonEdit[]): GlobalAddonEdit[] {
  const names = new Set<string>(), ids = new Set<string>();
  return rows.filter(row => {
    const name = row.name.trim().toLowerCase();
    if (!row.included || !validName(row.name) || !validPrice(row.price) || !Id.safeParse(row.id).success || names.has(name) || ids.has(row.id) || names.size >= 20) return false;
    names.add(name);
    ids.add(row.id);
    return true;
  }).map(row => ({ ...row, name: row.name.trim(), price: row.price.trim() }));
}

export function demoMenu(input: { dishes: DishEdit[]; id: string; restaurantId: string; version: number; name: string }): Menu {
  const { dishes } = cleanDemoDishes(input.dishes);
  if (!dishes.length) throw new Error("No readable dishes yet. Try a clearer photo or add a dish with its price.");
  return MenuSchema.parse({
    id: input.id, restaurantId: input.restaurantId, version: input.version, currency: "SGD", name: input.name.trim(),
    dishes: dishes.map(dish => ({
      id: dish.id, name: dish.name, priceCents: amount(dish.price), available: dish.available,
      modifierGroups: dish.groups.map(group => ({
        id: group.id, name: group.name, minSelections: Number(group.min), maxSelections: Number(group.max),
        options: group.options.map(option => ({ id: option.id, name: option.name, priceDeltaCents: amount(option.price, true) })),
      })),
    })),
  });
}
