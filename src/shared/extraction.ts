import { z } from "zod";

const name = z.string().trim().min(1).max(200).nullable();
const cents = z.number().int().min(0).max(1_000_000).nullable();
const rawPriceText = z.string().max(200).nullable();
const optionSchema = z.strictObject({ name, priceDeltaCents: cents, rawPriceText: rawPriceText.optional() });
const groupSchema = z.strictObject({
  name,
  required: z.boolean().nullable(),
  minSelections: z.number().int().min(0).max(50).nullable(),
  maxSelections: z.number().int().min(0).max(50).nullable(),
  options: z.array(optionSchema).max(50),
});
const itemSchema = z.strictObject({
  name,
  category: name,
  description: z.string().max(2000).nullable(),
  priceCents: cents,
  rawPriceText: rawPriceText.optional(),
  sourceEntryId: z.string().uuid().optional(),
  modifierGroups: z.array(groupSchema).max(20),
});

const sourceEntrySchema = z.strictObject({
  kind: z.enum(["item", "addon", "fee", "category"]),
  name,
  category: name,
  description: z.string().max(2000).nullable(),
  itemNumber: z.string().max(40).nullable(),
  menuLabel: name,
  region: z.string().min(1).max(300).describe("Location of this entry within the supplied image, such as top row, second dish from left. This is an image region, never a country or geographic location. It is not a verified crop rectangle."),
  rawPriceText,
  currency: z.enum(["SGD", "other", "unknown"]),
  priceUncertain: z.boolean(),
  uncertainty: z.string().max(1000).nullable(),
});

/** Model only transcribes evidence. Prices, IDs, dish filtering, and review status are server-owned. */
export const modelMenuExtractionSchema = z.strictObject({
  entries: z.array(sourceEntrySchema).max(250),
  issues: z.array(z.strictObject({
    message: z.string().trim().min(1).max(1000),
    entryIndex: z.number().int().min(0).max(249).nullable(),
  })).max(250),
});

export const extractedMenuDraftSchema = z.strictObject({
  id: z.string().uuid(),
  status: z.literal("needs_review"),
  currency: z.literal("SGD"),
  items: z.array(itemSchema.extend({
    id: z.string().uuid(),
    modifierGroups: z.array(groupSchema.extend({
      id: z.string().uuid(),
      options: z.array(optionSchema.extend({ id: z.string().uuid() })),
    })),
  })),
  // Optional for compatibility with drafts created before evidence capture was introduced.
  sourceEntries: z.array(sourceEntrySchema.extend({ id: z.string().uuid(), priceCents: cents })).max(250).optional(),
  issues: z.array(z.strictObject({
    id: z.string().uuid(),
    code: z.enum(["human_review_required", "model_uncertainty", "missing_name", "unknown_price", "modifier_rules", "empty_menu", "source_mapping_required"]),
    message: z.string(),
    itemId: z.string().uuid().nullable(),
    blocking: z.boolean(),
  })),
});

export type ExtractedMenuDraft = z.infer<typeof extractedMenuDraftSchema>;
export type ModelMenuExtraction = z.infer<typeof modelMenuExtractionSchema>;
