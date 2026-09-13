import { type DraftMetadataImport, type DraftPhotoState, type DraftStallDetails, DraftPhotoJobSchema } from "./ui-additions";

// Synthetic review data only. No approved real merchant, source photo, or URL.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const draftPhotoFixture: DraftPhotoState = {
  source: { restaurantId: uuid(2), dishId: uuid(3), sourceVersion: 1, originalUploadAssetId: uuid(20), normalizedAssetId: uuid(21), dishCropAssetId: uuid(22),
    crop: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, provenance: "menu_board_crop", pairing: "verified", quality: "usable" },
  candidate: { assetId: uuid(23), candidateVersion: 1, sourceVersion: 1 },
  approval: { restaurantId: uuid(2), dishId: uuid(3), sourceVersion: 1, candidateVersion: 1, selected: "candidate", assetId: uuid(23), approvedBy: uuid(24), approvedAt: "2026-09-13T03:00:00.000Z" },
};
export const draftPhotoJobFixtures = {
  unknown: DraftPhotoJobSchema.parse({ jobId: uuid(30), restaurantId: uuid(2), dishId: uuid(3), sourceVersion: 1, idempotencyKey: uuid(31), status: "dispatch_unknown", candidate: null, errorCode: "ACKNOWLEDGEMENT_UNKNOWN" }),
  notSent: DraftPhotoJobSchema.parse({ jobId: uuid(30), restaurantId: uuid(2), dishId: uuid(3), sourceVersion: 1, idempotencyKey: uuid(31), status: "not_dispatched", candidate: null, errorCode: "NOT_SENT" }),
};
export const draftStallFixture: DraftStallDetails = {
  restaurantId: uuid(2), name: "Synthetic test stall", address: null,
  contact: { country: "SG", e164: "+6581234567", publish: false }, timezone: "Asia/Singapore",
  weeklyHours: Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, intervals: null })),
  dateOverrides: [], existingPageUrl: null,
};
const importBase = { requestId: uuid(40), restaurantId: uuid(2), sourceUrl: "https://example.invalid/stall", reviewed: false as const };
const nameProposal = { field: "name" as const, proposedText: "Synthetic imported stall", existingManualText: null, sourceUrl: importBase.sourceUrl };
export const draftMetadataImportFixtures: Record<string, DraftMetadataImport> = {
  success: { ...importBase, status: "success", proposals: [nameProposal, ...(["address", "contact", "hours"] as const).map((field) => ({ ...nameProposal, field, proposedText: `Synthetic ${field} for review` }))], unresolvedFields: [] },
  partial: { ...importBase, status: "partial", proposals: [nameProposal], unresolvedFields: ["address", "contact", "hours"] },
  conflict: { ...importBase, status: "conflicting_fields", proposals: [{ ...nameProposal, existingManualText: "Merchant-entered stall name" }], unresolvedFields: ["name", "address", "contact", "hours"] },
  unsupported: { ...importBase, status: "unsupported_link", proposals: [], unresolvedFields: ["name", "address", "contact", "hours"] },
  unavailable: { ...importBase, status: "unavailable_page", proposals: [], unresolvedFields: ["name", "address", "contact", "hours"] },
  validation: { ...importBase, status: "validation_error", proposals: [], unresolvedFields: ["name", "address", "contact", "hours"] },
  notSent: { ...importBase, status: "not_sent", proposals: [], unresolvedFields: ["name", "address", "contact", "hours"] },
};
