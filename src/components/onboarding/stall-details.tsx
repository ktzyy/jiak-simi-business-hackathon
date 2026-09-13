"use client";
/* eslint-disable @next/next/no-img-element -- User-selected local menu images. */
import type { Dispatch, SetStateAction } from "react";
import type { HourDay } from "./review-state";
import type { UploadedMenu } from "./menu-images";
import { OpeningHours } from "./opening-hours";
import s from "./onboarding.module.css";

export function StallDetails({ name, setName, hours, setHours, sameHours, setSameHours, uploads, onPhotos, onRemovePhoto, busy, onReloadDetails, onExtract, onDemoImage, onExisting, existingAvailable }: {
  name: string; setName: (value: string) => void; hours: HourDay[]; setHours: Dispatch<SetStateAction<HourDay[]>>;
  sameHours: boolean; setSameHours: (value: boolean) => void; uploads: UploadedMenu[];
  onPhotos: (files: File[]) => void; onRemovePhoto: (id: string) => void;
  onDemoImage: () => void; busy: boolean; onReloadDetails: () => void; onExtract: () => void; onExisting: () => void; existingAvailable: boolean;
}) {
  return <div className={s.stack}>
    <section className={`card ${s.section}`} aria-label="Your stall">
      <p className="eyebrow">01 · Your stall</p>
      <label className="field">Stall name<input value={name} maxLength={120} onChange={e => setName(e.target.value)} placeholder="e.g. Ah Huat Roast Meat" autoComplete="organization" required /></label>
      <OpeningHours hours={hours} setHours={setHours} sameHours={sameHours} setSameHours={setSameHours} busy={busy} onReloadDetails={onReloadDetails} />
    </section>
    <section className={`card ${s.section}`} aria-label="Your menu">
      <p className="eyebrow">02 · Your menu</p>
      <div className={s.menuUploadHeading}><p>Menu photos</p>{existingAvailable && <button type="button" className="btn btn-outline" onClick={onExisting}>Edit published menu</button>}</div>
      <div className={s.upload}>
        <span className={s.uploadMark} aria-hidden="true">↑</span><strong>Upload your menu</strong>
        <p className={s.help}>Up to 3 photos · JPEG, PNG or WebP · 5 MB each</p>
        {uploads.length < 3 && <label className={s.filePicker}><span>{uploads.length ? "Add photos" : "Choose photos"}</span><input aria-label="Choose menu photos" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { onPhotos(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label>}
        {uploads.length < 3 && <button type="button" className={s.textAction} onClick={onDemoImage} disabled={busy}>Upload Demo Image</button>}
        {!!uploads.length && <div className={s.uploadedPhotos}>{uploads.map((upload, index) => <figure key={upload.id}>
          <img src={upload.url} alt={`Uploaded menu ${index + 1}`} /><figcaption>{upload.file.name}</figcaption>
          <button type="button" className={s.photoDelete} onClick={() => onRemovePhoto(upload.id)} aria-label={`Remove menu ${index + 1}`}>×</button>
        </figure>)}</div>}
      </div>
      <div className={s.actions}>
        <button className="btn btn-primary" onClick={onExtract} disabled={busy || !uploads.length}>Next →</button>
      </div>
    </section>
  </div>;
}
