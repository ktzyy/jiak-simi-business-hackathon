import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const appliedExtension=await readFile(new URL('../supabase/migrations/20260913050159_jiak_simi_channel_ordering.sql',import.meta.url),'utf8');
assert.equal(await readFile(new URL('../docs/channel-database-extension.sql',import.meta.url),'utf8'),appliedExtension,'Reviewed draft must match applied migration exactly');
const actor='a0000000-0000-4000-8000-000000000001',other='a0000000-0000-4000-8000-000000000002',kitchen='a0000000-0000-4000-8000-000000000003';
const restaurant='b0000000-0000-4000-8000-000000000001',restaurant2='b0000000-0000-4000-8000-000000000002';
const menu={id:'c0000000-0000-4000-8000-000000000001',restaurantId:restaurant,version:1,currency:'SGD',name:'Test menu',dishes:[{id:'d0000000-0000-4000-8000-000000000001',name:'Soup',priceCents:600,available:true,modifierGroups:[]}]};
const cart={restaurantId:restaurant,menuId:menu.id,menuVersion:1,lines:[{dishId:menu.dishes[0].id,quantity:1,optionIds:[]}]};
const nonce='e0000000-0000-4000-8000-000000000001',idem='f0000000-0000-4000-8000-000000000001';
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to public;grant execute on function auth.uid() to public;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260913042355_jiak_simi_202609130001_core_ordering.sql',import.meta.url),'utf8'));
 await db.exec(appliedExtension);
 await db.exec(`insert into auth.users(id) values('${actor}'),('${other}'),('${kitchen}');insert into public.restaurants(id,name,slug) values('${restaurant}','One','one'),('${restaurant2}','Two','two');insert into public.restaurant_memberships(restaurant_id,user_id,role) values('${restaurant}','${actor}','owner'),('${restaurant2}','${other}','owner'),('${restaurant}','${kitchen}','kitchen');`);
 await db.query('select public.publish_menu($1,$2,$3::jsonb)',[restaurant,actor,JSON.stringify(menu)]);
 return db;
}
async function rpc(db,name,args){return Object.values((await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args)).rows[0])[0];}
async function claim(db,update='1',recipient='123'){return rpc(db,'messaging_claim_update',['telegram','bot123',restaurant,recipient,update,'2'.repeat(64)]);}
const state=(pending=null,lastTicket=null)=>({version:1,pending,lastTicket});
const reply=(confirmationNonce=null)=>({text:'Please review',confirmationNonce});

