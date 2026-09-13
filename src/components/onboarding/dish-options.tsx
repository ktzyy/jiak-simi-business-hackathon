"use client";

import type { GroupEdit } from "./review-state";
import s from "./onboarding.module.css";

function selectionRule(group: GroupEdit) {
  if (group.min === "0" && group.max === "1") return "optional-one";
  if (group.min === "0" && Number(group.max) === group.options.length) return "any";
  if (group.min === "1" && group.max === "1") return "required-one";
  return "custom";
}

export function DishOptions({ groups, onChange, anyExtras, onAnyExtrasChange }: { groups: GroupEdit[]; onChange: (groups: GroupEdit[]) => void; anyExtras: ReadonlySet<string>; onAnyExtrasChange: (id: string, enabled: boolean) => void }) {
  function patch(id: string, value: Partial<GroupEdit>) { onChange(groups.map(group => group.id === id ? { ...group, ...value } : group)); }
  function add(kind: "extras" | "choice") {
    const id = crypto.randomUUID();
    if (kind === "extras") onAnyExtrasChange(id, true);
    onChange([...groups, {
      id, name: kind === "extras" ? "Extras for this dish" : "Choose your noodles",
      min: kind === "extras" ? "0" : "1", max: "1",
      options: kind === "extras" ? [{ id: crypto.randomUUID(), name: "", price: "" }] : [
        { id: crypto.randomUUID(), name: "", price: "0.00" }, { id: crypto.randomUUID(), name: "", price: "0.00" },
      ],
    }]);
  }
  return <>
    <div className={s.modifierHeading}><h3>Extras & choices</h3></div>
    <div className={s.optionActions}>
      <button className="btn btn-teal" disabled={groups.length >= 20} onClick={() => add("extras")}>+ Add an extra</button>
      <button className="btn btn-outline" disabled={groups.length >= 20} onClick={() => add("choice")}>+ Ask a question</button>
    </div>
    {groups.map(group => {
      const rule = anyExtras.has(group.id) && group.min === "0" && Number(group.max) === group.options.length ? "any" : selectionRule(group);
      return <fieldset className={s.modifierGroup} key={group.id}>
        <legend>{group.name || "Customer options"}</legend>
        <div className={s.groupTitle}><label className="field">Heading<input value={group.name} maxLength={120} placeholder="e.g. Extras or Choose your noodles" onChange={e => patch(group.id, { name: e.target.value })} /></label><button className={s.delete} onClick={() => onChange(groups.filter(g => g.id !== group.id))} aria-label={`Remove ${group.name || "customer options"}`}>×</button></div>
        {group.options.map(option => <div key={option.id} className={s.optionRow}>
          <label className="field">{rule === "required-one" ? "Choice" : "Option"}<input value={option.name} maxLength={120} placeholder={rule === "required-one" ? "e.g. Yellow noodles" : "e.g. Add Char Siew"} onChange={e => patch(group.id, { options: group.options.map(o => o.id === option.id ? { ...o, name: e.target.value } : o) })} /></label>
          <label className="field">Extra price (S$)<input value={option.price} inputMode="decimal" placeholder="0.00 if free" onChange={e => patch(group.id, { options: group.options.map(o => o.id === option.id ? { ...o, price: e.target.value } : o) })} /></label>
          <button className={s.delete} aria-label={`Remove ${option.name || "option"}`} onClick={() => { const options = group.options.filter(o => o.id !== option.id); patch(group.id, { options, max: String(Math.min(Number(group.max), options.length)) }); }}>×</button>
        </div>)}
        <button className={`btn btn-outline ${s.addOption}`} disabled={group.options.length >= 20} onClick={() => patch(group.id, { options: [...group.options, { id: crypto.randomUUID(), name: "", price: "" }], ...(rule === "any" ? { max: String(group.options.length + 1) } : {}) })}>+ Add option</button>
        <label className={`field ${s.selectionRule}`}>Customer can choose
          <select aria-label="Customer can choose" value={rule} onChange={e => { onAnyExtrasChange(group.id, e.target.value === "any"); if (e.target.value === "any") patch(group.id, { min: "0", max: String(group.options.length) }); if (e.target.value === "optional-one") patch(group.id, { min: "0", max: "1" }); if (e.target.value === "required-one") patch(group.id, { min: "1", max: "1" }); }}>
            <option value="any">Any · optional</option><option value="optional-one">One · optional</option><option value="required-one">One · required</option>{rule === "custom" && <option value="custom">Your custom selection rule</option>}
          </select>
        </label>
        <details className={s.advancedRules} open={rule === "custom" ? true : undefined}><summary>More choice settings</summary><div className={s.rules}>
          <label className="field">At least<input type="number" min="0" max="20" value={group.min} onChange={e => patch(group.id, { min: e.target.value })} /></label>
          <label className="field">At most<input type="number" min="0" max={Math.min(group.options.length, 20)} value={group.max} onChange={e => patch(group.id, { max: e.target.value })} /></label>
        </div><p className={s.help}>Use 0 for “at least” if customers can skip this question.</p></details>
      </fieldset>;
    })}
  </>;
}
