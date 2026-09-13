"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { DAYS, hoursSummary, timeLabel, type HourDay } from "./review-state";
import { compactHours, editCompactHours, individualDays, openDay, openingPeriods } from "./hours-presentation";
import s from "./opening-hours.module.css";

const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
function TimeSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className={s.timeField}><span className={s.srOnly}>{label}</span><select aria-label={label} value={value} onChange={e => onChange(e.target.value)} required><option value="">Choose time</option>{(value && !TIMES.includes(value) ? [value, ...TIMES] : TIMES).map(time => <option key={time} value={time}>{timeLabel(time)}</option>)}</select></label>;
}

export function OpeningHours({ hours, setHours, sameHours, setSameHours, busy, onReloadDetails }: {
  hours: HourDay[]; setHours: Dispatch<SetStateAction<HourDay[]>>; sameHours: boolean; setSameHours: (value: boolean) => void; busy: boolean; onReloadDetails: () => void;
}) {
  const [moreOptions, setMoreOptions] = useState(false);
  const [advancedDays, setAdvancedDays] = useState<number[]>([]);
  const visibleDays = sameHours ? [hours[0]] : hours;
  function update(index: number, change: (day: HourDay) => HourDay) { setHours(old => old.map((day, i) => i === index ? change(day) : day)); }
  function toggleSame(checked: boolean) {
    if (!checked) setHours(individualDays(hours));
    setSameHours(checked);
  }
  function openAdvanced(index: number) { setAdvancedDays(old => old.includes(index) ? old : [...old, index]); setMoreOptions(true); }
  return <div className={s.hours}>
    <h3>When you’re open <span className={s.required}>Required</span></h3>
    <p className={s.help}>Let customers know when they can come by.</p>
    <label className={s.check}><input type="checkbox" checked={sameHours} onChange={e => toggleSame(e.target.checked)} />Same hours every day</label>
    <div className={s.days}>
      {visibleDays.map((day, index) => {
        const compact = compactHours(day);
        const label = sameHours ? "Every day" : DAYS[index];
        return <div className={s.day} key={index}>
          <div className={s.mainRow}>
            {(!sameHours || day.closed) && <label className={`${s.check} ${s.dayToggle}`}><input aria-label={`${label} open`} type="checkbox" checked={!day.closed} onChange={e => update(index, d => openDay(d, e.target.checked))} /><strong>{label}</strong></label>}
            {day.closed ? <span className={s.closed}>Closed</span> : compact ? <>
              <div className={s.times}><TimeSelect label={`${label} opens`} value={compact.start} onChange={start => update(index, d => editCompactHours(d, { start }))} /><span>to</span><TimeSelect label={`${label} closes`} value={compact.end} onChange={end => update(index, d => editCompactHours(d, { end }))} /></div>
              {compact.nextDay && <span className={s.overnight}>Next day</span>}
              <button type="button" className={s.textButton} onClick={() => update(index, d => editCompactHours(d, { hasBreak: !compact.hasBreak }))}>{compact.hasBreak ? "− Remove break" : "+ midday break"}</button>
            </> : <>
              <span className={s.periodSummary}>{day.intervals!.map(period => `${timeLabel(period.opens)}–${timeLabel(period.closes)}${period.closesNextDay ? " next day" : ""}`).join(" · ")}</span>
              <button type="button" className={s.textButton} onClick={() => openAdvanced(index)}>Edit {day.intervals!.length} opening times</button>
            </>}
          </div>
          {!day.closed && compact?.hasBreak && <div className={s.breakRow}><span className={s.breakLabel}>Midday break</span><div className={s.times}><TimeSelect label={`${label} break starts`} value={compact.breakStart} onChange={breakStart => update(index, d => editCompactHours(d, { breakStart }))} /><span>to</span><TimeSelect label={`${label} back open`} value={compact.breakEnd} onChange={breakEnd => update(index, d => editCompactHours(d, { breakEnd }))} /></div></div>}
        </div>;
      })}
    </div>
    <p className={s.hoursSummary}>{hoursSummary(hours, sameHours)}</p>
    <div className={s.footer}>
      <p className={s.help}>Singapore time · Saved when you preview your menu.</p>
      <button type="button" className={s.textButton} aria-expanded={moreOptions} aria-controls="extra-hours-options" onClick={() => setMoreOptions(!moreOptions)}>More hours options {moreOptions ? "−" : "+"}</button>
    </div>
    {moreOptions && <div id="extra-hours-options" className={s.moreOptions}>
      {visibleDays.map((day, index) => {
        const compact = compactHours(day);
        const advanced = !compact || advancedDays.includes(index);
        const label = sameHours ? "Every day" : DAYS[index];
        const periods = openingPeriods(day);
        return <div className={s.advancedDay} key={index}>
          <div className={s.advancedHeader}><strong>{label}</strong><label className={s.check}><input type="checkbox" checked={day.closed} onChange={e => update(index, d => openDay(d, !e.target.checked))} />Closed</label></div>
          {!day.closed && (advanced ? <>
            {periods.map((period, periodIndex) => <div className={s.periodRow} key={periodIndex}>
              <div className={s.times}><TimeSelect label={`${label} period ${periodIndex + 1} opens`} value={period.opens} onChange={opens => update(index, d => ({ ...d, intervals: openingPeriods(d).map((p, i) => i === periodIndex ? { ...p, opens } : p) }))} /><span>to</span><TimeSelect label={`${label} period ${periodIndex + 1} closes`} value={period.closes} onChange={closes => update(index, d => ({ ...d, intervals: openingPeriods(d).map((p, i) => i === periodIndex ? { ...p, closes } : p) }))} /></div>
              <label className={s.check}><input type="checkbox" checked={period.closesNextDay} onChange={e => update(index, d => ({ ...d, intervals: openingPeriods(d).map((p, i) => i === periodIndex ? { ...p, closesNextDay: e.target.checked } : p) }))} />Closes next day</label>
              <button type="button" className={s.remove} aria-label={`Remove ${label} opening time ${periodIndex + 1}`} disabled={periods.length <= 1} onClick={() => update(index, d => ({ ...d, intervals: openingPeriods(d).filter((_, i) => i !== periodIndex) }))}>×</button>
            </div>)}
            <button type="button" className={s.textButton} disabled={periods.length >= 4} onClick={() => update(index, d => ({ ...d, intervals: [...openingPeriods(d), { opens: "", closes: "", closesNextDay: false }] }))}>+ Add opening time</button>
          </> : <div className={s.advancedHeader}><label className={s.check}><input type="checkbox" checked={compact.nextDay} onChange={e => update(index, d => editCompactHours(d, { nextDay: e.target.checked }))} />Closes next day</label><button type="button" className={s.textButton} onClick={() => openAdvanced(index)}>Edit separate opening times</button></div>)}
        </div>;
      })}
      <button type="button" className={s.textButton} onClick={onReloadDetails} disabled={busy}>Reload saved name and hours</button>
      <p className={s.help}>Reload replaces your edits with the last saved details. Customers see your changes after you publish.</p>
    </div>}
  </div>;
}