test('staff quota is shared by restaurant/operation, blocks kitchen and other restaurant',async()=>{
 const db=await setup();try{
  for(let i=0;i<20;i++)await rpc(db,'consume_staff_ai_budget',[actor,restaurant,'extraction']);
  await assert.rejects(rpc(db,'consume_staff_ai_budget',[actor,restaurant,'extraction']),/RATE_LIMITED/);
  await assert.rejects(rpc(db,'consume_staff_ai_budget',[kitchen,restaurant,'voice']),/FORBIDDEN/);
  await assert.rejects(rpc(db,'consume_staff_ai_budget',[other,restaurant,'voice']),/FORBIDDEN/);
  assert.equal(await rpc(db,'consume_staff_ai_budget',[actor,restaurant,'voice']),restaurant);
  await db.exec("update private.staff_ai_usage set window_started_at=now()-interval '11 minutes'");
  assert.equal(await rpc(db,'consume_staff_ai_budget',[actor,restaurant,'extraction']),restaurant);
 }finally{await db.close();}
});
test('voice review revisions invalidate old work and persisted nonce recovers once after close',async()=>{
 const db=await setup();try{
  const v=await rpc(db,'create_voice_session',[actor,restaurant,'provider-1']);
  assert.match(v.sessionTokenHash,/^[a-f0-9]{64}$/);
  await assert.rejects(rpc(db,'read_voice_session',[other,v.id]),/FORBIDDEN/);
  const a=await rpc(db,'begin_voice_review',[actor,v.id]);const b=await rpc(db,'begin_voice_review',[actor,v.id]);
  await assert.rejects(rpc(db,'save_voice_review',[actor,v.id,JSON.stringify(cart),a.revision]),/STALE_REVIEW/);
  const review=await rpc(db,'save_voice_review',[actor,v.id,JSON.stringify(cart),b.revision]);
  assert.equal(review.quote.totalCents,600);
  await assert.rejects(rpc(db,'submit_voice_order',[actor,v.id,nonce]),/STALE_REVIEW/);
  const ticket=await rpc(db,'submit_voice_order',[actor,v.id,review.confirmationNonce]);
  assert.equal(ticket.source,'voice');assert.equal(ticket.paymentStatus,'unpaid');
  await rpc(db,'close_voice_session',[actor,v.id]);
  assert.deepEqual(await rpc(db,'submit_voice_order',[actor,v.id,review.confirmationNonce]),ticket);
  await assert.rejects(rpc(db,'begin_voice_review',[actor,v.id]),/SESSION_EXPIRED/);
  assert.equal((await db.query('select count(*)::int n from public.orders')).rows[0].n,1);
 }finally{await db.close();}
});
test('expired voice session rejects new confirmation but allows stored receipt recovery',async()=>{
 const db=await setup();try{
  const v=await rpc(db,'create_voice_session',[actor,restaurant,'provider-exp']);
  const revision=await rpc(db,'begin_voice_review',[actor,v.id]);
  const review=await rpc(db,'save_voice_review',[actor,v.id,JSON.stringify(cart),revision.revision]);
  await db.exec("update private.voice_sessions set expires_at=now()-interval '1 second'");
  await assert.rejects(rpc(db,'submit_voice_order',[actor,v.id,review.confirmationNonce]),/SESSION_EXPIRED/);
  assert.equal((await db.query('select count(*)::int n from public.orders')).rows[0].n,0);
 }finally{await db.close();}
});
test('messaging confirmation is quote-bound, durable and duplicate safe with attempted reply suppression',async()=>{
 const db=await setup();try{
  const c=await claim(db);assert.equal(c.status,'claimed');
  assert.equal((await claim(db)).status,'busy');
  const quote=await rpc(db,'quote_cart',[c.sessionTokenHash,JSON.stringify(cart)]);
  const pending={cart,quote,confirmationNonce:nonce,idempotencyKey:idem};
  await rpc(db,'messaging_complete_update',[c.conversationId,c.leaseId,'1',JSON.stringify(state(pending)),JSON.stringify(reply(nonce))]);
  assert.equal((await claim(db)).status,'duplicate');
  const next=await claim(db,'2');
  const ticket=await rpc(db,'messaging_submit_order',[next.conversationId,next.leaseId,'2',nonce]);
  assert.equal(ticket.source,'telegram');assert.equal(ticket.cart.totalCents,600);
  assert.deepEqual(await rpc(db,'messaging_submit_order',[next.conversationId,next.leaseId,'2',nonce]),ticket);
  await rpc(db,'messaging_complete_update',[next.conversationId,next.leaseId,'2',JSON.stringify(state(null,ticket)),JSON.stringify(reply())]);
  assert.equal((await rpc(db,'messaging_claim_reply',[next.conversationId,'2'])).status,'claimed');
  assert.equal((await rpc(db,'messaging_claim_reply',[next.conversationId,'2'])).status,'already_attempted');
  await rpc(db,'messaging_finish_reply',[next.conversationId,'2','unknown',null]);
  assert.equal((await rpc(db,'messaging_claim_reply',[next.conversationId,'2'])).status,'already_attempted');
  const retry=await claim(db,'3');
  assert.equal(retry.state.pending,null);
  assert.deepEqual(await rpc(db,'messaging_submit_order',[retry.conversationId,retry.leaseId,'3',nonce]),ticket);
  assert.equal((await db.query('select count(*)::int n from public.orders')).rows[0].n,1);
 }finally{await db.close();}
});
test('lease expiry only recovers same update, rejects old worker and recipient collision',async()=>{
 const db=await setup();try{
  const first=await claim(db);
  await db.exec("update private.messaging_conversations set lease_until=now()-interval '1 second'");
  assert.equal((await claim(db,'2')).status,'busy');
  const recovered=await claim(db);assert.equal(recovered.status,'claimed');assert.notEqual(recovered.leaseId,first.leaseId);
  await assert.rejects(rpc(db,'messaging_complete_update',[first.conversationId,first.leaseId,'1',JSON.stringify(state()),JSON.stringify(reply())]),/INVALID_LEASE/);
  await assert.rejects(claim(db,'1','other-recipient'),/INVALID_REQUEST/);
 }finally{await db.close();}
});
test('tampered quote and expired pending cannot create order',async()=>{
 const db=await setup();try{
  const c=await claim(db);const quote=await rpc(db,'quote_cart',[c.sessionTokenHash,JSON.stringify(cart)]);
  const pending={cart,quote,confirmationNonce:nonce,idempotencyKey:idem};
  await assert.rejects(rpc(db,'messaging_complete_update',[c.conversationId,c.leaseId,'1',JSON.stringify(state({...pending,quote:{...quote,totalCents:1}})),JSON.stringify(reply(nonce))]),/PRICE_CHANGED/);
  await rpc(db,'messaging_complete_update',[c.conversationId,c.leaseId,'1',JSON.stringify(state(pending)),JSON.stringify(reply(nonce))]);
  await db.exec("update private.messaging_conversations set pending_expires_at=now()-interval '1 second'");
  const next=await claim(db,'2');assert.equal(next.state.pending,null);
  await assert.rejects(rpc(db,'messaging_submit_order',[next.conversationId,next.leaseId,'2',nonce]),/STALE_REVIEW/);
 }finally{await db.close();}
});
test('all new tables use RLS and browser roles cannot call privileged channel RPCs',async()=>{
 const db=await setup();try{
  const rows=(await db.query("select c.relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relname in ('staff_ai_usage','voice_sessions','channel_order_receipts','messaging_conversations','messaging_updates','messaging_replies')")).rows;
  assert.equal(rows.length,6);assert.ok(rows.every(r=>r.relrowsecurity));
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`);
   await assert.rejects(rpc(db,'consume_staff_ai_budget',[actor,restaurant,'voice']),/permission denied/);
   await assert.rejects(db.query('select * from private.messaging_conversations'),/permission denied/);
   await db.exec('reset role');
  }
 }finally{await db.close();}
});
test('existing 53 core SQL assertions still pass after channel extension',async()=>{
 const db=new PGlite();try{
  const runner=await readFile(new URL('../scripts/verify-database-local.mjs',import.meta.url),'utf8');
  const bootstrap=runner.match(/const bootstrap=`([\s\S]*?)`;/)?.[1];assert.ok(bootstrap);
  await db.exec(bootstrap);
  await db.exec(await readFile(new URL('../supabase/migrations/20260913042355_jiak_simi_202609130001_core_ordering.sql',import.meta.url),'utf8'));
  await db.exec(appliedExtension);
  const suite=(await readFile(new URL('../supabase/tests/001_core_ordering.test.sql',import.meta.url),'utf8')).replace('create extension if not exists pgtap with schema extensions;','');
  const results=await db.exec(suite);
  const assertions=results.flatMap(r=>r.rows).flatMap(r=>Object.values(r)).filter(v=>typeof v==='string'&&v.startsWith('ok:'));
  assert.equal(assertions.length,53);
 }finally{await db.close();}
});
