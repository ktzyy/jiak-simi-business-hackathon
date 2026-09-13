import test from 'node:test';
import assert from 'node:assert/strict';
import {splitSharedExtras,withSharedExtras} from './shared-extras';
import {newDish,type GlobalAddonEdit} from './review-state';
const row:GlobalAddonEdit={id:'egg',name:'Egg',price:'1.00',included:true,sourceIds:[]};
test('shared extras apply only at preview and preserve custom add-ons and exclusions',()=>{
 const a={...newDish(),name:'Rice',price:'4.50',groups:[{id:'custom',name:'Extras',min:'0',max:'1',options:[{id:'sauce',name:'Sauce',price:'0.00'}]}]};
 const b={...newDish(),name:'Soup',price:'4.00'};
 const output=withSharedExtras([a,b],[row],[b.id],'shared');
 assert.equal(a.groups.length,1);assert.equal(output[0].groups.length,2);assert.equal(output[0].groups[0].id,'custom');assert.equal(output[1].groups.length,0);
 const restored=splitSharedExtras(output);assert.deepEqual(restored.rows[0].name,'Egg');assert.deepEqual(restored.excluded,[b.id]);assert.deepEqual(restored.dishes[0].groups,a.groups);
});
test('blank shared price blocks preview, unchecked extras do not',()=>{
 const dish={...newDish(),name:'Rice',price:'4.50'};
 assert.throws(()=>withSharedExtras([dish],[{...row,price:''}],[],'shared'),/Check the price/);
 assert.deepEqual(withSharedExtras([dish],[{...row,price:'',included:false}],[],'shared'),[dish]);
});
test('different dish-specific extras do not become shared',()=>{
 const a={...newDish(),groups:[{id:'one',name:'Extras',min:'0',max:'1',options:[{id:'egg',name:'Egg',price:'1.00'}]}]};
 const b={...newDish(),groups:[{id:'two',name:'Extras',min:'0',max:'1',options:[{id:'rice',name:'Rice',price:'0.50'}]}]};
 const restored=splitSharedExtras([a,b]);assert.equal(restored.rows.length,0);assert.deepEqual(restored.dishes,[a,b]);
});
