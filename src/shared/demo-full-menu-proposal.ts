import { MenuSchema, type Menu } from "./contracts";
import { DEMO_MENU, DEMO_MENU_WITH_EXTRAS } from "./demo-menu";

// Review-only proposal: nullable prices deliberately prevent Menu assignment.
// Never feed this object to publishMenu; merchant resolution is still required.
type ReviewDish = Omit<Menu["dishes"][number], "priceCents"> & {
  priceCents: number | null; sourceRegion: string;
  confidence: "high" | "unresolved"; reviewRequired: true;
};
const known = (index: number, sourceRegion: string): ReviewDish => ({ ...DEMO_MENU_WITH_EXTRAS.dishes[index], sourceRegion, confidence: "high", reviewRequired: true });
const extra = (n: number, name: string, priceCents: number | null, sourceRegion: string): ReviewDish => ({
  id: `93fef6a9-bdca-448e-8da3-${String(n).padStart(12, "0")}`, name, priceCents,
  available: false, modifierGroups: [], sourceRegion, confidence: priceCents === null ? "unresolved" : "high", reviewRequired: true,
});
export const DEMO_FULL_MENU_PROPOSAL: Omit<Menu, "dishes"> & { status: "needs_review"; dishes: ReviewDish[] } = {
  ...DEMO_MENU, version: 3, status: "needs_review",
  dishes: [
    known(0, "left upper dish"),
    extra(1, "Roasted Sausage Rice", 450, "upper center dish"),
    known(1, "left middle dish"),
    extra(2, "Chicken Feet Noodle / Hor Fun", 450, "center middle dish; two base choices require explicit mapping"),
    extra(3, "Mushroom Chicken Feet", 450, "center-right dish, handwritten $4.50 sticker"),
    known(2, "left bottom dish"),
    extra(4, "Charcoal Char Siew Wanton Noodle", 450, "center bottom dish"),
    extra(5, "Wanton Soup", null, "Freshly Made box left bowl; brown tape obscures price"),
    extra(6, "Dumpling Soup", 450, "Freshly Made box upper-right bowl"),
    extra(7, "Oyster Sauce Kailan", 450, "Freshly Made box lower-right plate, handwritten sticker"),
  ],
};
export const FULL_PHOTO_EXTRA_EVIDENCE = [
  { name: "Add Roasted Sausage", priceCents: 200, region: "extras left row 1" },
  { name: "Add Char Siew", priceCents: 200, region: "extras left row 2" },
  { name: "Add Chicken Feet", priceCents: 200, region: "extras left row 3" },
  { name: "Add Dumpling", priceCents: 200, region: "extras left row 4" },
  { name: "Add Wanton", priceCents: 100, region: "extras left row 5" },
  { name: "Add Vegetables", priceCents: 100, region: "extras right row 1" },
  { name: "Add Noodle", priceCents: 100, region: "extras right row 2" },
  { name: "Noodle Plain", priceCents: 200, region: "extras right row 3" },
  { name: "Egg", priceCents: 100, region: "extras right row 4" },
  { name: "Peanut", priceCents: 100, region: "extras right row 5" },
  { name: "Rice", priceCents: null, region: "extras right row 6; glare and creased laminate obscure leading digit" },
].map(entry => ({ ...entry, confidence: entry.priceCents === null ? "unresolved" as const : "high" as const, reviewRequired: true as const }));
export const FULL_MENU_REVIEW_QUESTIONS = [
  "Confirm Wanton Soup price; do not copy the Dumpling Soup price from beside it.",
  "Confirm Rice price; the original is distorted and neither prior OCR $1.00 nor a visual candidate is reliable.",
  "Confirm whether Chicken Feet Noodle / Hor Fun is two dishes or one dish requiring a base choice.",
  "Assign each photo extra/side to applicable dishes and confirm selection rules; Noodle Plain/Rice may be standalone sides.",
  "Confirm availability and retain/extend previously approved demo Shao Rou and chilli additions separately from photo evidence.",
];

// User resolved both obscured prices for this synthetic demo on 13 Sep 2026.
// Root-approved mapping: panel entries apply as optional extras to all ten mains;
// Noodle Plain, Peanut and Rice are extras here, not duplicate standalone dishes.
export const FULL_MENU_PRICE_RESOLUTIONS = { wantonSoupCents: 400, riceExtraCents: 50 } as const;
export const FULL_DEMO_MAPPING_PROVENANCE = {
  photo: "IMG_4544.JPG", scope: "synthetic demo; not real merchant approval",
  userPriceOverrides: { "Wanton Soup": 400, Rice: 50 },
  userAdditions: { "Shao Rou": 200, Chilli: 0, "No chilli": 0 },
  panelMapping: "All eleven photo panel entries are optional extras for every main; no standalone side duplicates.",
  noodleMapping: "Chicken Feet Noodle / Hor Fun requires one free choice: Noodle or Hor Fun.",
};

export const DEMO_FULL_MENU = MenuSchema.parse({
  ...DEMO_MENU, version: 3,
  dishes: DEMO_FULL_MENU_PROPOSAL.dishes.map((entry, index) => {
    const old = DEMO_MENU_WITH_EXTRAS.dishes.find(dish => dish.id === entry.id);
    const uid = (slot: number) => `bea2ae55-b141-4f43-bf7c-${String((index + 1) * 100 + slot).padStart(12, "0")}`;
    const previousOption = (name: string) => old?.modifierGroups.flatMap(group => group.options).find(option => option.name.toLowerCase() === name.toLowerCase());
    const photoOptions = FULL_PHOTO_EXTRA_EVIDENCE.map((extra, n) => {
      const name = extra.name.replace(/^Add /, "");
      return { id: previousOption(name)?.id ?? uid(n + 10), name, priceDeltaCents: extra.name === "Rice" ? FULL_MENU_PRICE_RESOLUTIONS.riceExtraCents : extra.priceCents! };
    });
    const extras = { id: old?.modifierGroups[0].id ?? uid(1), name: "Additional Ingredients", minSelections: 0, maxSelections: 12,
      options: [...photoOptions, { id: previousOption("Shao Rou")?.id ?? uid(30), name: "Shao Rou", priceDeltaCents: 200 }] };
    const chilli = old?.modifierGroups[1] ?? { id: uid(2), name: "Chilli preference", minSelections: 0, maxSelections: 1,
      options: [{ id: uid(31), name: "Chilli", priceDeltaCents: 0 }, { id: uid(32), name: "No chilli", priceDeltaCents: 0 }] };
    const base = { id: uid(3), name: "Noodle type", minSelections: 1, maxSelections: 1,
      options: [{ id: uid(33), name: "Noodle", priceDeltaCents: 0 }, { id: uid(34), name: "Hor Fun", priceDeltaCents: 0 }] };
    return { id: entry.id, name: entry.name, priceCents: entry.name === "Wanton Soup" ? FULL_MENU_PRICE_RESOLUTIONS.wantonSoupCents : entry.priceCents!,
      available: true, modifierGroups: entry.name === "Chicken Feet Noodle / Hor Fun" ? [base, extras, chilli] : [extras, chilli] };
  }),
});
