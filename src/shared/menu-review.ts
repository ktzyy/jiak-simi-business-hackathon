import { z } from "zod";
import { Id, MenuSchema, type Menu } from "./contracts";
import { extractedMenuDraftSchema, type ExtractedMenuDraft } from "./extraction";

const reason = z.string().trim().min(1).max(1000);
export const MenuExtractionReviewSchema = z.strictObject({
  draftId: Id,
  confirmed: z.literal(true),
  menu: MenuSchema,
  // Every original draft item is either paired to a reviewed dish or explicitly excluded.
  itemResolutions: z.array(z.strictObject({ draftItemId: Id, dishId: Id.nullable(), reason })).max(250),
  // Includes addons/fees/headings/repeated labels, even when excluded from the final menu.
  sourceResolutions: z.array(z.strictObject({ sourceEntryId: Id, dishIds: z.array(Id).max(100), reason })).max(250),
  issueResolutions: z.array(z.strictObject({ issueId: Id, reason })).max(1000),
  manualDishIds: z.array(Id).max(100),
});
export type MenuExtractionReview = z.infer<typeof MenuExtractionReviewSchema>;
export class MenuReviewError extends Error {
  readonly code = "MENU_REVIEW_REQUIRED";
}
const reject = (message: string): never => { throw new MenuReviewError(message); };
function exactIds(expected: string[], actual: string[], message: string) {
  if (new Set(actual).size !== actual.length || expected.length !== actual.length || expected.some((id) => !actual.includes(id))) reject(message);
}

/** Local review gate only: publication still requires an explicit authenticated publish request. */
export function buildReviewedMenu(draftInput: ExtractedMenuDraft, reviewInput: unknown): Menu {
  const parsedDraft = extractedMenuDraftSchema.safeParse(draftInput);
  const parsedReview = MenuExtractionReviewSchema.safeParse(reviewInput);
  if (!parsedDraft.success || !parsedReview.success) return reject("Check every menu name, price, option and review decision before continuing.");
  const draft = parsedDraft.data, review = parsedReview.data;
  if (review.draftId !== draft.id) return reject("These review decisions belong to a different menu photo.");
  exactIds(draft.items.map((item) => item.id), review.itemResolutions.map((item) => item.draftItemId), "Review each extracted dish exactly once.");
  exactIds((draft.sourceEntries ?? []).map((entry) => entry.id), review.sourceResolutions.map((entry) => entry.sourceEntryId), "Review each source association, including add-ons and repeated labels.");
  exactIds(draft.issues.filter((issue) => issue.blocking).map((issue) => issue.id), review.issueResolutions.map((issue) => issue.issueId), "Resolve each highlighted menu issue before continuing.");
  const dishIds = review.menu.dishes.map((dish) => dish.id);
  const included = review.itemResolutions.flatMap((entry) => entry.dishId ? [entry.dishId] : []);
  exactIds(dishIds, [...included, ...review.manualDishIds], "Each reviewed dish needs exactly one extracted or manual origin.");
  for (const source of review.sourceResolutions) {
    if (new Set(source.dishIds).size !== source.dishIds.length || source.dishIds.some((id) => !dishIds.includes(id))) return reject("A source is paired to an unknown or duplicate dish.");
  }
  for (const item of draft.items) {
    const mapped = review.itemResolutions.find((entry) => entry.draftItemId === item.id)!;
    if (mapped.dishId && item.sourceEntryId) {
      const source = review.sourceResolutions.find((entry) => entry.sourceEntryId === item.sourceEntryId);
      if (!source?.dishIds.includes(mapped.dishId)) return reject("Confirm the source pairing for each included dish.");
    }
  }
  // MenuSchema has already rejected null prices, duplicate IDs and invalid modifier rules.
  return review.menu;
}
