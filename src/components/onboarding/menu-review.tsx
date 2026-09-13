"use client";

/* eslint-disable @next/next/no-img-element -- Local user-selected Blob URLs are displayed unchanged for source review. */

import { useState } from "react";
import type { ExtractedMenuDraft } from "@/shared/extraction";
import { globalAddonRows, applyGlobalAddons, dollars, type DishEdit, type SourceDecision } from "./review-state";
import { cleanDemoAddons } from "./demo-draft";
import { DishOptions } from "./dish-options";
import { DishPhotoComparison } from "./dish-photo-comparison";
import s from "./onboarding.module.css";

export function MenuReview({ anyExtras, onAnyExtrasChange, restaurantId, quickDemo = false, dishes, draft, sources, issues, sample, photoUrl, onDishChange, onConfirmDish, onConfirmAll, onAddDish, onRemoveDish, onSourceChange, onIssueChange, onContinue, onBack }: {
  anyExtras: ReadonlySet<string>; onAnyExtrasChange: (id: string, enabled: boolean) => void; restaurantId: string; quickDemo?: boolean; dishes: DishEdit[]; draft: ExtractedMenuDraft | null; sources: Record<string, SourceDecision>; issues: Record<string, string>; sample: boolean; photoUrl: string | null;
  onDishChange: (id: string, patch: Partial<DishEdit>) => void; onConfirmDish: (id: string) => boolean; onConfirmAll: () => boolean; onAddDish: () => string; onRemoveDish: (id: string) => void;
  onSourceChange: (id: string, value: SourceDecision) => void; onIssueChange: (id: string, value: string) => void; onContinue: (dishes?: DishEdit[]) => void; onBack: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bulkChecked, setBulkChecked] = useState(false);
  const [globalRows, setGlobalRows] = useState(() => {
    const source = quickDemo && draft ? { ...draft, sourceEntries: draft.sourceEntries?.filter(entry => entry.currency === "SGD" && !entry.priceUncertain) } : draft;
    const rows = globalAddonRows(source, dishes);
    return quickDemo ? cleanDemoAddons(rows) : rows;
  });
  const [globalGroupId] = useState(() => crypto.randomUUID());
  const [globalMessage, setGlobalMessage] = useState("");
  const [globalDirty, setGlobalDirty] = useState(false);
  function updateGlobal(index: number, patch: Partial<(typeof globalRows)[number]>) { setGlobalRows(old => old.map((row, i) => i === index ? { ...row, ...patch } : row)); setGlobalDirty(true); setGlobalMessage(""); }
  function applyShared() {
    try {
      const next = applyGlobalAddons(dishes, globalRows, globalGroupId);
      for (const dish of next.dishes) onDishChange(dish.id, { groups: dish.groups });
      for (const [id, decision] of Object.entries(next.sources)) onSourceChange(id, decision);
      for (const issue of draft?.issues ?? []) {
        const sourceId = Object.keys(next.sources).find(id => issue.message.includes(id));
        if (sourceId && ["source_mapping_required", "unknown_price"].includes(issue.code)) onIssueChange(issue.id, next.sources[sourceId].reason);
      }
      setBulkChecked(false); setGlobalDirty(false);
      setGlobalMessage(`Extras updated on ${next.dishes.length} dishes. ${quickDemo ? "You can preview your menu now." : "Check the updated cards, then confirm below."}`);
    } catch (error) { setGlobalMessage(error instanceof Error ? error.message : "Check your add-ons."); }
  }
  const confirmed = dishes.filter(d => d.confirmed).length;
  const extraSources = (draft?.sourceEntries ?? []).filter(source => !draft?.items.some(item => item.sourceEntryId === source.id));
  return <div className={s.stack}>
    {sample && <div className="notice"><strong>Saved extraction example · not approved</strong><p>This is a separate sample menu. Check it against its original source before using it for a real stall.</p></div>}
    <div className={s.reviewHeading}><div><h2>A quick check, then you’re ready.</h2><p>Names and prices first. Add extras like more rice or a choice of noodles where needed.</p></div><span className={s.progress}>{quickDemo ? `${dishes.length} dishes` : `${confirmed} of ${dishes.length} checked`}</span></div>
    {photoUrl && <details className={s.original}><summary>Keep the original menu photo handy</summary>{/* User-selected local Blob URL. */}<img src={photoUrl} alt="Original menu photo for reviewing names, prices and options" /></details>}
    {quickDemo && <p className="notice">Unclear entries are skipped for this demo. Edit anything you like, then preview and publish.</p>}
    <p className={s.help}>Extracted English names start in title case, like “Char Siew Rice”. You can change the spelling. You can compare each matched dish’s original demo photo with its polished version below. These are prepared demo photos.</p>
    {dishes.length === 0 && <div className="notice"><h3>No dishes came through</h3><p>You can add your dishes below, or go back and try a clearer photo.</p></div>}
    <div className={s.dishes}>{dishes.map((dish, index) => {
      const item = draft?.items.find(item => item.id === dish.draftItemId);
      const source = draft?.sourceEntries?.find(entry => entry.id === item?.sourceEntryId);
      const isOpen = expanded === dish.id;
      return <article key={dish.id} className={`${s.dish} ${!dish.included ? s.excluded : ""}`}>
        <div className={s.dishOverview}><DishPhotoComparison restaurantId={restaurantId} dish={dish} />
        <button className={s.dishSummary} onClick={() => setExpanded(isOpen ? null : dish.id)} aria-expanded={isOpen} aria-controls={`dish-${dish.id}`}>
          <span className={s.dishNumber}>{String(index + 1).padStart(2, "0")}</span><span className={s.summaryMain}><strong>{dish.name || "New dish"}</strong><span className={s.modifierSummary}>{dish.groups.flatMap(group => group.options.map(option => <span className={s.modifierChip} key={option.id}>{option.name || "Unnamed extra"}{option.price ? ` · ${Number(option.price) < 0 ? "−" : "+"}S$${Math.abs(Number(option.price)).toFixed(2)}` : " · price needed"}</span>))}{!dish.groups.length && <span className={s.noExtras}>No extras added</span>}</span></span><span className={s.summaryEnd}><strong>{dish.price ? `S$${dish.price}` : "Price needed"}</strong><span>{!dish.included ? "Left out" : quickDemo ? "Edit" : dish.confirmed ? "✓ Checked" : "Check details"}</span></span><span aria-hidden="true">{isOpen ? "−" : "+"}</span>
        </button></div>
        {isOpen && <div id={`dish-${dish.id}`} className={s.dishEditor}>
          {!quickDemo && item && <details className={s.sourceReference}><summary>Original wording</summary><p>{item.name ?? "Name unclear"} · {item.rawPriceText ?? "Price unclear"}</p>{source?.uncertainty && <p>{source.uncertainty}</p>}</details>}
          <label className={s.check}><input type="checkbox" checked={dish.included} onChange={e => onDishChange(dish.id, { included: e.target.checked })} />Include this dish on my menu</label>
          {dish.included ? <>
            <label className="field">Dish name<input value={dish.name} maxLength={120} onChange={e => onDishChange(dish.id, { name: e.target.value })} /></label>
            <label className="field">Price (S$)<input value={dish.price} inputMode="decimal" placeholder="e.g. 4.50" onChange={e => onDishChange(dish.id, { price: e.target.value })} /></label>
            <label className={s.check}><input type="checkbox" checked={dish.available} onChange={e => onDishChange(dish.id, { available: e.target.checked })} />Available to order</label>
            <DishOptions anyExtras={anyExtras} onAnyExtrasChange={onAnyExtrasChange} groups={dish.groups} onChange={groups => onDishChange(dish.id, { groups })} />
          </> : !quickDemo && <label className="field">Why leave this entry out?<textarea value={dish.reason} maxLength={1000} onChange={e => onDishChange(dish.id, { reason: e.target.value })} placeholder="e.g. A repeated heading, not a dish for sale" /></label>}
          <div className={s.actions}><button className="btn btn-teal" onClick={() => { if (onConfirmDish(dish.id)) { setExpanded(null); setBulkChecked(false); } }}>Done with this dish</button>{!dish.draftItemId && <button className="btn btn-outline" onClick={() => onRemoveDish(dish.id)}>Remove dish</button>}</div>
        </div>}
      </article>;
    })}</div>
    <button className={`btn btn-teal ${s.addDish}`} disabled={dishes.length >= 100} onClick={() => setExpanded(onAddDish())}>+ Add a dish</button>
    <section className={`card ${s.section}`}>
      <p className="eyebrow">Extras for all dishes</p><h2>Set your extras once.</h2>
      <p>Offer the same extras across your menu? Add them here once. Customers can pick any they like. For extras on just one dish, open that dish above.</p>
      {globalRows.map((row, index) => <div key={row.id} className={s.sharedOptionRow}>
        <label className={s.check}><input type="checkbox" checked={row.included} onChange={e => updateGlobal(index, { included: e.target.checked })} />Include</label>
        <label className="field">Extra name<input maxLength={120} value={row.name} disabled={!row.included} onChange={e => updateGlobal(index, { name: e.target.value })} /></label>
        <label className="field">Extra price (S$)<input inputMode="decimal" value={row.price} disabled={!row.included} placeholder="Price needed" onChange={e => updateGlobal(index, { price: e.target.value })} /></label>
      </div>)}
      <button className="btn btn-outline" disabled={globalRows.length >= 100} onClick={() => { setGlobalRows(old => [...old, { id: crypto.randomUUID(), name: "", price: "", included: true, sourceIds: [] }]); setGlobalDirty(true); }}>+ Add another extra</button>
      <p className={s.help}>Each extra is optional. Uncheck duplicates and fill in any missing prices.</p>
      <button className="btn btn-teal" disabled={!globalRows.length} onClick={applyShared}>Apply extras to all dishes</button>
      <p className={s.help}>Applying replaces the shared extras on every dish. You can then fine-tune an individual dish above. Questions and dish-only extras stay as they are.</p>
      {globalMessage && <p className="notice" role="status">{globalMessage}</p>}
    </section>
    {!quickDemo && <div className={`card ${s.section}`}><h3>Everything above looks right?</h3><p>No need to open each card if the names, prices and options are already correct.</p><label className={s.check}><input type="checkbox" checked={bulkChecked} onChange={e => setBulkChecked(e.target.checked)} />I’ve checked every dish above, including prices and extras.</label><button className="btn btn-teal" disabled={!bulkChecked || !dishes.length} onClick={() => { if (onConfirmAll()) { setBulkChecked(false); setExpanded(null); } }}>Confirm all checked dishes</button></div>}

    {!quickDemo && !!extraSources.length && <section className={`card ${s.section}`}><p className="eyebrow">A few things to clarify</p><h2>Where do these belong?</h2><p>We keep each printed entry separate, even when the words repeat. Decide which dishes it applies to, or explain why it should be left out.</p>{extraSources.map(source => {
      const decision = sources[source.id] ?? { dishIds: [], reason: "", confirmed: false };
      return <details className={s.source} key={source.id} open={!decision.confirmed}>
        <summary>{decision.confirmed ? "✓ " : "○ "}{source.name ?? source.kind} · {source.rawPriceText ?? "Price unclear"}<span>{source.region}</span></summary>
        <div className={s.sourceBody}><p>{source.description}</p><p><strong>{source.kind}</strong> · {source.currency} · {source.priceCents === null ? "Price needs checking" : `S$${dollars(source.priceCents)}`}</p>{source.uncertainty && <p className="notice">{source.uncertainty}</p>}
          <fieldset className={s.assign}><legend>Applies to these dishes</legend>{dishes.filter(d => d.included).map(dish => <label className={s.check} key={dish.id}><input type="checkbox" checked={decision.dishIds.includes(dish.id)} onChange={e => onSourceChange(source.id, { ...decision, confirmed: false, dishIds: e.target.checked ? [...decision.dishIds, dish.id] : decision.dishIds.filter(id => id !== dish.id) })} />{dish.name || "Unnamed dish"}</label>)}</fieldset>
          <p className={s.help}>Use “Set your extras once” above to apply shared add-ons and record these source decisions together. For a dish-specific exception, edit its card and confirm its source decision here. Leave all unchecked if you’re excluding this entry.</p>
          <label className="field">What did you decide, and why?<textarea value={decision.reason} maxLength={1000} placeholder="e.g. Rice at 50¢ is an optional extra for these soups. I added it to their options." onChange={e => onSourceChange(source.id, { ...decision, confirmed: false, reason: e.target.value })} /></label>
          <button className="btn btn-teal" disabled={!decision.reason.trim()} onClick={() => onSourceChange(source.id, { ...decision, confirmed: true })}>Confirm this entry</button>
        </div>
      </details>;
    })}</section>}

    {!quickDemo && !!draft?.issues.length && <section className={`card ${s.section}`}><h2>One last check</h2><p>Tell us how you resolved each highlighted point. Your menu stays private until you confirm and publish.</p>{draft.issues.map(issue => <div className={s.issue} key={issue.id}><strong>{issue.blocking ? "Check required" : "For your attention"}</strong><p>{issue.code === "source_mapping_required" ? "Check the extra printed entry and record where it belongs above." : issue.message}</p>{issue.code === "source_mapping_required" && <details><summary>See the original extraction note</summary><p>{issue.message}</p></details>}{issue.blocking && <label className="field">What did you check or change?<textarea value={issues[issue.id] ?? ""} maxLength={1000} placeholder="Write your review decision here" onChange={e => onIssueChange(issue.id, e.target.value)} /></label>}</div>)}</section>}
    <div className={s.actions}><button className="btn btn-outline" onClick={onBack}>← Back</button><button className="btn btn-primary" onClick={() => { if (globalDirty) { setGlobalMessage("Apply your edited extras to all dishes before previewing."); return; } onContinue(); }}>Preview my menu →</button></div>
  </div>;
}
