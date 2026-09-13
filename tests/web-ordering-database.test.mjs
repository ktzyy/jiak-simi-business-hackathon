import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const actor='a0000000-0000-4000-8000-000000000001',other='a0000000-0000-4000-8000-000000000002',restaurant='b0000000-0000-4000-8000-000000000001';
const menu={id:'c0000000-0000-4000-8000-000000000001',restaurantId:restaurant,version:1,currency:'SGD',name:'Joint test menu',dishes:[{id:'d0000000-0000-4000-8000-000000000001',name:'Char Siew Rice',priceCents:450,available:true,modifierGroups:[]},{id:'d0000000-0000-4000-8000-000000000002',name:'Braised Pork Knuckle Rice',priceCents:500,available:true,modifierGroups:[]}]};
const cart={restaurantId:restaurant,menuId:menu.id,menuVersion:1,fulfillmentType:'takeaway',lines:[{dishId:menu.dishes[0].id,quantity:2,optionIds:[]},{dishId:menu.dishes[1].id,quantity:1,optionIds:[]}]};
const details={name:'Joint stall',timezone:'Asia/Singapore',weeklyHours:Array.from({length:7},(_,n)=>({weekday:n+1,closed:false,intervals:[{opens:'09:00',closes:'20:00',closesNextDay:false}]}))};
const key='e0000000-0000-4000-8000-000000000001',doneKey='f0000000-0000-4000-8000-000000000001';
async function rpc(db,name,args){return Object.values((await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args)).rows[0])[0];}
async function setup(legacy=false){
 const db=new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;grant execute on function auth.uid() to public;");
 // Exercise this historical upgrade from its predecessors, not later migrations.
 for(const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f<'20260913053454_jiak_simi_web_ordering.sql').sort())await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.exec(`insert into auth.users(id) values('${actor}'),('${other}');insert into public.restaurants(id,name,slug) values('${restaurant}','Joint stall','joint');insert into public.restaurant_memberships(restaurant_id,user_id,role) values('${restaurant}','${actor}','owner');`);
 if(legacy){
  await rpc(db,'publish_menu',[restaurant,actor,JSON.stringify(menu)]);await rpc(db,'create_guest_session',[restaurant,'1'.repeat(64)]);
  const old={...cart};delete old.fulfillmentType;
  await rpc(db,'submit_order',['1'.repeat(64),JSON.stringify(old),1400,'web',key]);
 }
 const applied=await readFile(new URL('../supabase/migrations/20260913053454_jiak_simi_web_ordering.sql',import.meta.url),'utf8');
 assert.equal(applied,await readFile(new URL('../docs/web-ordering-extension.sql',import.meta.url),'utf8'));
 await db.exec(applied);
 if(!legacy){await rpc(db,'save_stall_details',[actor,restaurant,0,JSON.stringify(details)]);await rpc(db,'publish_menu',[restaurant,actor,JSON.stringify(menu),1]);await rpc(db,'create_guest_session',[restaurant,'1'.repeat(64)]);}
 return db;
}
test('required fulfillment reaches canonical price/receipt: 2 Char Siew plus 1 knuckle rice is 1400 for either mode',async()=>{
 const db=await setup();try{
  for(const mode of ['dine_in','takeaway']){const quote=await rpc(db,'quote_cart',['1'.repeat(64),JSON.stringify({...cart,fulfillmentType:mode})]);assert.equal(quote.totalCents,1400);assert.equal(quote.fulfillmentType,mode);}
  const missing={...cart};delete missing.fulfillmentType;
  await assert.rejects(rpc(db,'quote_cart',['1'.repeat(64),JSON.stringify(missing)]),/INVALID_CART/);
  await assert.rejects(rpc(db,'quote_cart',['1'.repeat(64),JSON.stringify({...cart,fulfillmentType:null})]),/INVALID_CART/);
  const t=await rpc(db,'submit_order',['1'.repeat(64),JSON.stringify(cart),1400,'web',key]);assert.equal(t.cart.fulfillmentType,'takeaway');assert.equal(t.statusVersion,1);assert.equal(t.completedAt,null);
  await assert.rejects(rpc(db,'submit_order',['1'.repeat(64),JSON.stringify({...cart,fulfillmentType:'dine_in'}),1400,'web',key]),/IDEMPOTENCY_CONFLICT/);
 }finally{await db.close();}
});
test('Done persists, same key replays before stale check, other stale tabs conflict and unpaid receipt stays immutable',async()=>{
 const db=await setup();try{
  const initial=await rpc(db,'submit_order',['1'.repeat(64),JSON.stringify(cart),1400,'web',key]);
  await assert.rejects(rpc(db,'complete_kitchen_order',[other,restaurant,initial.id,1,doneKey]),/FORBIDDEN/);
  const done=await rpc(db,'complete_kitchen_order',[actor,restaurant,initial.id,1,doneKey]);
  assert.equal(done.status,'done');assert.equal(done.statusVersion,2);assert.ok(done.completedAt);assert.equal(done.paymentStatus,'unpaid');
  assert.deepEqual(await rpc(db,'complete_kitchen_order',[actor,restaurant,initial.id,1,doneKey]),done);
  await assert.rejects(rpc(db,'complete_kitchen_order',[actor,restaurant,initial.id,2,doneKey]),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(rpc(db,'complete_kitchen_order',[actor,restaurant,initial.id,1,'f0000000-0000-4000-8000-000000000002']),/STALE_STATUS/);
  const queue=await rpc(db,'read_kitchen_orders',[restaurant,actor]);assert.deepEqual(queue.counts,{received:0,done:1,total:1});assert.deepEqual(queue.orders,[done]);
  assert.deepEqual(await rpc(db,'submit_order',['1'.repeat(64),JSON.stringify(cart),1400,'web',key]),initial);
  const stored=(await db.query('select status,payment_status,total_cents,cart from public.orders')).rows[0];assert.equal(stored.status,'received');assert.equal(stored.payment_status,'unpaid');assert.equal(Number(stored.total_cents),1400);
 }finally{await db.close();}
});
test('historical receipt keeps unknown fulfillment explicit and publication details remain unknown until review',async()=>{
 const db=await setup(true);try{
  const queue=await rpc(db,'read_kitchen_orders',[restaurant,actor]);assert.equal(queue.orders[0].cart.fulfillmentType,null);assert.equal(queue.orders[0].statusVersion,1);
  assert.equal((await rpc(db,'read_published_stall',[restaurant])).details,null);
  const old={...cart};delete old.fulfillmentType;
  const retry=await rpc(db,'submit_order',['1'.repeat(64),JSON.stringify(old),1400,'web',key]);assert.equal(retry.cart.fulfillmentType,null);
  assert.equal((await db.query("select cart ? 'fulfillmentType' present from public.orders")).rows[0].present,false);
 }finally{await db.close();}
});
test('hours updates require optimistic version and publication pins reviewed snapshot',async()=>{
 const db=await setup();try{
  assert.equal((await rpc(db,'read_published_stall',[restaurant])).details.version,1);
  const changed={...details,name:'Updated draft stall'};
  await rpc(db,'save_stall_details',[actor,restaurant,1,JSON.stringify(changed)]);
  await assert.rejects(rpc(db,'save_stall_details',[actor,restaurant,1,JSON.stringify(details)]),/STALE_STALL_DETAILS/);
  assert.equal((await rpc(db,'read_published_stall',[restaurant])).details.name,'Joint stall');
  await assert.rejects(rpc(db,'publish_menu',[restaurant,actor,JSON.stringify({...menu,version:2}),1]),/STALE_STALL_DETAILS/);
  await rpc(db,'publish_menu',[restaurant,actor,JSON.stringify({...menu,version:2}),2]);
  const current=await rpc(db,'read_published_stall',[restaurant]);assert.equal(current.details.version,2);assert.equal(current.details.name,'Updated draft stall');
  await assert.rejects(rpc(db,'publish_menu',[restaurant,actor,JSON.stringify({...menu,version:3})]),/does not exist/);
  await assert.rejects(db.exec("update private.stall_details_versions set details='{}'"),/IMMUTABLE_RECORD/);
 }finally{await db.close();}
});
test('SQL hours reject Sunday wrap overlap and malformed closure, allow touching split shifts',async()=>{
 const db=await setup();try{
  const overlap=structuredClone(details);overlap.weeklyHours[6].intervals=[{opens:'23:00',closes:'10:00',closesNextDay:true}];
  await assert.rejects(rpc(db,'save_stall_details',[actor,restaurant,1,JSON.stringify(overlap)]),/INVALID_STALL_DETAILS/);
  const closed=structuredClone(details);closed.weeklyHours[0].closed=true;
  await assert.rejects(rpc(db,'save_stall_details',[actor,restaurant,1,JSON.stringify(closed)]),/INVALID_STALL_DETAILS/);
  const touching=structuredClone(details);touching.weeklyHours[0].intervals=[{opens:'09:00',closes:'12:00',closesNextDay:false},{opens:'12:00',closes:'20:00',closesNextDay:false}];
  assert.equal((await rpc(db,'save_stall_details',[actor,restaurant,1,JSON.stringify(touching)])).details.version,2);
 }finally{await db.close();}
});
test('voice confirmation preserves explicit fulfillment and receipt recovery metadata',async()=>{
 const db=await setup();try{
  const v=await rpc(db,'create_voice_session',[actor,restaurant,'voice-mode-test']);const rev=await rpc(db,'begin_voice_review',[actor,v.id]);
  const r=await rpc(db,'save_voice_review',[actor,v.id,JSON.stringify(cart),rev.revision]);assert.equal(r.quote.fulfillmentType,'takeaway');
  const t=await rpc(db,'submit_voice_order',[actor,v.id,r.confirmationNonce]);assert.equal(t.cart.fulfillmentType,'takeaway');assert.equal(t.statusVersion,1);
  await rpc(db,'close_voice_session',[actor,v.id]);assert.deepEqual(await rpc(db,'submit_voice_order',[actor,v.id,r.confirmationNonce]),t);
 }finally{await db.close();}
});
test('new operational/hour tables deny browser writes and privileged RPCs',async()=>{
 const db=await setup();try{
  const tables=(await db.query("select c.relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('kitchen_order_state','kitchen_completion_requests','stall_details_versions','stall_details_current','menu_stall_details')")).rows;
  assert.equal(tables.length,5);assert.ok(tables.every(t=>t.relrowsecurity));
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(rpc(db,'complete_kitchen_order',[actor,restaurant,key,1,doneKey]),/permission denied/);await assert.rejects(db.query('select * from private.stall_details_versions'),/permission denied/);await db.exec('reset role');}
 }finally{await db.close();}
});
test('Telegram saves explicit mode and its confirmation replays without creating another ticket',async()=>{
 const db=await setup();try{
  const c=await rpc(db,'messaging_claim_update',['telegram','mode-bot',restaurant,'recipient','1','2'.repeat(64)]);
  const quote=await rpc(db,'quote_cart',[c.sessionTokenHash,JSON.stringify(cart)]);
  const pending={cart,quote,confirmationNonce:doneKey,idempotencyKey:key};
  await rpc(db,'messaging_complete_update',[c.conversationId,c.leaseId,'1',JSON.stringify({version:1,pending,lastTicket:null}),JSON.stringify({text:'Review takeaway',confirmationNonce:doneKey})]);
  const next=await rpc(db,'messaging_claim_update',['telegram','mode-bot',restaurant,'recipient','2','2'.repeat(64)]);
  const ticket=await rpc(db,'messaging_submit_order',[next.conversationId,next.leaseId,'2',doneKey]);
  assert.equal(ticket.cart.fulfillmentType,'takeaway');assert.equal(ticket.cart.totalCents,1400);assert.equal(ticket.statusVersion,1);
  assert.deepEqual(await rpc(db,'messaging_submit_order',[next.conversationId,next.leaseId,'2',doneKey]),ticket);
  assert.equal((await db.query('select count(*)::int n from public.orders')).rows[0].n,1);
 }finally{await db.close();}
});
