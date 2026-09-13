"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ApiError, createApiClient } from "@/shared/api-client";
import { MenuSchema, type Menu } from "@/shared/contracts";
import type { StallDetails as SavedStallDetails } from "@/shared/stall-details";
import { detailsInput, editorHours, sameDetailsInput, PendingPublicationSchema, matchesPublication } from "./hours-state";
import { z } from "zod";
import { dishPhotoSelectionSchema, type PublishedDishPhoto } from "@/shared/dish-photo";
import { DishPhotoPanel } from "./dish-photo-panel";
import { useDishPhotos } from "./use-dish-photos";
import type { ExtractedMenuDraft } from "@/shared/extraction";
import { cropDish, normalizeMenuPhoto, mergeExtractions, type UploadedMenu, type DishCrop } from "./menu-images";
import { allHoursMatch } from "./hours-presentation";
import { PageShell } from "@/components/ui/page-shell";
import { getStaffAccessToken } from "@/components/ui/staff-access";
import { CustomerCart } from "@/components/ordering/customer-cart";
import { StallDetails } from "./stall-details";
import { MenuReview } from "./menu-review";
import { DAYS, globalAddonRows, dishProblem, draftDishes, emptyHours, existingDishes, hoursProblem, hoursSummary, newDish, menuFromEdits, type DishEdit, type GlobalAddonEdit } from "./review-state";
import s from "./onboarding.module.css";
import { readDemoPreset, saveDemoPreset, type DemoPreset } from "./demo-preset";
import { splitSharedExtras, withSharedExtras } from "./shared-extras";

