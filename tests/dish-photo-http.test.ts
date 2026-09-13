import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DishPhotoError } from '../src/server/ai/dish-photo';
import { dishPhotoHandlers } from '../src/server/dish-photos';
import { fixtureMenu } from '../src/shared/fixtures';
import { PUBLIC_DEMO_BEARER, PUBLIC_DEMO_RESTAURANT_ID as restaurantId } from '../src/shared/public-demo';
import type { DishPhotoResponse } from '../src/shared/dish-photo';
const origin='https://jiak.test';
const image=new Uint8Array([255,216,255,224,0,1,255,217]);
const hash=createHash('sha256').update(image).digest('hex');
const photoRequest={mode:'generate_similar' as const,dishId:fixtureMenu.dishes[0].id,dishName:fixtureMenu.dishes[0].name};
const candidate: DishPhotoResponse['candidate']={id:randomUUID(),dishId:photoRequest.dishId,status:'needs_review',mode:'generate_similar',label:'AI-generated illustration',disclosureRequired:true,mimeType:'image/jpeg',imageSha256:hash,sourceImageId:null,sourceEntryId:null,sourceImageSha256:null,region:null,model:'gpt-image-2.5-flare',quality:'low',size:'1024x1024',promptSha256:'a'.repeat(64),createdAt:new Date().toISOString()};
function env(t:{after:(fn:()=>void)=>void}){const old=process.env.DEMO_MODE;process.env.DEMO_MODE='true';t.after(()=>{if(old===undefined)delete process.env.DEMO_MODE;else process.env.DEMO_MODE=old;});}
function form(key:string,scope=restaurantId){const body=new FormData();body.set('restaurantId',scope);body.set('key',key);body.set('request',JSON.stringify(photoRequest));return new Request(origin+'/api/v1/dish-photos',{method:'POST',headers:{origin,authorization:`Bearer ${PUBLIC_DEMO_BEARER}`},body});}
function get(path:string,auth=true){return new Request(origin+path,{headers:auth?{authorization:`Bearer ${PUBLIC_DEMO_BEARER}`}:{}});}
function harness(fail: boolean|'rejected'=false){
 const jobId=randomUUID(),records=new Map<string,Record<string,unknown>>(),objects=new Map<string,Uint8Array>();let providerCalls=0;const calls:string[]=[];
 const handlers=dishPhotoHandlers({apiKey:()=> 'mock-key',backend:()=>({auth:{getUser:async()=>({data:{user:null},error:null})},rpc:async(name,args)=>{
  calls.push(name);
  if(name==='reserve_dish_photo_job'){const prior=records.get(String(args.p_idempotency_key));if(prior)return {data:{...prior,dispatchAllowed:false},error:null};const record={jobId,status:'dispatch_unknown',result:null};records.set(String(args.p_idempotency_key),record);return {data:{...record,dispatchAllowed:true},error:null};}
  if(name==='finish_dish_photo_job'){const record={jobId,status:args.p_result?'ready':'failed',result:args.p_result};for(const key of records.keys())records.set(key,record);return {data:record,error:null};}
  if(name==='read_dish_photo_job')return {data:[...records.values()][0],error:null};
  if(name==='read_published_photos')return {data:[],error:null};
  throw Error('unexpected RPC');
 }}),storage:()=>({upload:async(key,bytes)=>{objects.set(key,bytes);},download:async key=>{const bytes=objects.get(key);if(!bytes)throw Error('missing');return bytes;}}),create:async()=>{providerCalls++;if(fail==='rejected')throw new DishPhotoError('provider_error','Rejected',true,403);if(fail)throw Error('provider outcome unknown');return {candidate,imageBase64:Buffer.from(image).toString('base64')};}});
 return {handlers,jobId,objects,calls,providerCalls:()=>providerCalls};
}
test('photo generation reserves before paid dispatch, persists private bytes and exposes authenticated preview only',async t=>{
 env(t);const h=harness(),key=randomUUID();const response=await h.handlers.create(form(key));assert.equal(response.status,200);const body=await response.json();assert.equal(body.status,'ready');assert.equal(body.candidate.status,'needs_review');assert.equal('imageBase64' in body,false);assert.equal('objectKey' in body,false);
 assert.deepEqual(h.calls,['reserve_dish_photo_job','finish_dish_photo_job']);
 assert.equal((await h.handlers.create(form(key))).status,200);assert.equal(h.providerCalls(),1);
 assert.equal((await h.handlers.byKey(get(`/x?restaurantId=${restaurantId}`),key)).status,200);
 const preview=await h.handlers.preview(get(`/x?restaurantId=${restaurantId}`),h.jobId);assert.equal(preview.status,200);assert.deepEqual(new Uint8Array(await preview.arrayBuffer()),image);assert.equal(preview.headers.get('cache-control'),'private, no-store');
 assert.equal((await h.handlers.preview(get(`/x?restaurantId=${restaurantId}`,false),h.jobId)).status,401);
 assert.equal((await h.handlers.media(get(`/x?restaurantId=${restaurantId}&menuId=${fixtureMenu.id}&menuVersion=1`,false),h.jobId)).status,404);
});
test('unknown paid outcome stays recoverable and same key never redispatches',async t=>{
 env(t);const h=harness(true),key=randomUUID();const first=await h.handlers.create(form(key));assert.equal((await first.json()).status,'dispatch_unknown');
 assert.equal((await (await h.handlers.create(form(key))).json()).status,'dispatch_unknown');assert.equal(h.providerCalls(),1);assert.equal(h.calls.includes('finish_dish_photo_job'),false);
});
test('wrong dummy scope, origin, oversized upload and injected source block before reserve/provider',async t=>{
 env(t);const h=harness();assert.equal((await h.handlers.create(form(randomUUID(),fixtureMenu.restaurantId))).status,403);
 const cross=form(randomUUID());cross.headers.set('origin','https://other.test');assert.equal((await h.handlers.create(cross)).status,403);
 const oversized=form(randomUUID());oversized.headers.set('content-length',String(6*1024*1024));assert.equal((await h.handlers.create(oversized)).status,413);
 const body=new FormData();body.set('restaurantId',restaurantId);body.set('key',randomUUID());body.set('request',JSON.stringify(photoRequest));body.set('source','https://untrusted.test/image.jpg');
 assert.equal((await h.handlers.create(new Request(origin,{method:'POST',headers:{origin,authorization:`Bearer ${PUBLIC_DEMO_BEARER}`},body}))).status,400);
 assert.equal(h.calls.length,0);assert.equal(h.providerCalls(),0);
});

test('definitive provider rejection marks failed without refund or same-key redispatch',async t=>{
 env(t);const h=harness('rejected'),key=randomUUID();const response=await h.handlers.create(form(key));assert.equal((await response.json()).status,'failed');
 assert.equal((await (await h.handlers.create(form(key))).json()).status,'failed');assert.equal(h.providerCalls(),1);assert.equal(h.calls.filter(name=>name==='finish_dish_photo_job').length,1);
});
