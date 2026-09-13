"use client";
/* eslint-disable @next/next/no-img-element -- User-selected menu images for source review. */
import { useState, useEffect, useRef, type ReactNode } from "react";
import type { ExtractedMenuDraft } from "@/shared/extraction";
import { amount, dishProblem, type GlobalAddonEdit, type DishEdit } from "./review-state";
import type { UploadedMenu } from "./menu-images";
import { DishOptions } from "./dish-options";
import { withSharedExtras } from "./shared-extras";
import s from "./onboarding.module.css";

export function MenuReview({ sharedRows, setSharedRows, excludedExtras, setExcludedExtras, anyExtras, onAnyExtrasChange, dishes, draft, uploads, onDishChange, onConfirmDish, onAddDish, onRemoveDish, onContinue, onBack, renderDishPhoto }: {
  sharedRows: GlobalAddonEdit[]; setSharedRows: (rows: GlobalAddonEdit[]) => void; excludedExtras: string[]; setExcludedExtras: (ids: string[]) => void;
  anyExtras: ReadonlySet<string>; onAnyExtrasChange: (id: string, enabled: boolean) => void;
  dishes: DishEdit[]; draft: ExtractedMenuDraft | null; uploads: UploadedMenu[];
  onDishChange: (id: string, patch: Partial<DishEdit>) => void; onConfirmDish: (id: string) => boolean;
  onAddDish: () => string; onRemoveDish: (id: string) => void; onContinue: (dishes: DishEdit[]) => void; onBack: () => void;
  renderDishPhoto: (dish: DishEdit) => ReactNode;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const globalRows = sharedRows;
  const [globalGroupId] = useState(() => crypto.randomUUID());
  const [globalMessage, setGlobalMessage] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [deleting, setDeleting] = useState<DishEdit | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (deleting) dialog.current?.showModal(); else dialog.current?.close(); }, [deleting]);
  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() => {
      const field = root.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]');
      field?.scrollIntoView({ block: "center", behavior: "smooth" }); field?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, expanded]);
  const badPrice = (value: string) => !Number.isInteger(amount(value)) || amount(value) < 0 || amount(value) > 1_000_000;
  const badName = (value: string) => !value.trim() || value.trim().length > 120;
  const duplicate = (row: GlobalAddonEdit) => globalRows.some(other => other.id !== row.id && other.included && other.name.trim().toLowerCase() === row.name.trim().toLowerCase());
  function updateGlobal(index: number, patch: Partial<GlobalAddonEdit>) { setSharedRows(globalRows.map((row, i) => i === index ? { ...row, ...patch } : row)); setGlobalMessage(""); }
  function validateDish(dish: DishEdit) {
    setAttempted(true);
    if (dishProblem(dish)) { setExpanded(dish.id); setFocusRequest(n => n + 1); return false; }
    return true;
  }
  function next() {
    setAttempted(true); setGlobalMessage("");
    const invalid = dishes.find(dish => dishProblem(dish));
    if (invalid) { validateDish(invalid); return; }
    try { onContinue(withSharedExtras(dishes, globalRows, excludedExtras, globalGroupId)); }
    catch (error) { setGlobalMessage(error instanceof Error ? error.message : "Check your extras."); setFocusRequest(n => n + 1); }
  }
  return <div className={s.stack} ref={root}>
    <div className={s.reviewHeading}><span className={s.progress}>{dishes.filter(d => d.included).length} dishes</span></div>
    {!!uploads.length && <details className={s.original} open><summary>Your uploaded menu</summary>{uploads.map((upload, index) => <img key={upload.id} src={upload.url} alt={`Your uploaded menu ${index + 1}`} />)}</details>}
    {!dishes.length && <p className="notice">No dishes found. Add a dish or try a clearer photo.</p>}
    {draft?.issues.filter(issue => issue.itemId === null && !["human_review_required", "source_mapping_required", "unknown_price", "empty_menu"].includes(issue.code)).map(issue => <p className="notice" key={issue.id}>{issue.message}</p>)}
    <div className={s.dishes}>{dishes.map((dish, index) => {
      const item = draft?.items.find(item => item.id === dish.draftItemId);
      const source = draft?.sourceEntries?.find(entry => entry.id === item?.sourceEntryId);
      const isOpen = expanded === dish.id;
      return <article key={dish.id} className={`${s.dish} ${!dish.included ? s.excluded : ""}`}>
        <button type="button" className={s.dishDelete} aria-label={`Delete ${dish.name || "dish"}`} onClick={() => setDeleting(dish)}>×</button>
        <button className={s.dishSummary} onClick={() => setExpanded(isOpen ? null : dish.id)} aria-expanded={isOpen} aria-controls={`dish-${dish.id}`}>
          <span className={s.dishNumber}>{String(index + 1).padStart(2, "0")}</span>
          <span className={s.summaryMain}><strong>{dish.name || "New dish"}</strong><span className={s.modifierSummary}>{dish.groups.flatMap(group => group.options.map(option => <span className={s.modifierChip} key={option.id}>{option.name || "Unnamed extra"}{option.price ? ` · ${Number(option.price) < 0 ? "−" : "+"}S$${Math.abs(Number(option.price)).toFixed(2)}` : " · price needed"}</span>))}</span></span>
          <span className={s.summaryEnd}><strong>{dish.price ? `S$${dish.price}` : "Price needed"}</strong><span>{dish.included ? "Edit" : "Excluded"}</span></span><span aria-hidden="true">{isOpen ? "−" : "+"}</span>
        </button>
        {dish.included && renderDishPhoto(dish)}
        {source?.uncertainty && <p className="notice">{source.uncertainty}</p>}
        {isOpen && <div id={`dish-${dish.id}`} className={s.dishEditor}>
          {item && <p className={s.help}>On your menu: {item.name ?? "Name unclear"} · {item.rawPriceText ?? "Price unclear"}</p>}
          {dish.included && <>
            <label className="field">Dish name<input aria-invalid={attempted && badName(dish.name)} value={dish.name} maxLength={120} onChange={e => onDishChange(dish.id, { name: e.target.value })} /></label>
            <label className="field">Price (S$)<input aria-invalid={attempted && badPrice(dish.price)} value={dish.price} inputMode="decimal" placeholder="4.50" onChange={e => onDishChange(dish.id, { price: e.target.value })} /></label>
            <label className={s.check}><input type="checkbox" checked={!dish.available} onChange={e => onDishChange(dish.id, { available: !e.target.checked })} />Sold out</label>
            <DishOptions showErrors={attempted} anyExtras={anyExtras} onAnyExtrasChange={onAnyExtrasChange} groups={dish.groups} onChange={groups => onDishChange(dish.id, { groups })} />
          </>}
          {attempted && dishProblem(dish) && <p className={s.fieldError} role="alert">{dishProblem(dish)}</p>}
          <div className={s.actions}><button className="btn btn-teal" onClick={() => { if (validateDish(dish) && onConfirmDish(dish.id)) setExpanded(null); }}>Done</button></div>
        </div>}
      </article>;
    })}</div>
    <button className={`btn btn-teal ${s.addDish}`} disabled={dishes.length >= 100} onClick={() => setExpanded(onAddDish())}>+ Add a dish</button>
    <section className={`card ${s.section}`}>
      <h2>Extras for all dishes</h2>
      <details className={s.excludeExtras}><summary>Exclude add-ons from{excludedExtras.length ? ` ${excludedExtras.length} dishes` : "…"}</summary><div>{dishes.map(dish => <label key={dish.id} className={s.check}><input type="checkbox" checked={excludedExtras.includes(dish.id)} onChange={e => setExcludedExtras(e.target.checked ? [...excludedExtras, dish.id] : excludedExtras.filter(id => id !== dish.id))} />{dish.name || "New dish"}</label>)}</div></details>
      {!!globalRows.length && <div className={s.sharedTableHeading} aria-hidden="true"><span /><span>Add-on</span><span>Price (S$)</span></div>}
      {globalRows.map((row, index) => <div key={row.id} className={s.sharedOptionRow}>
        <label className={s.check}><input type="checkbox" checked={row.included} onChange={e => updateGlobal(index, { included: e.target.checked })} />Include</label>
        <label className="field"><span className={s.srOnly}>Extra</span><input aria-invalid={attempted && row.included && (badName(row.name) || duplicate(row))} maxLength={120} value={row.name} disabled={!row.included} onChange={e => updateGlobal(index, { name: e.target.value })} /></label>
        <label className="field"><span className={s.srOnly}>Price (S$)</span><input aria-invalid={attempted && row.included && badPrice(row.price)} inputMode="decimal" value={row.price} disabled={!row.included} placeholder="0.00" onChange={e => updateGlobal(index, { price: e.target.value })} /></label>
      </div>)}
      <div className={s.actions}><button className="btn btn-outline" disabled={globalRows.length >= 20} onClick={() => { setSharedRows([...globalRows, { id: crypto.randomUUID(), name: "", price: "", included: true, sourceIds: [] }]); }}>+ Add extra</button>
</div>
      {globalMessage && <p className={s.fieldError} role="alert">{globalMessage}</p>}
    </section>
    <div className={s.actions}><button className="btn btn-outline" onClick={onBack}>← Back</button><button className="btn btn-primary" onClick={next}>Next →</button></div>
    <dialog ref={dialog} className={s.deleteDialog} onCancel={() => setDeleting(null)}><h2>Delete this dish?</h2><p>{deleting?.name || "New dish"}</p><div className={s.actions}><button type="button" className="btn btn-outline" onClick={() => setDeleting(null)}>Keep dish</button><button type="button" className="btn btn-primary" onClick={() => { if (deleting) onRemoveDish(deleting.id); setDeleting(null); }}>Delete dish</button></div></dialog>
  </div>;
}
