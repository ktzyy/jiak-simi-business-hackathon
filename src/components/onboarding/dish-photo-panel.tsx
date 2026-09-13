"use client";
/* eslint-disable @next/next/no-img-element -- Local crop and authenticated candidate previews. */
import { useState } from "react";
import type { MenuPhotoRegion } from "@/shared/extraction";
import type { DishPhotoCandidate, PublishedDishPhoto } from "@/shared/dish-photo";
import type { DishCrop, UploadedMenu } from "./menu-images";
import s from "./dish-photo-panel.module.css";

export function DishPhotoPanel({ savedPhoto, dishId, dishName, crop, upload, sourceEntryId, currentCandidate, selected, busy, error, onCrop, onGenerate, onSelect, onRemove, onCheck }: {
  savedPhoto?: PublishedDishPhoto; dishId: string; dishName: string; crop?: DishCrop; upload?: UploadedMenu; sourceEntryId?: string;
  currentCandidate?: { candidate: DishPhotoCandidate; previewUrl: string } | null; selected?: boolean; busy?: boolean; error?: string;
  onCrop: (region: MenuPhotoRegion) => void; onGenerate: (mode: "enhance_visible" | "generate_similar") => void;
  onSelect: () => void; onRemove: () => void; onCheck?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [region, setRegion] = useState<MenuPhotoRegion>(crop?.region ?? { x: 0.1, y: 0.1, width: 0.3, height: 0.3 });
  const photo = currentCandidate?.candidate.dishId === dishId ? currentCandidate : null;
  return <section className={s.panel} aria-label={`Photo for ${dishName || "new dish"}`} aria-busy={busy}>
    <div className={s.comparison}>
      {crop ? <figure><img src={crop.url} alt={`Original crop of ${dishName}`} /><figcaption>{selected && photo ? "Original" : "Original · selected"}</figcaption></figure> : <div className={s.noPhoto}>{savedPhoto ? <figure><img src={savedPhoto.imageUrl} alt={dishName} /><figcaption>Current photo</figcaption></figure> : "No dish photo found"}</div>}
      {photo && <figure><img src={photo.previewUrl} alt={`${photo.candidate.mode === "generate_similar" ? "Generated" : "Polished"} ${dishName}`} /><figcaption>{`${photo.candidate.mode === "generate_similar" ? "AI-generated" : "AI-enhanced"}${selected ? " · selected" : ""}`}</figcaption></figure>}
      <div className={s.controls}>
        {crop && <button type="button" className="btn btn-outline" disabled={busy || !dishName.trim() || !!onCheck} onClick={() => onGenerate("enhance_visible")}>{busy ? "Polishing…" : "Polish image ✨"}</button>}
        {!crop && <button type="button" className="btn btn-outline" disabled={busy || !dishName.trim() || !!onCheck} onClick={() => onGenerate("generate_similar")}>Generate photo</button>}
        {upload && sourceEntryId && <button type="button" className={s.textButton} disabled={busy} onClick={() => { setRegion(crop?.region ?? region); setEditing(!editing); }}>{crop ? "Adjust crop" : "Choose dish area"}</button>}
        {photo && <button type="button" className="btn btn-teal" disabled={busy} onClick={selected ? onRemove : onSelect}>{selected ? crop ? "Use original" : "Remove photo" : photo.candidate.mode === "generate_similar" ? "Use photo" : "Use polished"}</button>}
      </div>
    </div>
    {!crop && !photo && <p className={s.hint}>Generated photos are labelled AI-generated.</p>}
    {photo && <p className={s.hint}>Check the ingredients and portion before selecting.</p>}
    {editing && upload && <div className={s.cropEditor}>
      <div className={s.cropCanvas}><img src={upload.url} alt="Choose the dish area in your menu" /><div className={s.cropOutline} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} /></div>
      <div className={s.sliders}>{([['x', 'Left'], ['y', 'Top'], ['width', 'Width'], ['height', 'Height']] as const).map(([key, label]) => <label key={key}>{label}<input type="range" aria-label={`${dishName} crop ${label.toLowerCase()}`} min={key === 'x' || key === 'y' ? 0 : 0.01} max={key === 'x' ? 1 - region.width : key === 'y' ? 1 - region.height : key === 'width' ? 1 - region.x : 1 - region.y} step="0.005" value={region[key]} onChange={e => setRegion({ ...region, [key]: Number(e.target.value) })} /></label>)}</div>
      <button type="button" className="btn btn-teal" onClick={() => { onCrop(region); setEditing(false); }}>Use crop</button>
    </div>}
    {busy && <p role="status" className={s.hint}>Preparing your photo…</p>}
    {error && <p role="alert" className={s.error}>{error}</p>}
    {onCheck && <button type="button" className="btn btn-outline" disabled={busy} onClick={onCheck}>Check photo status</button>}
  </section>;
}
