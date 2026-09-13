import { z } from "zod";

// REVIEW PROPOSAL ONLY. Not imported by the current API, UI, or publication path.
const id = z.uuid();
const version = z.number().int().positive();
const timestamp = z.iso.datetime();
const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", "Use an HTTPS URL.");
export const DraftCropSchema = z.strictObject({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1),
}).refine((crop) => crop.x + crop.width <= 1 && crop.y + crop.height <= 1, "Crop must fit the oriented image.");
export const DraftPhotoSourceSchema = z.strictObject({
  restaurantId: id, dishId: id, sourceVersion: version,
  originalUploadAssetId: id, normalizedAssetId: id, dishCropAssetId: id,
  crop: DraftCropSchema,
  provenance: z.enum(["menu_board_crop", "merchant_dish_upload"]),
  pairing: z.enum(["needs_review", "verified", "rejected"]),
  quality: z.enum(["needs_review", "usable", "fresh_photo_required"]),
});
const candidateSchema = z.strictObject({ assetId: id, candidateVersion: version, sourceVersion: version });
export const DraftPhotoJobSchema = z.strictObject({
  jobId: id, restaurantId: id, dishId: id, sourceVersion: version, idempotencyKey: id,
  status: z.enum(["not_dispatched", "queued", "running", "dispatch_unknown", "succeeded", "failed"]),
  candidate: candidateSchema.nullable(),
  errorCode: z.enum(["SOURCE_TOO_SMALL", "SOURCE_UNUSABLE", "RATE_LIMITED", "PROVIDER_FAILED", "NOT_SENT", "ACKNOWLEDGEMENT_UNKNOWN"]).nullable(),
}).superRefine((job, ctx) => {
  if ((job.status === "succeeded") !== (job.candidate !== null)) ctx.addIssue({ code: "custom", message: "Only successful jobs have a candidate." });
  if (job.candidate && job.candidate.sourceVersion !== job.sourceVersion) ctx.addIssue({ code: "custom", message: "Candidate must match its job source version." });
});
export const DraftPhotoApprovalSchema = z.strictObject({
  restaurantId: id, dishId: id, sourceVersion: version,
  // Even choosing original is invalidated by regeneration, requiring a fresh choice.
  candidateVersion: version.nullable(), selected: z.enum(["original", "candidate"]),
  assetId: id, approvedBy: id, approvedAt: timestamp,
});
export const DraftPhotoStateSchema = z.strictObject({
  source: DraftPhotoSourceSchema, candidate: candidateSchema.nullable(), approval: DraftPhotoApprovalSchema.nullable(),
});
export type DraftPhotoState = z.infer<typeof DraftPhotoStateSchema>;

// Server must additionally establish membership and resolve asset ownership. This
// pure projection never supplies URLs or the whole uploaded menu board.
export function draftApprovedPhotoProjection(input: unknown): Readonly<{
  restaurantId: string; dishId: string; assetId: string; sourceVersion: number; candidateVersion: number | null;
}> | null {
  const { source, candidate, approval } = DraftPhotoStateSchema.parse(input);
  if (!approval || source.pairing !== "verified" || source.quality !== "usable") return null;
  if (approval.restaurantId !== source.restaurantId || approval.dishId !== source.dishId || approval.sourceVersion !== source.sourceVersion) return null;
  if (candidate && candidate.sourceVersion !== source.sourceVersion) return null;
  if (approval.candidateVersion !== (candidate?.candidateVersion ?? null)) return null;
  const selectedAssetId = approval.selected === "original" ? source.dishCropAssetId : candidate?.assetId;
  if (!selectedAssetId || selectedAssetId !== approval.assetId) return null;
  return Object.freeze({ restaurantId: source.restaurantId, dishId: source.dishId, assetId: selectedAssetId, sourceVersion: source.sourceVersion, candidateVersion: candidate?.candidateVersion ?? null });
}

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const interval = z.strictObject({ opens: clockTime, closes: clockTime, closesNextDay: z.boolean() })
  .refine((value) => value.closesNextDay || value.closes > value.opens, "Use next-day closing for overnight hours.");
const hours = z.array(interval).max(4);
export const DraftStallDetailsSchema = z.strictObject({
  restaurantId: id, name: z.string().trim().min(1).max(120),
  address: z.strictObject({ line: z.string().trim().min(1).max(240), unit: z.string().trim().max(50).nullable(), postalCode: z.string().trim().max(20).nullable(), country: z.literal("SG") }).nullable(),
  contact: z.strictObject({ country: z.literal("SG"), e164: z.string().regex(/^\+65[689]\d{7}$/), publish: z.boolean().default(false) }).nullable(),
  timezone: z.literal("Asia/Singapore"),
  // null means unknown; [] means closed. ISO weekday: Monday = 1.
  weeklyHours: z.array(z.strictObject({ weekday: z.number().int().min(1).max(7), intervals: hours.nullable() })).length(7),
  dateOverrides: z.array(z.strictObject({ date: z.iso.date(), intervals: hours.nullable() })).max(100),
  existingPageUrl: httpsUrl.nullable(),
}).superRefine((details, ctx) => {
  if (new Set(details.weeklyHours.map((day) => day.weekday)).size !== 7) ctx.addIssue({ code: "custom", message: "Each weekday must appear once." });
  if (new Set(details.dateOverrides.map((day) => day.date)).size !== details.dateOverrides.length) ctx.addIssue({ code: "custom", message: "Use one override per date." });
});
export type DraftStallDetails = z.infer<typeof DraftStallDetailsSchema>;
export function draftPublicStallProjection(input: unknown) {
  const details = DraftStallDetailsSchema.parse(input);
  return { name: details.name, address: details.address, contactNumber: details.contact?.publish === true ? details.contact.e164 : null,
    timezone: details.timezone, weeklyHours: details.weeklyHours, dateOverrides: details.dateOverrides };
}
const importField = z.enum(["name", "address", "contact", "hours"]);
export const DraftMetadataImportSchema = z.strictObject({
  requestId: id, restaurantId: id, sourceUrl: httpsUrl,
  status: z.enum(["success", "partial", "conflicting_fields", "unsupported_link", "unavailable_page", "validation_error", "not_sent"]),
  // Untrusted source strings are deliberately not persisted stall-detail objects.
  proposals: z.array(z.strictObject({ field: importField, proposedText: z.string().min(1).max(1000), existingManualText: z.string().max(1000).nullable(), sourceUrl: httpsUrl })).max(4),
  unresolvedFields: z.array(importField).max(4),
  reviewed: z.literal(false),
});
export type DraftMetadataImport = z.infer<typeof DraftMetadataImportSchema>;
