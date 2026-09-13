import { applyGlobalAddons, type DishEdit, type GlobalAddonEdit, type GroupEdit } from './review-state';

const signature = (group: GroupEdit) => JSON.stringify({min:group.min,max:group.max,options:group.options.map(o=>({name:o.name,price:o.price}))});
export function splitSharedExtras(dishes: DishEdit[]) {
  const candidates = dishes.flatMap(d=>d.groups.filter(g=>g.min==='0' && Number(g.max)===g.options.length && /^(extras for all dishes|additional ingredients|add-ons|extras)$/i.test(g.name)));
  const common = candidates.map(group=>({group,count:dishes.filter(d=>d.groups.some(g=>signature(g)===signature(group)&&g.name===group.name)).length})).sort((a,b)=>Number(b.group.name==='Extras for all dishes')-Number(a.group.name==='Extras for all dishes')||b.count-a.count)[0];
  if (!common || (common.count<2 && common.group.name!=='Extras for all dishes')) return {dishes,rows:[] as GlobalAddonEdit[],excluded:[] as string[]};
  const matches=(group:GroupEdit)=>group.name===common.group.name&&signature(group)===signature(common.group);
  return {
    dishes:dishes.map(d=>({...d,groups:d.groups.filter(g=>!matches(g))})),
    rows:common.group.options.map(o=>({...o,included:true,sourceIds:[]})),
    excluded:dishes.filter(d=>!d.groups.some(matches)).map(d=>d.id),
  };
}
export function withSharedExtras(dishes:DishEdit[],rows:GlobalAddonEdit[],excluded:readonly string[],groupId:string):DishEdit[] {
  if (!rows.some(row=>row.included)) return dishes;
  // Validate shared rows independently; never replace a dish's custom groups.
  const shared=applyGlobalAddons(dishes.map(d=>({...d,groups:[]})),rows,groupId).dishes[0]?.groups[0];
  return dishes.map(d=>excluded.includes(d.id)||!shared?d:{...d,groups:[...d.groups,{...shared,name:'Extras for all dishes'}]});
}
