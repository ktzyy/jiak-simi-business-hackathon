"use client";

/* eslint-disable @next/next/no-img-element -- Local upload and candidate Blob URLs are previewed without image optimization. */

import { useId, useState } from "react";
import type { DishPhotoCandidate, DishPhotoRequest } from "@/shared/dish-photo";
import s from "./dish-photo-panel.module.css";

export type DishPhotoPanelProps = {
  dishId: string;
  dishName: string;
  originalFile?: File | null;
  previewURL?: string | null;
  sourceEntryId?: string | null;
  currentCandidate?: { candidate: DishPhotoCandidate; previewUrl: string } | null;
  selected?: boolean;
  busy?: boolean;
  error?: string | null;
  retryStatus?: string | null;
  onGenerate: (mode: DishPhotoRequest["mode"]) => void;
  onSelect: (candidate: DishPhotoCandidate) => void;
  onRemove: () => void;
};

/** Optional photo editor. Parent owns requests, Blob URL lifetimes, and explicit selection. */
export function DishPhotoPanel({ dishId, dishName, originalFile, previewURL, sourceEntryId, currentCandidate, selected = false, busy = false, error, retryStatus, onGenerate, onSelect, onRemove }: DishPhotoPanelProps) {
  const headingId = useId();
  const [acknowledgment, setAcknowledgment] = useState<{ file: File; dishId: string; sourceEntryId: string } | null>(null);
  const hasSource = Boolean(originalFile && sourceEntryId);
  const confirmedVisible = hasSource && acknowledgment?.file === originalFile && acknowledgment?.dishId === dishId && acknowledgment?.sourceEntryId === sourceEntryId;
  // A delayed response for another dish must never be offered for selection here.
  const photo = currentCandidate?.candidate.dishId === dishId ? currentCandidate : null;
  const hasDishName = dishName.trim().length > 0;

  return <section className={s.panel} aria-labelledby={headingId} aria-busy={busy}>
    <div className={s.heading}>
      <h4 id={headingId}>Dish photo <span>Optional</span></h4>
      <p>Add a photo for {dishName || "this dish"}, or carry on without one.</p>
    </div>

    {hasSource && <div className={s.source}>
      {previewURL && <details>
        <summary>View your menu photo</summary>
        <img className={s.sourceImage} src={previewURL} alt="Original uploaded menu for checking whether this dish is visible" />
      </details>}
      <label className={s.check}>
        <input type="checkbox" checked={Boolean(confirmedVisible)} disabled={busy} onChange={event => setAcknowledgment(event.target.checked && originalFile && sourceEntryId ? { file: originalFile, dishId, sourceEntryId } : null)} />
        I can see this dish in my menu photo.
      </label>
    </div>}

    <div className={s.actions}>
      {hasSource && <button type="button" className="btn btn-outline" disabled={busy || !confirmedVisible || !hasDishName} onClick={() => onGenerate("enhance_visible")}>Enhance menu photo</button>}
      <button type="button" className="btn btn-outline" disabled={busy || !hasDishName} onClick={() => onGenerate("generate_similar")}>Generate dish photo</button>
    </div>
    <p className={s.hint}>{hasSource ? "Enhancement uses your uploaded photo. " : ""}Generated photos show a similar dish and carry an AI-generated label.</p>

    {busy && <p className={s.status} role="status">Creating your photo… You can continue reviewing the menu.</p>}
    {error && <div className={s.error} role="alert"><p>{error}</p><p>You can try a photo button again or continue without a photo.</p></div>}
    {!busy && retryStatus && <p className={s.status} role="status">{retryStatus}</p>}

    {photo && <div className={s.candidate}>
      <figure>
        <img src={photo.previewUrl} alt={`${photo.candidate.label} of ${dishName || "this dish"}`} />
        <figcaption>{photo.candidate.label}</figcaption>
      </figure>
      <div className={s.review}>
        <p>{photo.candidate.mode === "enhance_visible" ? "Check that the ingredients and serving still match your dish." : "Check that this illustration is a fair example of what you serve."}</p>
        <p className={s.hint}>The AI label stays with the photo on your menu.</p>
        <div className={s.actions}>
          <button type="button" className="btn btn-teal" disabled={busy || selected} onClick={() => onSelect(photo.candidate)}>{selected ? "Photo selected" : "Use photo"}</button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={onRemove}>Remove photo</button>
        </div>
      </div>
    </div>}
  </section>;
}
