"use client";
/* eslint-disable @next/next/no-img-element -- Local crop and authenticated candidate previews. */
import { useRef, useState, type ReactNode, type PointerEvent } from "react";
import type { MenuPhotoRegion } from "@/shared/extraction";
import type { DishPhotoCandidate, PublishedDishPhoto } from "@/shared/dish-photo";
import type { DishCrop, UploadedMenu } from "./menu-images";
import s from "./dish-photo-panel.module.css";

export function DishPhotoPanel({ addonsAction, onCancel, savedPhoto, dishId, dishName, crop, upload, sourceEntryId, currentCandidate, selected, busy, error, onCrop, onGenerate, onSelect, onRemove, onCheck }: {
  addonsAction: ReactNode; onCancel: () => void;
  savedPhoto?: PublishedDishPhoto; dishId: string; dishName: string; crop?: DishCrop; upload?: UploadedMenu; sourceEntryId?: string;
  currentCandidate?: { candidate: DishPhotoCandidate; previewUrl: string } | null; selected?: boolean; busy?: boolean; error?: string;
  onCrop: (region: MenuPhotoRegion) => void; onGenerate: (mode: "enhance_visible" | "generate_similar") => void;
  onSelect: () => void; onRemove: () => void; onCheck?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [region, setRegion] = useState<MenuPhotoRegion>(crop?.region ?? { x: 0.1, y: 0.1, width: 0.3, height: 0.3 });
  const drag = useRef<{ x: number; y: number; width: number; height: number; region: MenuPhotoRegion; resize: boolean } | null>(null);
  function startDrag(event: PointerEvent<HTMLDivElement>, resize = false) {
    event.preventDefault(); event.stopPropagation();
    const canvas = event.currentTarget.closest(`.${s.cropCanvas}`)!.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, width: canvas.width, height: canvas.height, region, resize };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current; if (!start) return;
    const dx = (event.clientX - start.x) / start.width, dy = (event.clientY - start.y) / start.height;
    setRegion(start.resize ? { ...start.region, width: Math.max(.03, Math.min(1 - start.region.x, start.region.width + dx)), height: Math.max(.03, Math.min(1 - start.region.y, start.region.height + dy)) }
      : { ...start.region, x: Math.max(0, Math.min(1 - start.region.width, start.region.x + dx)), y: Math.max(0, Math.min(1 - start.region.height, start.region.y + dy)) });
  }
  const photo = currentCandidate?.candidate.dishId === dishId ? currentCandidate : null;
  return <section className={s.panel} aria-label={`Photo for ${dishName || "new dish"}`} aria-busy={busy}>
    <div className={s.comparison}>
      <div className={s.photoColumn}>
        {crop ? <figure><img src={crop.url} alt={`Original crop of ${dishName}`} /><figcaption>{selected && photo ? "Original" : "Original · selected"}</figcaption></figure> : savedPhoto ? <figure><img src={savedPhoto.imageUrl} alt={dishName} /><figcaption>Current photo</figcaption></figure> : <div className={s.noPhoto}>No dish photo found</div>}
        {upload && sourceEntryId && <p className={s.cropHint}>Not showing the right dish? <button type="button" className={s.textButton} disabled={busy} onClick={() => { setRegion(crop?.region ?? region); setEditing(!editing); }}>Adjust crop.</button></p>}

      </div>
      {photo && <div className={s.photoColumn}><figure><img src={photo.previewUrl} alt={`${photo.candidate.mode === "generate_similar" ? "Generated" : "Polished"} ${dishName}`} /><figcaption>{`${photo.candidate.mode === "generate_similar" ? "AI-generated" : "AI-enhanced"}${selected ? " · selected" : ""}`}</figcaption></figure><p className={s.cropHint}>Check ingredients and portion.</p><button type="button" className={selected ? s.textButton : "btn btn-teal"} disabled={busy} onClick={selected ? onRemove : onSelect}>{selected ? crop ? "Revert to original" : "Remove photo" : photo.candidate.mode === "generate_similar" ? "Use photo" : "Use polished"}</button></div>}
    </div>
    <div className={s.actionRow}>
        {!crop && <button type="button" className={`btn btn-outline ${s.polishButton}`} disabled={busy || !dishName.trim() || !!onCheck} onClick={() => onGenerate("generate_similar")}>Generate photo</button>}
      {addonsAction}
    </div>
    {!crop && !photo && <p className={s.hint}>Generated photos are labelled AI-generated.</p>}
    {editing && upload && <div className={s.cropEditor}>
      <div className={s.cropCanvas}><img src={upload.url} alt="Choose the dish area in your menu" /><div className={s.cropOutline} role="group" aria-label="Move crop area with arrow keys or drag" tabIndex={0} onPointerDown={event => startDrag(event)} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={event => {
        const step = event.shiftKey ? .05 : .01;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault(); setRegion(old => ({ ...old, x: Math.max(0, Math.min(1 - old.width, old.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0))), y: Math.max(0, Math.min(1 - old.height, old.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0))) }));
      }} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}><div className={s.resizeHandle} role="group" tabIndex={0} aria-label="Resize crop with arrow keys or drag" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? .05 : .01;
        setRegion(old => ({ ...old, width: Math.max(.03, Math.min(1 - old.x, old.width + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0))), height: Math.max(.03, Math.min(1 - old.y, old.height + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0))) }));
      }} onPointerDown={event => startDrag(event, true)} onPointerMove={event => { event.stopPropagation(); moveDrag(event); }} onPointerUp={() => { drag.current = null; }} /></div></div>
      <button type="button" className="btn btn-teal" onClick={() => { onCrop(region); setEditing(false); }}>Use crop</button>
    </div>}
    {busy && <p role="status" className={s.hint}>Polishing… <button type="button" className={s.textButton} onClick={onCancel}>Cancel (Esc)</button></p>}
    {error && <p role="alert" className={s.error}>{error}</p>}
    {onCheck && <button type="button" className="btn btn-outline" disabled={busy} onClick={onCheck}>Check photo status</button>}
  </section>;
}
