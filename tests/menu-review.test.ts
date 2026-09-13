import assert from "node:assert/strict";
import test from "node:test";
import { OCR_DRAFT_FIXTURE } from "../src/shared/ocr-fixtures";
import { buildReviewedMenu, type MenuExtractionReview } from "../src/shared/menu-review";
const restaurant="b0000000-0000-4000-8000-000000000001",menuId="c0000000-0000-4000-8000-000000000001";
function reviewed():MenuExtractionReview {
 const d=OCR_DRAFT_FIXTURE;
 return {draftId:d.id,confirmed:true,menu:{id:menuId,restaurantId:restaurant,version:1,currency:"SGD",name:"Reviewed soup menu",dishes:d.items.map(i=>({id:i.id,name:i.name!,priceCents:i.priceCents!,available:true,modifierGroups:[]}))},
 itemResolutions:d.items.map(i=>({draftItemId:i.id,dishId:i.id,reason:"Merchant checked name and price"})),
 sourceResolutions:d.sourceEntries!.map(s=>({sourceEntryId:s.id,dishIds:d.items.filter(i=>i.sourceEntryId===s.id).map(i=>i.id),reason:s.kind==="addon"?"Rice intentionally omitted until applicability is confirmed":"Merchant checked source pairing"})),
 issueResolutions:d.issues.filter(i=>i.blocking).map(i=>({issueId:i.id,reason:"Merchant reviewed displayed values and explicitly excluded rice"})),manualDishIds:[]};
}
test("reviewed source-linked draft becomes valid menu only after explicit decisions",()=>{
 assert.equal(buildReviewedMenu(OCR_DRAFT_FIXTURE,reviewed()).dishes.length,16);
 assert.equal(OCR_DRAFT_FIXTURE.status,"needs_review");
});
test("null price cannot become a published zero or guessed price",()=>{
 const review=reviewed();
 const invalid={...review,menu:{...review.menu,dishes:[{...review.menu.dishes[0],priceCents:null}]}};
 assert.throws(()=>buildReviewedMenu(OCR_DRAFT_FIXTURE,invalid),{code:"MENU_REVIEW_REQUIRED"});
});
test("unresolved source or blocking issues prevent conversion",()=>{
 for(const field of ["sourceResolutions","issueResolutions","itemResolutions"] as const){
  const review=reviewed();review[field]=[];
  assert.throws(()=>buildReviewedMenu(OCR_DRAFT_FIXTURE,review),{code:"MENU_REVIEW_REQUIRED"});
 }
});
test("wrong source pairing and duplicate resolutions cannot pass",()=>{
 const review=reviewed();const source=review.sourceResolutions.find(s=>s.dishIds.length)!;source.dishIds=[];
 assert.throws(()=>buildReviewedMenu(OCR_DRAFT_FIXTURE,review),{code:"MENU_REVIEW_REQUIRED"});
 const duplicate=reviewed();duplicate.itemResolutions[1]=duplicate.itemResolutions[0];
 assert.throws(()=>buildReviewedMenu(OCR_DRAFT_FIXTURE,duplicate),{code:"MENU_REVIEW_REQUIRED"});
});
test("fresh extraction invalidates earlier review decisions",()=>{
 const d={...OCR_DRAFT_FIXTURE,id:"00000000-0000-4000-8000-000000000001"};
 assert.throws(()=>buildReviewedMenu(d,reviewed()),{code:"MENU_REVIEW_REQUIRED"});
});
