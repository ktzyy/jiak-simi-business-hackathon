"use client";

/* eslint-disable @next/next/no-img-element -- Local user-selected Blob URLs are displayed unchanged for source review. */

import type { Dispatch, SetStateAction } from "react";
import { DAYS, hoursSummary, timeLabel, type HourDay } from "./review-state";
import s from "./onboarding.module.css";

const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
function TimeSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className={s.timeField}><span>{label}</span><select value={value} onChange={e => onChange(e.target.value)} required><option value="">Choose time</option>{(value && !TIMES.includes(value) ? [value, ...TIMES] : TIMES).map(time => <option key={time} value={time}>{timeLabel(time)}</option>)}</select></label>;
}
export function StallDetails({ name, setName, hours, setHours, sameHours, setSameHours, photo, onPhoto, photoUrl, busy, onReloadDetails, onExtract, onManual, onExample, onExisting, currentMenu, existingAvailable, pageDetails, setPageDetails }: {
  pageDetails: { url: string; address: string; contact: string }; setPageDetails: (value: { url: string; address: string; contact: string }) => void;
  name: string; setName: (value: string) => void; hours: HourDay[]; setHours: Dispatch<SetStateAction<HourDay[]>>;
  sameHours: boolean; setSameHours: (value: boolean) => void; photo: File | null; onPhoto: (file: File | null) => void; photoUrl: string | null;
  busy: boolean; onReloadDetails: () => void; onExtract: () => void; onManual: () => void; onExample: () => void; onExisting: () => void; currentMenu: string; existingAvailable: boolean;
}) {
  function patchDay(index: number, patch: Partial<HourDay>) { setHours(old => old.map((day, i) => i === index ? { ...day, ...patch } : day)); }
  return <div className={s.stack}>
    <section className={`card ${s.section}`} aria-labelledby="stall-title">
      <p className="eyebrow">01 · Your stall</p><h2 id="stall-title">First, what’s your stall called?</h2>
      <label className="field">Stall / menu name<input value={name} maxLength={120} onChange={e => setName(e.target.value)} placeholder="e.g. Ah Huat Roast Meat" autoComplete="organization" required /></label>
      <p className={s.help}>This is the name customers will see on your menu.</p>
      <div className={s.hours}>
        <h3>When you’re open <span className={s.required}>Required</span></h3>
        <p>Let customers know when they can come by.</p>
        <label className={s.check}><input type="checkbox" checked={sameHours} onChange={e => { if (!e.target.checked) setHours(DAYS.map(() => ({ ...hours[0] }))); setSameHours(e.target.checked); }} />Same hours every day</label>
        {(sameHours ? [hours[0]] : hours).map((day, index) => <div className={s.day} key={index}>
          {<div className={s.dayHeading}><strong>{sameHours ? "Every day" : DAYS[index]}</strong><label className={s.check}><input type="checkbox" checked={day.closed} onChange={e => patchDay(index, { closed: e.target.checked })} />Closed</label></div>}
          {!day.closed && day.intervals && <>
            {day.intervals.map((period, periodIndex) => <div key={periodIndex} className={s.day}>
              <div className={s.timeRow}><TimeSelect label={`Period ${periodIndex + 1} opens`} value={period.opens} onChange={value => patchDay(index, { intervals: day.intervals!.map((p, i) => i === periodIndex ? { ...p, opens: value } : p) })} /><TimeSelect label={`Period ${periodIndex + 1} closes`} value={period.closes} onChange={value => patchDay(index, { intervals: day.intervals!.map((p, i) => i === periodIndex ? { ...p, closes: value } : p) })} /></div>
              <label className={s.check}><input type="checkbox" checked={period.closesNextDay} onChange={e => patchDay(index, { intervals: day.intervals!.map((p, i) => i === periodIndex ? { ...p, closesNextDay: e.target.checked } : p) })} />Closes next day</label>
              <button className="btn btn-outline" onClick={() => patchDay(index, { intervals: day.intervals!.filter((_, i) => i !== periodIndex) })}>Remove period</button>
            </div>)}
            <button className="btn btn-outline" disabled={day.intervals.length >= 4} onClick={() => patchDay(index, { intervals: [...day.intervals!, { opens: "", closes: "", closesNextDay: false }] })}>Add opening period</button>
          </>}
          {!day.closed && !day.intervals && <>
            <div className={s.timeRow}><TimeSelect label={sameHours ? "Opens" : `${DAYS[index]} opens`} value={day.start} onChange={value => patchDay(index, { start: value })} /><span>to</span><TimeSelect label={sameHours ? "Closes" : `${DAYS[index]} closes`} value={day.end} onChange={value => patchDay(index, { end: value })} /><button type="button" className={`btn btn-outline ${s.breakButton}`} onClick={() => patchDay(index, { hasBreak: !day.hasBreak })}>{day.hasBreak ? "− Remove break" : "+ Midday break"}</button></div>
            <label className={s.check}><input type="checkbox" checked={day.nextDay} onChange={e => patchDay(index, { nextDay: e.target.checked })} />Closes next day</label>
            {!day.hasBreak && <button className="btn btn-outline" onClick={() => patchDay(index, { intervals: [{ opens: day.start, closes: day.end, closesNextDay: day.nextDay }] })}>Use multiple opening periods</button>}
            {day.hasBreak && <div className={s.timeRow}><TimeSelect label="Break starts" value={day.breakStart} onChange={value => patchDay(index, { breakStart: value })} /><span>to</span><TimeSelect label="Back open" value={day.breakEnd} onChange={value => patchDay(index, { breakEnd: value })} /></div>}
          </>}
        </div>)}
        <p className={s.hoursSummary}>{hoursSummary(hours, sameHours)}</p>
        <p className={s.help}>Singapore time (Asia/Singapore). Your name and all seven days are saved when you prepare the preview. They become public only with your explicit menu publication.</p>
      <button className="btn btn-outline" onClick={onReloadDetails} disabled={busy}>Reload saved name and hours</button></div>
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
      <div className={s.contact}><label className="field">Address <span className={s.optional}>Optional</span><input value={pageDetails.address} onChange={e => setPageDetails({ ...pageDetails, address: e.target.value })} autoComplete="street-address" placeholder="Hawker centre and unit number" /></label><label className="field">Contact number <span className={s.optional}>Optional</span><input type="tel" value={pageDetails.contact} onChange={e => setPageDetails({ ...pageDetails, contact: e.target.value })} autoComplete="tel" placeholder="e.g. +65 8123 4567" /></label></div>
      <p className={s.help}>Address, contact and page-link import are not saved yet. Name and opening hours are saved separately above.</p>
    </section>
  </div>;
}
