"use client";
/* eslint-disable @next/next/no-img-element -- User-selected menu images for source review. */
import { useState, type ReactNode } from "react";
import type { ExtractedMenuDraft } from "@/shared/extraction";
import { globalAddonRows, applyGlobalAddons, type DishEdit } from "./review-state";
import type { UploadedMenu } from "./menu-images";
import { DishOptions } from "./dish-options";
import s from "./onboarding.module.css";

export function MenuReview({ anyExtras, onAnyExtrasChange, dishes, draft, uploads, onDishChange, onConfirmDish, onAddDish, onRemoveDish, onContinue, onBack, renderDishPhoto }: {
  anyExtras: ReadonlySet<string>; onAnyExtrasChange: (id: string, enabled: boolean) => void;
  dishes: DishEdit[]; draft: ExtractedMenuDraft | null; uploads: UploadedMenu[];
  onDishChange: (id: string, patch: Partial<DishEdit>) => void; onConfirmDish: (id: string) => boolean;
  onAddDish: () => string; onRemoveDish: (id: string) => void; onContinue: () => void; onBack: () => void;
  renderDishPhoto: (dish: DishEdit) => ReactNode;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [globalRows, setGlobalRows] = useState(() => globalAddonRows(draft, dishes));
  const [globalGroupId] = useState(() => crypto.randomUUID());
  const [globalMessage, setGlobalMessage] = useState("");
  const [globalDirty, setGlobalDirty] = useState(() => globalRows.some(row => !row.price || !row.name));
  function updateGlobal(index: number, patch: Partial<(typeof globalRows)[number]>) { setGlobalRows(old => old.map((row, i) => i === index ? { ...row, ...patch } : row)); setGlobalDirty(true); setGlobalMessage(""); }
  function applyShared() {
    try {
      const next = applyGlobalAddons(dishes, globalRows, globalGroupId);
      for (const dish of next.dishes) onDishChange(dish.id, { groups: dish.groups });
      setGlobalDirty(false); setGlobalMessage(`Applied to ${next.dishes.length} dishes.`);
    } catch (error) { setGlobalMessage(error instanceof Error ? error.message : "Check your extras."); }
  }
  return <div className={s.stack}>
    <div className={s.reviewHeading}><span className={s.progress}>{dishes.filter(d => d.included).length} dishes</span></div>
    {!!uploads.length && <details className={s.original} open><summary>Your uploaded menu</summary>{uploads.map((upload, index) => <img key={upload.id} src={upload.url} alt={`Your uploaded menu ${index + 1}`} />)}</details>}
    {!dishes.length && <p className="notice">No dishes found. Add a dish or try a clearer photo.</p>}
    {draft?.issues.filter(issue => issue.itemId === null && !["human_review_required", "source_mapping_required", "unknown_price", "empty_menu"].includes(issue.code)).map(issue => <p className="notice" key={issue.id}>{issue.message}</p>)}
    <div className={s.dishes}>{dishes.map((dish, index) => {
      const item = draft?.items.find(item => item.id === dish.draftItemId);
      const source = draft?.sourceEntries?.find(entry => entry.id === item?.sourceEntryId);
      const isOpen = expanded === dish.id;
      return <article key={dish.id} className={`${s.dish} ${!dish.included ? s.excluded : ""}`}>
        <button className={s.dishSummary} onClick={() => setExpanded(isOpen ? null : dish.id)} aria-expanded={isOpen} aria-controls={`dish-${dish.id}`}>
          <span className={s.dishNumber}>{String(index + 1).padStart(2, "0")}</span>
          <span className={s.summaryMain}><strong>{dish.name || "New dish"}</strong><span className={s.modifierSummary}>{dish.groups.flatMap(group => group.options.map(option => <span className={s.modifierChip} key={option.id}>{option.name || "Unnamed extra"}{option.price ? ` · ${Number(option.price) < 0 ? "−" : "+"}S$${Math.abs(Number(option.price)).toFixed(2)}` : " · price needed"}</span>))}</span></span>
          <span className={s.summaryEnd}><strong>{dish.price ? `S$${dish.price}` : "Price needed"}</strong><span>{dish.included ? "Edit" : "Excluded"}</span></span><span aria-hidden="true">{isOpen ? "−" : "+"}</span>
        </button>
        {dish.included && renderDishPhoto(dish)}
        {source?.uncertainty && <p className="notice">{source.uncertainty}</p>}
        {isOpen && <div id={`dish-${dish.id}`} className={s.dishEditor}>
          {item && <p className={s.help}>On your menu: {item.name ?? "Name unclear"} · {item.rawPriceText ?? "Price unclear"}</p>}
          <label className={s.check}><input type="checkbox" checked={dish.included} onChange={e => onDishChange(dish.id, { included: e.target.checked })} />Include dish</label>
          {dish.included && <>
            <label className="field">Dish name<input value={dish.name} maxLength={120} onChange={e => onDishChange(dish.id, { name: e.target.value })} /></label>
            <label className="field">Price (S$)<input value={dish.price} inputMode="decimal" placeholder="4.50" onChange={e => onDishChange(dish.id, { price: e.target.value })} /></label>
            <label className={s.check}><input type="checkbox" checked={dish.available} onChange={e => onDishChange(dish.id, { available: e.target.checked })} />Available</label>
            <DishOptions anyExtras={anyExtras} onAnyExtrasChange={onAnyExtrasChange} groups={dish.groups} onChange={groups => onDishChange(dish.id, { groups })} />
          </>}
          <div className={s.actions}><button className="btn btn-teal" onClick={() => { if (onConfirmDish(dish.id)) setExpanded(null); }}>Done</button>{!dish.draftItemId && <button className="btn btn-outline" onClick={() => onRemoveDish(dish.id)}>Remove dish</button>}</div>
        </div>}
      </article>;
    })}</div>
    <button className={`btn btn-teal ${s.addDish}`} disabled={dishes.length >= 100} onClick={() => setExpanded(onAddDish())}>+ Add a dish</button>
    <section className={`card ${s.section}`}>
      <h2>Extras for all dishes</h2>
      {globalRows.map((row, index) => <div key={row.id} className={s.sharedOptionRow}>
        <label className={s.check}><input type="checkbox" checked={row.included} onChange={e => updateGlobal(index, { included: e.target.checked })} />Include</label>
        <label className="field">Extra<input maxLength={120} value={row.name} disabled={!row.included} onChange={e => updateGlobal(index, { name: e.target.value })} /></label>
        <label className="field">Price (S$)<input inputMode="decimal" value={row.price} disabled={!row.included} placeholder="0.00" onChange={e => updateGlobal(index, { price: e.target.value })} /></label>
      </div>)}
      <div className={s.actions}><button className="btn btn-outline" disabled={globalRows.length >= 20} onClick={() => { setGlobalRows(old => [...old, { id: crypto.randomUUID(), name: "", price: "", included: true, sourceIds: [] }]); setGlobalDirty(true); }}>+ Add extra</button>
      {!!globalRows.length && <button className="btn btn-teal" onClick={applyShared}>Apply to all dishes</button>}</div>
      {globalMessage && <p className="notice" role="status">{globalMessage}</p>}
    </section>
    <div className={s.actions}><button className="btn btn-outline" onClick={onBack}>← Back</button><button className="btn btn-primary" onClick={() => { if (globalDirty) { setGlobalMessage("Apply your extras before previewing."); return; } onContinue(); }}>Preview →</button></div>
  </div>;
}
