"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ApiError, createApiClient } from "@/shared/api-client";
import { dishPhotoCandidateSchema, dishPhotoRequestSchema, type DishPhotoRequest, type DishPhotoJob } from "@/shared/dish-photo";
import { getStaffAccessToken } from "@/components/ui/staff-access";

const recordSchema = z.strictObject({ key: z.uuid(), request: dishPhotoRequestSchema, jobId: z.uuid().optional(), status: z.enum(["dispatch_unknown", "ready", "failed"]), selected: z.boolean(), cancelled: z.boolean().optional(), candidate: dishPhotoCandidateSchema.optional() });
type PhotoRecord = z.infer<typeof recordSchema>;
const recordsSchema = z.record(z.string(), recordSchema);
const api = createApiClient();

export function useDishPhotos(restaurantId: string) {
  const storageKey = `jiak:dish-photos:${restaurantId}`;
  const [records, setRecords] = useState<Record<string, PhotoRecord>>({});
  const recordsRef = useRef(records);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const urls = useRef<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [storageError, setStorageError] = useState("");
  const inFlight = useRef(new Set<string>());
  const generation = useRef(0);
  const controllers = useRef(new Map<string, AbortController>());

  function commit(next: Record<string, PhotoRecord>) {
    sessionStorage.setItem(storageKey, JSON.stringify(next));
    recordsRef.current = next; setRecords(next);
  }
  function update(id: string, record: PhotoRecord) { commit({ ...recordsRef.current, [id]: record }); }
  function savePreview(id: string, blob: Blob) {
    if (urls.current[id]) URL.revokeObjectURL(urls.current[id]);
    urls.current[id] = URL.createObjectURL(blob); setPreviews({ ...urls.current });
  }
  async function accept(id: string, record: PhotoRecord, job: DishPhotoJob, token: string, epoch: number) {
    if (epoch !== generation.current || recordsRef.current[id]?.key !== record.key) return;
    if (job.candidate && (job.candidate.dishId !== record.request.dishId || job.candidate.mode !== record.request.mode)) throw new Error("The returned photo does not match this dish.");
    const next = { ...record, selected: record.cancelled ? false : job.status === "ready" && record.status !== "ready" ? true : record.selected, jobId: job.jobId, status: job.status, candidate: job.candidate ?? undefined };
    update(id, next);
    if (job.status === "ready" && job.candidate) {
      const blob = await api.dishPhotoPreview(restaurantId, job.jobId, token);
      if (epoch === generation.current && recordsRef.current[id]?.key === record.key) savePreview(id, blob);
    } else if (job.status === "failed") throw new Error("This photo could not be created. You can choose a photo button to try a new request.");
    else throw new Error("Photo status is not confirmed yet. Check status before starting another request.");
  }
  async function check(id: string) {
    const record = recordsRef.current[id];
    if (!record || inFlight.current.has(id)) return;
    const epoch = generation.current;
    inFlight.current.add(id); setBusy(old => ({ ...old, [id]: true })); setErrors(old => ({ ...old, [id]: "" }));
    try {
      const token = await getStaffAccessToken();
      const job = record.jobId ? await api.readDishPhoto(restaurantId, record.jobId, token) : await api.findDishPhoto(restaurantId, record.key, token);
      await accept(id, record, job, token, epoch);
    } catch (error) {
      if (epoch === generation.current) {
        if (error instanceof ApiError && error.status === 404 && error.code === "PHOTO_NOT_FOUND") {
          try { update(id, { ...record, status: "failed", selected: false }); } catch { /* Retain the frozen request if storage is unavailable. */ }
        }
        setErrors(old => ({ ...old, [id]: error instanceof Error ? error.message : "The photo status could not be checked. Your request key is kept." }));
      }
    }
    finally { inFlight.current.delete(id); if (epoch === generation.current) setBusy(old => ({ ...old, [id]: false })); }
  }
  useEffect(() => {
    let active = true;
    Promise.resolve().then(async () => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        const restored = raw ? recordsSchema.parse(JSON.parse(raw)) : {};
        if (!active) return;
        recordsRef.current = restored; setRecords(restored);
        // Restore preview bytes from authenticated storage; never persist base64 or Blob URLs.
        const token = Object.keys(restored).length ? await getStaffAccessToken() : "";
        for (const [id, record] of Object.entries(restored)) {
          if (!active || !record.jobId || record.status !== "ready") continue;
          try { const blob = await api.dishPhotoPreview(restaurantId, record.jobId, token); if (active && recordsRef.current[id]?.key === record.key) savePreview(id, blob); } catch { /* Explicit status check remains available. */ }
        }
      } catch { if (active) setStorageError("Saved photo requests could not be restored. Photo generation is paused; you can continue without photos."); }
    });
    return () => { active = false; generation.current += 1; Object.values(urls.current).forEach(url => URL.revokeObjectURL(url)); urls.current = {}; };
  }, [storageKey, restaurantId]);

  async function generate(request: DishPhotoRequest, source?: File) {
    const id = request.dishId;
    if (inFlight.current.has(id) || storageError) return;
    if (recordsRef.current[id]?.status === "dispatch_unknown" && !(recordsRef.current[id]?.cancelled && request.mode === "source_crop")) { await check(id); return; }
    const epoch = generation.current;
    let dispatchedHTTP = false;
    const controller = new AbortController();
    controllers.current.set(id, controller);
    const record: PhotoRecord = { key: crypto.randomUUID(), request: dishPhotoRequestSchema.parse(request), status: "dispatch_unknown", selected: false };
    inFlight.current.add(id); setBusy(old => ({ ...old, [id]: true })); setErrors(old => ({ ...old, [id]: "" }));
    try {
      // Preserve the frozen request/key before any billable provider dispatch.
      update(id, record);
      if (urls.current[id]) { URL.revokeObjectURL(urls.current[id]); delete urls.current[id]; setPreviews({ ...urls.current }); }
      const token = await getStaffAccessToken();
      controller.signal.throwIfAborted();
      dispatchedHTTP = true;
      const job = await api.createDishPhoto(restaurantId, record.key, record.request, token, source, controller.signal);
      controller.signal.throwIfAborted();
      await accept(id, record, job, token, epoch);
    } catch (error) {
      if (epoch === generation.current) {
        if (controller.signal.aborted) {
          try { update(id, { ...record, cancelled: true, selected: false, status: dispatchedHTTP ? "dispatch_unknown" : "failed" }); } catch { /* Keep the saved request for reconciliation. */ }
          setErrors(old => ({ ...old, [id]: dispatchedHTTP ? "Cancelled. Processing may already have started; any result will stay unselected." : "Cancelled." }));
          return;
        }
        if (!dispatchedHTTP || error instanceof ApiError && ([400, 401, 403, 413, 422, 429].includes(error.status) || error.status === 503 && error.code === "NOT_CONFIGURED")) {
          try { update(id, { ...record, status: "failed" }); } catch { /* Preserve the original frozen record if storage is unavailable. */ }
        }
        setErrors(old => ({ ...old, [id]: error instanceof Error ? error.message : "Photo result unknown. Check the same request's status." }));
      }
    }
    finally { controllers.current.delete(id); inFlight.current.delete(id); if (epoch === generation.current) setBusy(old => ({ ...old, [id]: false })); }
  }
  function cancel(id: string) {
    controllers.current.get(id)?.abort();
  }
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !controllers.current.size) return;
      event.preventDefault();
      for (const [id, controller] of controllers.current) {
        if (recordsRef.current[id]?.request.mode !== "source_crop") controller.abort();
      }
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  function select(id: string) {
    const record = recordsRef.current[id];
    if (!record || record.status !== "ready" || !record.candidate || !previews[id]) return;
    try { update(id, { ...record, selected: true }); } catch { setErrors(old => ({ ...old, [id]: "Your photo selection could not be saved. Try again before publishing." })); }
  }
  function remove(id: string) {
    const record = recordsRef.current[id];
    if (!record) return;
    try { update(id, { ...record, selected: false }); } catch { setErrors(old => ({ ...old, [id]: "The saved selection could not be removed." })); }
  }
  function reset() {
    generation.current += 1;
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    try { commit({}); } catch { setStorageError("Photo selections could not be reset in browser storage. Continue without photos until storage is available."); }
    Object.values(urls.current).forEach(url => URL.revokeObjectURL(url)); urls.current = {}; setPreviews({}); setBusy({}); setErrors({});
  }
  return { latestRecords: () => recordsRef.current, records, previews, busy, errors, storageError, generate, cancel, check, select, remove, reset };
}
