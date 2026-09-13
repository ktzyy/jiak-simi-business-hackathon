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
