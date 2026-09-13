import test from "node:test";
import assert from "node:assert/strict";
import { validCrop, mergeExtractions } from "./menu-images";
import { menuFromEdits, hoursSummary, emptyHours, newDish } from "./review-state";
import { allHoursMatch } from "./hours-presentation";

test("crop boundaries cannot select unrelated out-of-image pixels", () => {
 assert.equal(validCrop({x:0.8,y:0,width:0.3,height:1}),false);
 assert.equal(validCrop({x:0,y:0,width:0,height:1}),false);
 assert.equal(validCrop({x:0.1,y:0.2,width:0.3,height:0.4}),true);
 assert.throws(() => mergeExtractions([]), /every uploaded/);
});
test("equal daily hours group regardless of the same-hours toggle", () => {
 const hours=Array.from({length:7},()=>({...emptyHours(),start:"09:00",end:"18:00"}));
 assert.equal(hoursSummary(hours,false),"Mon–Sun 9:00 am–6:00 pm");
 assert.equal(allHoursMatch(hours),true);
 hours[5].closed=true;hours[6].closed=true;
 assert.equal(hoursSummary(hours,false),"Mon–Fri 9:00 am–6:00 pm · Sat–Sun Closed");
 assert.equal(allHoursMatch(hours),false);
});
test("preview preserves edits and blocks unknown prices without confirmation essays", () => {
 const dish={...newDish(),name:"Rice",price:"4.50"};
 const input={dishes:[dish],id:crypto.randomUUID(),restaurantId:crypto.randomUUID(),version:1,name:"Stall"};
 assert.equal(menuFromEdits(input).dishes[0].priceCents,450);
 assert.throws(()=>menuFromEdits({...input,dishes:[{...dish,price:""}]}),/price/);
 assert.equal(menuFromEdits({...input,dishes:[dish,{...newDish(),included:false}]}).dishes.length,1);
});
