"use client";

import type { GroupEdit } from "./review-state";
import s from "./onboarding.module.css";

const PRESETS = ["Noodles", "Extras", "Chilli", "Size", "Sides"];
function selectionRule(group: GroupEdit) {
  if (group.min === "0" && group.max === "1") return "optional-one";
  if (group.min === "0" && Number(group.max) === group.options.length) return "any";
  if (group.min === "1" && group.max === "1") return "required-one";
  return "custom";
}
export function DishOptions({ groups, onChange, anyExtras, onAnyExtrasChange }: { groups: GroupEdit[]; onChange: (groups: GroupEdit[]) => void; anyExtras: ReadonlySet<string>; onAnyExtrasChange: (id: string, enabled: boolean) => void }) {
  function patch(id: string, value: Partial<GroupEdit>) { onChange(groups.map(group => group.id === id ? { ...group, ...value } : group)); }
  function add() {
    const id = crypto.randomUUID(); onAnyExtrasChange(id, true);
    onChange([...groups, { id, name: "Extras", min: "0", max: "1", options: [{ id: crypto.randomUUID(), name: "", price: "0.00" }] }]);
  }
  return <section aria-label="Add-ons">
    <div className={s.modifierHeading}><h3>Add-ons</h3><button type="button" className="btn btn-outline" disabled={groups.length >= 20} onClick={add}>+ Add-ons</button></div>
    {groups.map(group => {
      const rule = anyExtras.has(group.id) && group.min === "0" && Number(group.max) === group.options.length ? "any" : selectionRule(group);
      return <fieldset className={s.addonCard} key={group.id} aria-label={group.name || "Add-ons group"}>
        <div className={s.addonHeader}>
          <label className="field"><span className={s.srOnly}>Heading preset</span><select aria-label="Heading preset" value={PRESETS.includes(group.name) ? group.name : "custom"} onChange={e => patch(group.id, { name: e.target.value === "custom" ? "" : e.target.value })}>{PRESETS.map(name => <option key={name}>{name}</option>)}<option value="custom">Custom heading</option></select></label>
          <button type="button" className={s.addonDelete} onClick={() => { onAnyExtrasChange(group.id, false); onChange(groups.filter(g => g.id !== group.id)); }} aria-label={`Delete ${group.name || "add-ons"} group`}>Delete group</button>
        </div>
        {!PRESETS.includes(group.name) && <label className="field"><span className={s.srOnly}>Heading</span><input aria-label="Heading" value={group.name} maxLength={120} placeholder="Heading" onChange={e => patch(group.id, { name: e.target.value })} /></label>}
        <div className={s.addonColumns} aria-hidden="true"><span>Option</span><span>Price (S$)</span><span /></div>
        {group.options.map((option, index) => <div key={option.id} className={s.addonRow}>
          <label className="field"><span className={s.srOnly}>Option {index + 1}</span><input value={option.name} maxLength={120} placeholder="Add an option" onChange={e => patch(group.id, { options: group.options.map(o => o.id === option.id ? { ...o, name: e.target.value } : o) })} /></label>
          <label className="field"><span className={s.srOnly}>Extra price (S$)</span><input value={option.price} inputMode="decimal" placeholder="0.00" onChange={e => patch(group.id, { options: group.options.map(o => o.id === option.id ? { ...o, price: e.target.value } : o) })} /></label>
          <button type="button" className={s.addonRemove} aria-label={`Remove ${option.name || `option ${index + 1}`}`} onClick={() => { const options = group.options.filter(o => o.id !== option.id); patch(group.id, { options, ...(rule === "any" ? { max: String(options.length) } : {}) }); }}>×</button>
        </div>)}
        <button type="button" className={s.textAction} disabled={group.options.length >= 20} onClick={() => patch(group.id, { options: [...group.options, { id: crypto.randomUUID(), name: "", price: "0.00" }], ...(rule === "any" ? { max: String(group.options.length + 1) } : {}) })}>+ Add option</button>
        <div className={s.addonFooter}><label className="field">Customer can choose<select value={rule} onChange={e => { onAnyExtrasChange(group.id, e.target.value === "any"); if (e.target.value === "any") patch(group.id, { min: "0", max: String(group.options.length) }); if (e.target.value === "optional-one") patch(group.id, { min: "0", max: "1" }); if (e.target.value === "required-one") patch(group.id, { min: "1", max: "1" }); }}><option value="any">Multiple · optional</option><option value="optional-one">One · optional</option><option value="required-one">One · required</option>{rule === "custom" && <option value="custom">Custom rule</option>}</select></label>
        <details className={s.advancedRules} open={rule === "custom" ? true : undefined}><summary>Limits</summary><div className={s.rules}><label className="field">At least<input type="number" min="0" max="20" value={group.min} onChange={e => patch(group.id, { min: e.target.value })} /></label><label className="field">At most<input type="number" min="0" max={Math.min(group.options.length, 20)} value={group.max} onChange={e => patch(group.id, { max: e.target.value })} /></label></div></details></div>
      </fieldset>;
    })}
  </section>;
}
