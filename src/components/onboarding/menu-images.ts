import { extractedMenuDraftSchema, type ExtractedMenuDraft, type MenuPhotoRegion } from "@/shared/extraction";

export type UploadedMenu = { id: string; file: File; url: string; draft?: ExtractedMenuDraft };
export type DishCrop = { file: File; url: string; sourceImageId: string; sourceEntryId: string; region: MenuPhotoRegion };

export function mergeExtractions(uploads: UploadedMenu[]): ExtractedMenuDraft {
  if (!uploads.length || uploads.some(upload => !upload.draft)) throw new Error("Read every uploaded menu before continuing.");
  const drafts = uploads.map(upload => upload.draft!);
  if (drafts.reduce((sum, draft) => sum + draft.items.length, 0) > 100) throw new Error("Use menus with up to 100 dishes in total.");
  return extractedMenuDraftSchema.parse({ id: crypto.randomUUID(), status: "needs_review", currency: "SGD", items: drafts.flatMap(d => d.items), sourceEntries: drafts.flatMap(d => d.sourceEntries ?? []), issues: drafts.flatMap(d => d.issues) });
}

export function validCrop(region: MenuPhotoRegion): boolean {
  return [region.x, region.y, region.width, region.height].every(Number.isFinite) && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0 && region.x + region.width <= 1.00001 && region.y + region.height <= 1.00001;
}

/** Bake EXIF orientation into pixels so vision and browser crops share coordinates. */
export async function normalizeMenuPhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare this menu photo.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Could not prepare this menu photo.")), "image/jpeg", 0.95));
    return new File([blob], file.name, { type: "image/jpeg" });
  } finally { bitmap.close(); }
}

/** Crop actual upload pixels; no generated substitute and no remote image fetch. */
export async function cropDish(upload: UploadedMenu, sourceEntryId: string, region: MenuPhotoRegion): Promise<DishCrop> {
  if (!validCrop(region)) throw new Error("Choose a crop inside your menu photo.");
  const bitmap = await createImageBitmap(upload.file, { imageOrientation: "from-image" });
  try {
    const width = Math.max(1, Math.round(bitmap.width * region.width));
    const height = Math.max(1, Math.round(bitmap.height * region.height));
    const scale = Math.min(1, 1024 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare the dish photo.");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, bitmap.width * region.x, bitmap.height * region.y, width, height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The dish photo could not be cropped.")), "image/jpeg", 0.9));
    const file = new File([blob], "dish.jpg", { type: "image/jpeg" });
    return { file, url: URL.createObjectURL(file), sourceImageId: crypto.randomUUID(), sourceEntryId, region };
  } finally { bitmap.close(); }
}