const api = createApiClient();
const PendingWithPhotosSchema = PendingPublicationSchema.extend({ photoSelections: z.array(dishPhotoSelectionSchema).max(100).optional() });
type PhotoSelection = z.infer<typeof dishPhotoSelectionSchema>;
function errorText(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Your edits are still here."; }
async function readCurrent(restaurantId: string): Promise<Menu | null> {
  try { const menu = await api.readMenu(restaurantId); if (menu.restaurantId !== restaurantId) throw new Error("The menu does not match this stall. Please open your assigned stall link again."); return menu; }
  catch (error) { if (error instanceof ApiError && error.status === 404 && ["MENU_NOT_FOUND", "UNKNOWN_MENU"].includes(error.code)) return null; throw error; }
}
function sameMenu(a: Menu, b: Menu) { return JSON.stringify(MenuSchema.parse(a)) === JSON.stringify(MenuSchema.parse(b)); }
const needsReconciliation = (error: unknown) => !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || error.code === "INVALID_RESPONSE";

export function Onboarding({ restaurantId, editPublished = false }: { restaurantId: string; editPublished?: boolean }) {
  const dishPhotos = useDishPhotos(restaurantId);
  const [demoUpload, setDemoUpload] = useState(false);
  const [loadedPreset, setLoadedPreset] = useState<DemoPreset | null>(null);
  const [bulkProgress, setBulkProgress] = useState("");
  const bulkStop = useRef(false);
  const bulkRunning = useRef(false);
  useEffect(() => { const stop = (e: KeyboardEvent) => { if (e.key === "Escape") bulkStop.current = true; }; window.addEventListener("keydown", stop); return () => window.removeEventListener("keydown", stop); }, []);
  const [uploads, setUploads] = useState<UploadedMenu[]>([]);
  const uploadRef = useRef<UploadedMenu[]>([]);
  const [crops, setCrops] = useState<Record<string, DishCrop>>({});
  const cropRef = useRef<Record<string, DishCrop>>({});
  const [cropErrors, setCropErrors] = useState<Record<string, string>>({});
  const [retainedPhotos, setRetainedPhotos] = useState<PublishedDishPhoto[]>([]);
  const [pendingPhotoSelections, setPendingPhotoSelections] = useState<PhotoSelection[]>([]);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [hours, setHours] = useState(() => DAYS.map(emptyHours));
  const [sameHours, setSameHours] = useState(true);
  const [savedDetails, setSavedDetails] = useState<SavedStallDetails | null>(null);
  const [previewDetails, setPreviewDetails] = useState<SavedStallDetails | null>(null);
  const [pendingDetails, setPendingDetails] = useState<SavedStallDetails | null>(null);
  const [draft, setDraft] = useState<ExtractedMenuDraft | null>(null);
  const [anyExtras, setAnyExtras] = useState<Set<string>>(() => new Set());
  const [sharedRows, setSharedRows] = useState<GlobalAddonEdit[]>([]);
  const [excludedExtras, setExcludedExtras] = useState<string[]>([]);
  const [dishes, setDishes] = useState<DishEdit[]>([]);
  const [current, setCurrent] = useState<Menu | null>(null);
  const [menuRead, setMenuRead] = useState<"loading" | "ready" | "error">("loading");
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<Menu | null>(null);
  const [published, setPublished] = useState<Menu | null>(null);
  const [pending, setPending] = useState<Menu | null>(null);
  const [conflict, setConflict] = useState(false);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorNode = useRef<HTMLDivElement>(null);
  const pendingKey = `jiak:onboarding:pending-menu:${restaurantId}`;

  useEffect(() => {
    let active = true;
    Promise.all([readCurrent(restaurantId), getStaffAccessToken().then(token => api.readStallDetails(restaurantId, token))]).then(async ([menu, response]) => {
      const photos = editPublished && menu ? await api.readPublishedPhotos(restaurantId, menu.id, menu.version) : [];
      if (!active) return;
      if (editPublished && menu) {
        const shared = splitSharedExtras(existingDishes(menu));
        dishPhotos.reset(); setDraft(null); setDishes(shared.dishes); setSharedRows(shared.rows); setExcludedExtras(shared.excluded); setRetainedPhotos(photos); setStep(2);
      }
      setCurrent(menu); setMenuRead("ready"); setSavedDetails(response.details);
      setName(response.details?.name ?? menu?.name ?? "");
      if (response.details) { setHours(editorHours(response.details)); setSameHours(allHoursMatch(editorHours(response.details))); }
    }).catch(e => {
      if (!active) return;
      setMenuRead("error"); setError(`We couldn’t load the current menu. ${errorText(e)} You can work on your draft, but publication needs this check.`);
    }).finally(() => {
      if (!active) return;
      try {
        const saved = sessionStorage.getItem(pendingKey);
        if (saved) {
          const parsed = PendingWithPhotosSchema.safeParse(JSON.parse(saved));
          if (parsed.success && parsed.data.menu.restaurantId === restaurantId && parsed.data.details.restaurantId === restaurantId) {
            setPendingPhotoSelections(parsed.data.photoSelections ?? []);
            setPending(parsed.data.menu); setPendingDetails(parsed.data.details); setPreview(parsed.data.menu); setPreviewDetails(parsed.data.details); setDishes(existingDishes(parsed.data.menu)); setName(parsed.data.details.name); setHours(editorHours(parsed.data.details)); setSameHours(allHoursMatch(editorHours(parsed.data.details))); setStep(3);
            setNotice("A previous publish needs checking. Keep this page open and check its status before making another version.");
          } else throw new Error("The saved publication record could not be verified.");
        }
      } catch {
        setStorageBlocked(true);
        setError("We can’t safely read a previous publication record from this browser. You can work on a draft, but publishing is paused to protect that earlier attempt. Restore browser storage access and reload to check again; don’t clear the record until the previous publication has been verified.");
      }
    });
    return () => { active = false; };
  }, [restaurantId, pendingKey, editPublished]);

  useEffect(() => () => {
    uploadRef.current.forEach(upload => URL.revokeObjectURL(upload.url));
    Object.values(cropRef.current).forEach(crop => URL.revokeObjectURL(crop.url));
  }, []);
  function saveUploads(next: UploadedMenu[]) { uploadRef.current = next; setUploads(next); }
  function saveCrop(id: string, crop: DishCrop) {
    if (cropRef.current[id]) URL.revokeObjectURL(cropRef.current[id].url);
    cropRef.current = { ...cropRef.current, [id]: crop }; setCrops(cropRef.current);
    dishPhotos.remove(id);
  }


  useEffect(() => { if (error) errorNode.current?.focus(); }, [error]);
  useEffect(() => { heading.current?.focus(); }, [step]);

  function stepOneProblem() {
    if (!name.trim() || name.trim().length > 120) return "Add your stall name before continuing.";
    return hoursProblem(hours, sameHours);
  }
  function mayContinue() {
    const problem = stepOneProblem();
    if (problem) { setError(problem); return false; }
    setError(""); return true;
  }
  function loadDraft(next: ExtractedMenuDraft | null) {
    dishPhotos.reset(); setRetainedPhotos([]);
    let nextDishes = next ? draftDishes(next) : current ? existingDishes(current) : [newDish()];
    const shared = next ? { dishes: nextDishes, rows: globalAddonRows(next, nextDishes), excluded: [] } : splitSharedExtras(nextDishes);
    nextDishes = shared.dishes; setSharedRows(shared.rows); setExcludedExtras(shared.excluded);
    setDraft(next); setDishes(nextDishes); setAnyExtras(new Set()); setPreview(null); setError(""); setNotice(""); setStep(2);
  }
  async function editExisting() {
    if (!current || inFlight.current || !mayContinue()) return;
    inFlight.current = true; setBusy("existing");
    try {
      const photos = await api.readPublishedPhotos(restaurantId, current.id, current.version);
      loadDraft(null); setRetainedPhotos(photos);
    } catch (error) { setError(`Could not load your saved photos. ${errorText(error)}`); }
    finally { inFlight.current = false; setBusy(""); }
  }
  function selectPhotos(files: File[]) {
    if (uploads.length + files.length > 3) { setError("Choose up to 3 menu photos."); return; }
    if (files.some(file => !file.size || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      setError("Use JPEG, PNG or WebP photos, up to 5 MB each."); return;
    }
    setLoadedPreset(null); setDemoUpload(false);
    saveUploads([...uploads, ...files.map(file => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))]); setError("");
  }
  async function loadDemoImage() {
    if (inFlight.current || uploads.length >= 3) return;
    inFlight.current = true; setBusy("demo-image"); setError("");
    try {
      if (!uploads.length) {
        const preset = await readDemoPreset(restaurantId);
        if (preset) {
          saveUploads(preset.uploads.map(upload => ({ ...upload, url: URL.createObjectURL(upload.file) })));
          setName(preset.name); setHours(preset.hours); setSameHours(preset.sameHours); setLoadedPreset(preset); setDemoUpload(true);
          setNotice("Saved demo loaded. Next opens your reviewed menu."); return;
        }
      }
      const response = await fetch("/demo/menu-photo.jpg");
      if (!response.ok) throw new Error("The demo image could not be loaded.");
      selectPhotos([new File([await response.blob()], "Charcoal-Char-Siew-menu.jpg", { type: "image/jpeg" })]); setDemoUpload(true);
    } catch (error) { setError(errorText(error)); }
    finally { inFlight.current = false; setBusy(""); }
  }
  function removeUpload(id: string) {
    setLoadedPreset(null); setDemoUpload(false);
    const upload = uploads.find(upload => upload.id === id);
    if (upload) URL.revokeObjectURL(upload.url);
    saveUploads(uploads.filter(upload => upload.id !== id));
  }
  async function extract() {
    if (inFlight.current || !mayContinue()) return;
    if (!uploads.length) { setError("Upload your menu first."); return; }
    if (loadedPreset) {
      try {
        const preset = loadedPreset;
        dishPhotos.restore(preset.photos);
        Object.values(cropRef.current).forEach(crop => URL.revokeObjectURL(crop.url));
        cropRef.current = Object.fromEntries(Object.entries(preset.crops).map(([id, crop]) => [id, { ...crop, url: URL.createObjectURL(crop.file) }])); setCrops(cropRef.current);
        setDraft(preset.draft); setDishes(preset.dishes); setSharedRows(preset.sharedRows); setExcludedExtras(preset.excludedExtras); setAnyExtras(new Set(preset.anyExtras)); setRetainedPhotos([]); setPreview(null); setStep(2); setError(""); setNotice("Saved demo ready."); setLoadedPreset(null);
      } catch (e) { setError(errorText(e)); }
      return;
    }
    inFlight.current = true; setBusy("extract");
    try {
      const token = await getStaffAccessToken();
      const results = await Promise.allSettled(uploads.map(async upload => { if (upload.draft) return upload; const file = await normalizeMenuPhoto(upload.file); return { ...upload, file, draft: await api.extract(file, restaurantId, token) }; }));
      const nextUploads = results.map((result, index) => result.status === "fulfilled" ? result.value : uploads[index]);
      saveUploads(nextUploads);
      const failed = results.findIndex(result => result.status === "rejected");
      if (failed >= 0) throw new Error(`Menu ${failed + 1}: ${errorText((results[failed] as PromiseRejectedResult).reason)} Retry to read only the remaining photos.`);
      const next = mergeExtractions(nextUploads);
      Object.values(cropRef.current).forEach(crop => URL.revokeObjectURL(crop.url)); cropRef.current = {}; setCrops({}); setCropErrors({});
      loadDraft(next);
      for (const upload of nextUploads) for (const item of upload.draft!.items) {
        const entry = upload.draft!.sourceEntries?.find(entry => entry.id === item.sourceEntryId);
        if (!entry?.photoRegion) continue;
        try { saveCrop(item.id, await cropDish(upload, entry.id, entry.photoRegion)); }
        catch { setCropErrors(old => ({ ...old, [item.id]: "Choose the dish area to add its photo." })); }
      }
    } catch (e) { setError(errorText(e)); }
    finally { inFlight.current = false; setBusy(""); }
  }
  async function polishAll() {
    if (bulkRunning.current) { bulkStop.current = true; for (const id of Object.keys(dishPhotos.busy)) dishPhotos.cancel(id); return; }
    bulkRunning.current = true; bulkStop.current = false;
    const candidates = dishes.filter(dish => dish.included && crops[dish.id] && dish.name.trim());
    let completed = 0;
    try {
      for (const dish of candidates) {
        if (bulkStop.current) break;
        setBulkProgress(`Polishing ${completed + 1} of ${candidates.length}…`);
        const record = dishPhotos.latestRecords()[dish.id];
        if (!(record?.selected && record.status === "ready" && record.request.mode === "enhance_visible" && record.request.dishName === dish.name)) {
          const crop = crops[dish.id];
          await dishPhotos.generate({ mode: "enhance_visible", dishId: dish.id, dishName: dish.name, sourceImageId: crop.sourceImageId, sourceEntryId: crop.sourceEntryId, merchantConfirmedVisible: true }, crop.file);
        }
        completed++;
      }
      const ready = candidates.filter(dish => { const record = dishPhotos.latestRecords()[dish.id]; return record?.status === "ready" && record.request.mode === "enhance_visible" && record.request.dishName === dish.name; }).length;
      setNotice(`${ready} of ${candidates.length} polished photos ready.${bulkStop.current ? " Stopped." : ready < candidates.length ? " Check the remaining dish rows." : " Save your demo preset when ready."}`);
    } finally { bulkRunning.current = false; setBulkProgress(""); }
  }
  async function savePreset() {
    if (!draft || !demoUpload || bulkRunning.current || Object.values(dishPhotos.busy).some(Boolean)) return;
    const problem = dishes.map(dish => dishProblem(dish)).find(Boolean);
    if (problem) { setError(`Check the menu before saving: ${problem}`); return; }
    setBusy("save-demo"); setError("");
    try {
      withSharedExtras(dishes, sharedRows, excludedExtras, crypto.randomUUID());
      const preset: DemoPreset = { version: 1, restaurantId, savedAt: new Date().toISOString(), name, hours, sameHours, draft, dishes, sharedRows, excludedExtras, anyExtras: [...anyExtras], uploads: uploads.map(({ url, ...upload }) => upload), crops: Object.fromEntries(Object.entries(crops).map(([id, { url, ...crop }]) => [id, crop])), photos: await dishPhotos.snapshot() };
      await saveDemoPreset(preset); setNotice("Demo saved in this browser, including crops and polished photos. Upload Demo Image will reuse it next time.");
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(""); }
  }
  function changeDish(id: string, patch: Partial<DishEdit>) {
    if (patch.name !== undefined || patch.included === false) { dishPhotos.remove(id); setRetainedPhotos(old => old.filter(photo => photo.dishId !== id)); }
    setDishes(old => old.map(d => d.id === id ? { ...d, ...patch, confirmed: false } : d));
    setPreview(null); setError("");
  }
  function confirmDishes(ids: string[]) {
    for (const dish of dishes.filter(d => ids.includes(d.id) && d.included)) {
      const problem = dishProblem(dish); if (problem) { setError(`${dish.name || "New dish"}: ${problem}`); return false; }
    }
    setError(""); return true;
  }
  function removeDish(id: string) {
    dishPhotos.remove(id); setDishes(old => old.filter(d => d.id !== id)); setExcludedExtras(old => old.filter(excluded => excluded !== id)); setPreview(null);
  }
  async function reloadDetails() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy("details"); setError("");
    try { const response = await api.readStallDetails(restaurantId, await getStaffAccessToken()); setSavedDetails(response.details); setName(response.details?.name ?? current?.name ?? ""); setHours(response.details ? editorHours(response.details) : DAYS.map(emptyHours)); setSameHours(response.details ? allHoursMatch(editorHours(response.details)) : true); setPreview(null); setPreviewDetails(null); setNotice("Saved name and hours loaded. Review them before preparing a new preview."); }
    catch (e) { setError(errorText(e)); } finally { inFlight.current = false; setBusy(""); }
  }
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy("refresh"); setError("");
    try { setCurrent(await readCurrent(restaurantId)); setMenuRead("ready"); setNotice("Current menu checked. Your draft edits are still here."); }
    catch (e) { setMenuRead("error"); setError(errorText(e)); }
    finally { inFlight.current = false; setBusy(""); }
  }
  async function preparePreview(candidateDishes = dishes) {
    if (inFlight.current) return;
    const problem = stepOneProblem();
    if (problem) { setStep(1); setError(problem); return; }
    inFlight.current = true; setBusy("preview"); setError("");
    try {
      const fresh = await readCurrent(restaurantId); setCurrent(fresh); setMenuRead("ready");
      const menuInput = { dishes: candidateDishes, id: fresh?.id ?? crypto.randomUUID(), restaurantId, version: (fresh?.version ?? 0) + 1, name };
      const menu = menuFromEdits(menuInput);
      const input = detailsInput(name, hours, sameHours);
      const token = await getStaffAccessToken();
      let details = savedDetails;
      if (!details || !sameDetailsInput(input, details)) {
        details = (await api.saveStallDetails(restaurantId, { ...input, expectedVersion: details?.version ?? 0 }, token)).details;
        setSavedDetails(details);
      }
      setPreviewDetails(details); setPreview(menu);  setNotice(""); setStep(3);
    } catch (e) { setError(errorText(e)); }
    finally { inFlight.current = false; setBusy(""); }
  }
  function chosenPhotos(menu: Menu): PhotoSelection[] {
    return menu.dishes.flatMap(dish => {
      const record = dishPhotos.latestRecords()[dish.id];
      const retained = retainedPhotos.find(photo => photo.dishId === dish.id && photo.dishName === dish.name);
      return record?.selected && record.jobId && record.status === "ready" && record.request.dishName === dish.name ? [{ dishId: dish.id, jobId: record.jobId }] : retained ? [{ dishId: dish.id, jobId: retained.jobId }] : [];
    });
  }
  function remember(candidate: Menu, details: SavedStallDetails, photoSelections: PhotoSelection[]) {
    try {
      const prior = sessionStorage.getItem(pendingKey);
      if (prior) {
        const parsed = PendingWithPhotosSchema.safeParse(JSON.parse(prior));
        if (!parsed.success || !matchesPublication(parsed.data, { menu: candidate, details }) || JSON.stringify(parsed.data.photoSelections ?? []) !== JSON.stringify(photoSelections)) {
          setStorageBlocked(true);
          throw new Error("A different publication record needs checking first.");
        }
      }
      sessionStorage.setItem(pendingKey, JSON.stringify({ menu: candidate, details, photoSelections }));
    }
    catch { throw new Error("Your browser couldn’t keep a record of this publish attempt. Free up browser storage, then try again. Nothing was sent."); }
    setPending(candidate); setPendingDetails(details); setPendingPhotoSelections(photoSelections);
  }
  function finish(menu: Menu) {
    setCurrent(menu); setPublished(menu); setPendingPhotoSelections([]); setPending(null); setPendingDetails(null); setConflict(false); setNotice(""); setError("");
    try { sessionStorage.removeItem(pendingKey); } catch { /* Reconciliation can safely repeat on a stale saved candidate. */ }
  }
  async function checkCandidate(candidate: Menu, details: SavedStallDetails) {
    const published = await api.readPublishedStall(restaurantId);
    const latest = published.menu; setCurrent(latest); setMenuRead("ready");
    if (matchesPublication({ menu: candidate, details }, published)) {
      const expected = pendingPhotoSelections.length ? pendingPhotoSelections : chosenPhotos(candidate);
      if (expected.length) {
        const actual = await api.readPublishedPhotos(restaurantId, candidate.id, candidate.version);
        if (expected.length !== actual.length || expected.some(selection => !actual.some(photo => photo.dishId === selection.dishId && photo.jobId === selection.jobId))) throw new Error("Menu is visible, but its exact photo selection has not been confirmed. Keep the saved publication record.");
      }
      finish(latest); return "published";
    }
    if (latest && (latest.id !== candidate.id || latest.version >= candidate.version)) {
      setConflict(true); setNotice("The live menu has changed and doesn’t match this draft. Review again before publishing a new version."); return "conflict";
    }
    setNotice("This version is not visible yet. You can check again, or retry this exact publish. We’ll keep the same version so it cannot create a duplicate publication.");
    return "waiting";
  }
  async function reconcile() {
    if (!pending || !pendingDetails || inFlight.current) return;
    inFlight.current = true; setBusy("reconcile"); setError("");
    try { await checkCandidate(pending, pendingDetails); }
    catch (e) { setError(`Publish status is still unknown. ${errorText(e)} Keep this page open and check again.`); }
    finally { inFlight.current = false; setBusy(""); }
  }
  async function publish(retry = false) {
    const candidate = retry ? pending : preview;
    const details = retry ? pendingDetails : previewDetails;
    if (!details || !candidate || candidate.restaurantId !== restaurantId || inFlight.current || conflict || storageBlocked) return;
    inFlight.current = true; setBusy("publish"); setError(""); setNotice("");
    let sent = false;
    try {
      const latest = await readCurrent(restaurantId); setCurrent(latest); setMenuRead("ready");
      if (latest && sameMenu(latest, candidate)) { await checkCandidate(candidate, details); return; }
      if ((latest?.version ?? 0) + 1 !== candidate.version || (latest && latest.id !== candidate.id)) {
        if (retry) { setConflict(true); setNotice("The live menu changed while this publication was being checked. Review the draft again before publishing."); }
        else { setPreview(null); setStep(2); setError("The live menu changed since your preview. Check your draft and open a fresh preview before publishing."); }
        return;
      }
      const token = await getStaffAccessToken();
      const currentDetails = (await api.readStallDetails(restaurantId, token)).details;
      if (!currentDetails || JSON.stringify(currentDetails) !== JSON.stringify(details)) { if (retry) setConflict(true); throw new Error("Saved stall details changed. Reload the name and hours and prepare a fresh preview before publishing."); }
      if (!retry) {
        for (const dish of candidate.dishes) {
          const record = dishPhotos.latestRecords()[dish.id];
          if (record?.selected && record.status === "ready" && record.request.dishName === dish.name) continue;
          const crop = crops[dish.id];
          if (!crop) continue;
          await dishPhotos.generate({ mode: "source_crop", dishId: dish.id, dishName: dish.name, sourceImageId: crop.sourceImageId, sourceEntryId: crop.sourceEntryId }, crop.file);
          const saved = dishPhotos.latestRecords()[dish.id];
          if (!saved?.selected || saved.status !== "ready") throw new Error(`The photo for ${dish.name} was not saved. Check its status in review before publishing.`);
        }
      }
      const selections = retry ? pendingPhotoSelections : chosenPhotos(candidate);
      remember(candidate, details, selections); sent = true;
      let result: Menu;
      if (selections.length) {
        const publication = await api.publishMenuWithPhotos(candidate, token, details.version, selections);
        if (publication.photos.length !== selections.length || selections.some(selection => !publication.photos.some(photo => photo.dishId === selection.dishId && photo.jobId === selection.jobId))) throw new ApiError("INVALID_RESPONSE", "The published photo selection does not match this preview.", 200, false);
        result = publication.menu;
      } else result = await api.publishMenu(candidate, token, details.version);
      if (!sameMenu(candidate, result)) throw new ApiError("INVALID_RESPONSE", "The published result does not match this draft.", 200, false);
      finish(result);
    } catch (e) {
      if (sent && (needsReconciliation(e) || e instanceof ApiError && e.code === "STALE_MENU")) {
        setError("We haven’t confirmed whether your menu was published. Checking the live menu now…");
        try { const result = await checkCandidate(candidate, details); if (result !== "published") setError("Publication isn’t confirmed. Keep this page open and use the status check below."); }
        catch { setError("Publication status is unknown. Keep this page open and check again. Your exact menu version has been kept for a safe retry."); }
      } else {
        if (sent && !retry) { setPending(null); try { sessionStorage.removeItem(pendingKey); } catch { /* No live publication was acknowledged. */ } }
        setError(retry ? `We couldn’t retry this publication. Its earlier result still needs checking. ${errorText(e)}` : `Menu not published. ${errorText(e)}`);
      }
    } finally { inFlight.current = false; setBusy(""); }
  }
  function returnAfterConflict() {
    try { sessionStorage.removeItem(pendingKey); } catch { setError("Your browser couldn’t clear the old publish record. Try again before making a new version."); return; }
    setPendingPhotoSelections([]); setPending(null); setPreview(null); setConflict(false);  setStep(2); setError(""); setNotice("The current live version has been checked. Reconfirm your draft and preview before publishing.");
    setDishes(old => old.map(d => ({ ...d, confirmed: false })));
  }

  return <PageShell restaurantId={restaurantId} active="onboarding">
    <div className={s.onboarding}>
      <header className={s.header}><h1 ref={heading} tabIndex={-1}>{published ? "Menu published" : ["Set up your stall", "Review menu", "Preview"][step - 1]}</h1></header>
      <ol className={s.steps} aria-label="Setup progress">{["Stall details", "Review menu", "Preview & publish"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={step >= index + 1 ? s.activeStep : ""}><span>{step > index + 1 ? "✓" : index + 1}</span>{label}</li>)}</ol>
      {error && <div className={`notice ${s.error}`} role="alert" ref={errorNode} tabIndex={-1}><strong>Let’s check that</strong><p>{error}</p>{menuRead === "error" && <button className="btn btn-outline" onClick={refresh} disabled={!!busy}>Check menu connection again</button>}{/sign in|unauthoriz|access denied/i.test(error) && <Link href="/login" className={s.signIn}>Staff sign in</Link>}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {storageBlocked && <p className="notice" role="status">Publishing is paused while the previous browser record needs checking. You can continue editing, but don’t clear that record or start another publication.</p>}
      {busy === "extract" && <div className={s.extracting} role="status"><div className={s.foodAnimation} aria-hidden="true">{["kopi"].map(name => <Image key={name} src={`/illustrations/${name}.svg`} alt="" width={110} height={110} unoptimized />)}</div><h2>Reading your menu…</h2><p>Usually 30–60 seconds. Grab a drink; keep this page open.</p></div>}
      {busy && busy !== "extract" && <p className={s.busy} role="status" aria-live="polite">{busy === "save-demo" ? "Saving demo preset…" : busy === "demo-image" ? "Adding demo image…" : busy === "publish" ? "Checking the latest menu and publishing…" : busy === "preview" ? "Checking your review and the latest menu…" : "Checking the live menu…"}</p>}
      {menuRead === "loading" && <p role="status">Checking your current menu…</p>}
      {published ? <section className={`card ${s.success}`}><span className={s.successMark} aria-hidden="true">✓</span><h2>All set. Share your menu.</h2><p><strong>{published.name}</strong> · {published.dishes.length} dishes</p><p>Your menu is live.</p><div className={s.actions}><Link href={`/storefront?restaurantId=${restaurantId}`} className="btn btn-primary">Get my menu link & QR →</Link><Link href={`/order/${restaurantId}`} className="btn btn-outline">Open customer menu</Link></div></section> : <fieldset className={s.work} disabled={!!busy || menuRead === "loading"}>
        {step === 1 && <StallDetails onReloadDetails={reloadDetails} name={name} setName={setName} hours={hours} setHours={setHours} sameHours={sameHours} setSameHours={setSameHours} uploads={uploads} onPhotos={selectPhotos} onRemovePhoto={removeUpload} busy={!!busy} onExtract={extract} onDemoImage={loadDemoImage} onExisting={() => void editExisting()} existingAvailable={!!current} />}
        {step === 2 && <div className={s.demoToolbar}><button type="button" className="btn btn-outline" disabled={!Object.keys(crops).length} onClick={() => void polishAll()}>{bulkProgress ? "Stop polishing" : "Polish all images"}</button>{demoUpload && <button type="button" className="btn btn-teal" disabled={!!bulkProgress || Object.values(dishPhotos.busy).some(Boolean)} onClick={() => void savePreset()}>Save as demo preset</button>}{bulkProgress && <span role="status">{bulkProgress}</span>}</div>}
        {step === 2 && <fieldset className={s.work} disabled={!!bulkProgress}><MenuReview manageAvailability={draft === null && current !== null} sharedRows={sharedRows} setSharedRows={setSharedRows} excludedExtras={excludedExtras} setExcludedExtras={setExcludedExtras} anyExtras={anyExtras} onAnyExtrasChange={(id, enabled) => setAnyExtras(old => { const next = new Set(old); if (enabled) next.add(id); else next.delete(id); return next; })} dishes={dishes} draft={draft} uploads={draft ? uploads : []} renderDishPhoto={(dish, addonsAction) => {
          const item = draft?.items.find(item => item.id === dish.draftItemId);
          const upload = uploads.find(upload => upload.draft?.items.some(item => item.id === dish.draftItemId));
          const crop = crops[dish.id];
          const record = dishPhotos.records[dish.id]; const previewUrl = dishPhotos.previews[dish.id];
          const retained = retainedPhotos.find(photo => photo.dishId === dish.id && photo.dishName === dish.name);
          return <DishPhotoPanel addonsAction={addonsAction} onCancel={() => dishPhotos.cancel(dish.id)} savedPhoto={retained} dishId={dish.id} dishName={dish.name} crop={crop} upload={upload} sourceEntryId={item?.sourceEntryId} currentCandidate={record?.candidate && previewUrl && record.request.dishName === dish.name && record.request.mode !== "source_crop" ? { candidate: record.candidate, previewUrl } : null} selected={record?.selected} busy={dishPhotos.busy[dish.id]} error={cropErrors[dish.id] || dishPhotos.errors[dish.id] || dishPhotos.storageError} onCrop={region => {
            if (!upload || !item?.sourceEntryId) return;
            void cropDish(upload, item.sourceEntryId, region).then(crop => { saveCrop(dish.id, crop); setCropErrors(old => ({ ...old, [dish.id]: "" })); }).catch(() => setCropErrors(old => ({ ...old, [dish.id]: "Could not crop this photo. Try again." })));
          }} onGenerate={mode => {
            if (mode === "enhance_visible" && crop) void dishPhotos.generate({ mode, dishId: dish.id, dishName: dish.name, sourceImageId: crop.sourceImageId, sourceEntryId: crop.sourceEntryId, merchantConfirmedVisible: true }, crop.file);
            else if (mode === "generate_similar") void dishPhotos.generate({ mode, dishId: dish.id, dishName: dish.name });
          }} onSelect={() => dishPhotos.select(dish.id)} onRemove={() => dishPhotos.remove(dish.id)} onCheck={record?.status === "dispatch_unknown" ? () => void dishPhotos.check(dish.id) : undefined} />;
        }} onDishChange={changeDish} onConfirmDish={id => confirmDishes([id])} onAddDish={() => { const dish = newDish(); setDishes(old => [...old, dish]); return dish.id; }} onRemoveDish={removeDish} onContinue={preparePreview} onBack={() => { setStep(1); setError(""); }} /></fieldset>}
        {step === 3 && preview && <div className={s.stack}>
          <div className={s.previewIntro}><p>Try an order. Nothing is sent.</p></div>
          <div className={s.phone}><div className={s.phoneTop} aria-hidden="true"><span>9:41</span><span className={s.island} /><span>● ▰</span></div><div className={s.phoneScreen}><CustomerCart key={JSON.stringify(preview)} restaurantId={restaurantId} previewMenu={preview} previewPhotos={preview.dishes.flatMap(dish => {
            const record = dishPhotos.records[dish.id]; const previewUrl = dishPhotos.previews[dish.id];
            const retained = retainedPhotos.find(photo => photo.dishId === dish.id && photo.dishName === dish.name);
            return record?.selected && record.candidate && previewUrl && record.request.dishName === dish.name ? [{ dishId: dish.id, dishName: dish.name, imageUrl: previewUrl, label: record.candidate.label }] : crops[dish.id] ? [{ dishId: dish.id, dishName: dish.name, imageUrl: crops[dish.id].url, label: "Original photo" as const }] : retained ? [{ dishId: dish.id, dishName: dish.name, imageUrl: retained.imageUrl, label: retained.candidate.label }] : [];
          })} previewHours={hoursProblem(hours, sameHours) ? undefined : hoursSummary(hours, sameHours)} /></div><div className={s.phoneBottom} aria-hidden="true" /></div>
          <section className={`card ${s.section}`}>
            {pending ? <><h2>Check publication</h2><p>Keep this page open until publication is confirmed.</p><div className={s.actions}><button className="btn btn-teal" onClick={reconcile}>Check status</button>{conflict ? <button className="btn btn-outline" onClick={returnAfterConflict}>Return to review</button> : <button className="btn btn-outline" disabled={storageBlocked} onClick={() => publish(true)}>Retry publish</button>}</div></> : <>
              <p>{preview.dishes.filter(d => d.available).length} dishes · Name, hours and selected photos will go live.</p>
              <div className={s.actions}><button className="btn btn-outline" onClick={() => { setStep(2); setPreview(null); }}>← Edit</button><button className="btn btn-primary" disabled={storageBlocked || Object.values(dishPhotos.busy).some(Boolean)} onClick={() => publish()}>Publish →</button></div>
            </>}
          </section>
        </div>}
      </fieldset>}
      {!published && <p className={s.draftNote}>Keep this page open to save your draft.</p>}
    </div>
  </PageShell>;
}
