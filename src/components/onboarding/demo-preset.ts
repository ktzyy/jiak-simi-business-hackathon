import type { ExtractedMenuDraft } from "@/shared/extraction";
import type { DishEdit, GlobalAddonEdit, HourDay } from "./review-state";
import type { DishCrop, UploadedMenu } from "./menu-images";
import type { PhotoRecord } from "./use-dish-photos";
export type DemoPreset = {
  version: 1; restaurantId: string; savedAt: string; name: string; hours: HourDay[]; sameHours: boolean;
  draft: ExtractedMenuDraft; dishes: DishEdit[]; sharedRows: GlobalAddonEdit[]; excludedExtras: string[]; anyExtras: string[];
  uploads: Omit<UploadedMenu, "url">[]; crops: Record<string, Omit<DishCrop, "url">>;
  photos: { records: Record<string, PhotoRecord>; blobs: Record<string, Blob> };
};
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("jiak-demo-presets", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("presets");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Demo storage is unavailable in this browser."));
  });
}
export async function saveDemoPreset(preset: DemoPreset): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("presets", "readwrite"); tx.objectStore("presets").put(preset, preset.restaurantId);
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error("Could not save the demo. Free some browser storage and try again."));
  }); } finally { db.close(); }
}
export async function readDemoPreset(restaurantId: string): Promise<DemoPreset | null> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction("presets").objectStore("presets").get(restaurantId);
    request.onsuccess = () => { const value = request.result; resolve(value?.version === 1 && value.restaurantId === restaurantId ? value : null); };
    request.onerror = () => reject(new Error("Could not load your saved demo."));
  }); } finally { db.close(); }
}

// The curated public demo is versioned with the app. Browser saves never replace it.
type PresetAsset = { path: string; type: string; name: string | null };
export type SharedDemoPreset = Omit<DemoPreset, "uploads" | "crops" | "photos"> & {
  uploads: (Omit<DemoPreset["uploads"][number], "file"> & { file: PresetAsset })[];
  crops: Record<string, Omit<DemoPreset["crops"][string], "file"> & { file: PresetAsset }>;
  photos: { records: DemoPreset["photos"]["records"]; blobs: Record<string, PresetAsset> };
};
export async function readSharedDemoPreset(restaurantId: string): Promise<DemoPreset | null> {
  if (restaurantId !== "ba2ad996-da84-4653-89a9-c028d77c050d") return null;
  const response = await fetch("/demo/shared-v1/preset.json");
  if (!response.ok) throw new Error("The demo could not load. Please try again.");
  const preset: SharedDemoPreset = await response.json();
  if (preset.version !== 1 || preset.restaurantId !== restaurantId || !preset.dishes.length) throw new Error("The demo preset is incomplete.");
  async function asset(value: PresetAsset): Promise<File> {
    if (!/^\/demo\/shared-v1\/[a-z0-9-]+\.jpg$/.test(value.path) || value.type !== "image/jpeg") throw new Error("Invalid demo photo.");
    const response = await fetch(value.path);
    if (!response.ok) throw new Error("A demo photo could not load. Please try again.");
    const blob = await response.blob();
    if (!blob.size) throw new Error("A demo photo is empty.");
    return new File([blob], value.name ?? "demo-photo.jpg", { type: value.type });
  }
  const [uploads, crops, blobs] = await Promise.all([
    Promise.all(preset.uploads.map(async upload => ({ ...upload, file: await asset(upload.file) }))),
    Promise.all(Object.entries(preset.crops).map(async ([id, crop]) => [id, { ...crop, file: await asset(crop.file) }] as const)),
    Promise.all(Object.entries(preset.photos.blobs).map(async ([id, file]) => [id, await asset(file)] as const)),
  ]);
  return { ...preset, uploads, crops: Object.fromEntries(crops), photos: { records: preset.photos.records, blobs: Object.fromEntries(blobs) } };
}
