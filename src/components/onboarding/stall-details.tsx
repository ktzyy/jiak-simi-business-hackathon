"use client";

/* eslint-disable @next/next/no-img-element -- Local user-selected Blob URLs are displayed unchanged for source review. */

import type { Dispatch, SetStateAction } from "react";
import type { HourDay } from "./review-state";
import { OpeningHours } from "./opening-hours";
import s from "./onboarding.module.css";

export function StallDetails({ name, setName, hours, setHours, sameHours, setSameHours, photo, onPhoto, photoUrl, busy, onReloadDetails, onExtract, onManual, onExample, onExisting, currentMenu, existingAvailable, pageDetails, setPageDetails }: {
  pageDetails: { url: string; address: string; contact: string }; setPageDetails: (value: { url: string; address: string; contact: string }) => void;
  name: string; setName: (value: string) => void; hours: HourDay[]; setHours: Dispatch<SetStateAction<HourDay[]>>;
  sameHours: boolean; setSameHours: (value: boolean) => void; photo: File | null; onPhoto: (file: File | null) => void; photoUrl: string | null;
  busy: boolean; onReloadDetails: () => void; onExtract: () => void; onManual: () => void; onExample: () => void; onExisting: () => void; currentMenu: string; existingAvailable: boolean;
}) {
  return <div className={s.stack}>
    <section className={`card ${s.section}`} aria-labelledby="stall-title">
      <p className="eyebrow">01 · Your stall</p><h2 id="stall-title">First, what’s your stall called?</h2>
      <label className="field">Stall / menu name<input value={name} maxLength={120} onChange={e => setName(e.target.value)} placeholder="e.g. Ah Huat Roast Meat" autoComplete="organization" required /></label>
      <p className={s.help}>This is the name customers will see on your menu.</p>
      <OpeningHours hours={hours} setHours={setHours} sameHours={sameHours} setSameHours={setSameHours} busy={busy} onReloadDetails={onReloadDetails} />
    </section>

    <section className={`card ${s.section}`} aria-labelledby="menu-upload-title">
      <p className="eyebrow">02 · Your menu</p><h2 id="menu-upload-title">One clear photo. We’ll do the typing.</h2>
      <p>Get the dish names and prices in the frame. You’ll check everything before it goes live.</p>
      <div className={s.upload}>
        <span className={s.uploadMark} aria-hidden="true">↑</span><strong>{photo ? photo.name : "Add a photo of your menu"}</strong>
        <p>JPEG, PNG or WebP · up to 5 MiB</p>
        <label className={s.filePicker}><span>Choose file</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { onPhoto(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
        {photoUrl && <div className={s.photoPreview}>{/* User-selected local Blob URL, not a remote optimizer input. */}<img src={photoUrl} alt="Your uploaded menu, for checking the extraction" /></div>}
      </div>
      <div className={s.actions}><button className="btn btn-primary" onClick={onExtract} disabled={busy || !photo}>{busy ? "Reading your menu…" : "Read my menu →"}</button><button className="btn btn-outline" onClick={onManual} disabled={busy}>I’ll type it in</button></div>
      <p className={s.help}>Your photo is sent for extraction only when you choose “Read my menu”.</p>
      <details className={s.sample}><summary>Trying the demo?</summary><p>The saved extraction is an unapproved example from a different menu photo. It still needs every review check.</p><button className="btn btn-outline" onClick={onExample} disabled={busy}>Load saved extraction example</button>{existingAvailable && <div className={s.saved}><p>Published menu: <strong>{currentMenu}</strong></p><button className="btn btn-outline" onClick={onExisting} disabled={busy}>Edit the published menu</button></div>}</details>
    </section>

    <section className={`card ${s.section}`} aria-labelledby="stall-page-title">
      <p className="eyebrow">03 · Your existing page <span className={s.optional}>Optional</span></p><h2 id="stall-page-title">Already online somewhere?</h2><p>Add your Google Maps, Oddle or stall page link.</p>
      <div className={s.urlRow}><label className="field">Stall page URL<input type="url" value={pageDetails.url} onChange={e => setPageDetails({ ...pageDetails, url: e.target.value })} placeholder="https://…" aria-describedby="url-coming" /></label><button className="btn btn-outline" disabled>Find my stall details</button></div>
      <p id="url-coming" className={s.help}>Link import is coming next. No details are fetched or saved yet.</p>
      <details className={s.contactDetails}>
        <summary>Address & contact <span className={s.optional}>Optional</span></summary>
        <div className={s.contact}><label className="field">Address <span className={s.optional}>Optional</span><input value={pageDetails.address} onChange={e => setPageDetails({ ...pageDetails, address: e.target.value })} autoComplete="street-address" placeholder="Hawker centre and unit number" /></label><label className="field">Contact number <span className={s.optional}>Optional</span><input type="tel" value={pageDetails.contact} onChange={e => setPageDetails({ ...pageDetails, contact: e.target.value })} autoComplete="tel" placeholder="e.g. +65 8123 4567" /></label></div>
      <p className={s.help}>Address and contact stay in this draft for now; they aren’t saved to your stall page yet.</p>
      </details>
    </section>
  </div>;
}
