import assert from "node:assert/strict";
import test from "node:test";
import { createOcrHandler } from "../src/server/ai/ocr-handler";
import type { BackendClient } from "../src/server/supabase-backend";
import { OCR_DRAFT_FIXTURE } from "../src/shared/ocr-fixtures";
import { MenuExtractionError } from "../src/server/ai/menu-extraction";
const restaurant="b0000000-0000-4000-8000-000000000001",actor="a0000000-0000-4000-8000-000000000001";
const png=Uint8Array.from([137,80,78,71,13,10,26,10,1]);
function request(headers: Record<string,string>={},body=png) {
 return new Request("http://localhost/api/v1/menu-extractions",{method:"POST",headers:{origin:"http://localhost",authorization:"Bearer staff-jwt","x-restaurant-id":restaurant,"content-type":"image/png",...headers},body});
}
function setup({auth=true,budgetError="",key="fake-openai-key",providerError=false}={}) {
 const calls:string[]=[];
 const client:BackendClient={auth:{getUser:async(jwt)=>{calls.push("auth");assert.equal(jwt,"staff-jwt");return {data:{user:auth?{id:actor}:null},error:null};}},rpc:async(name,args)=>{
  calls.push("budget");assert.equal(name,"consume_staff_ai_budget");assert.deepEqual(args,{p_actor_id:actor,p_restaurant_id:restaurant,p_operation:"extraction"});
  return budgetError?{data:null,error:{code:"P0001",message:budgetError}}:{data:restaurant,error:null};
 }};
 const handler=createOcrHandler({backend:()=>client,apiKey:()=>key,extract:async()=>{calls.push("provider");if(providerError)throw new MenuExtractionError("provider_error","Menu reading could not finish.");return OCR_DRAFT_FIXTURE;}});
 return {calls,handler};
}
test("verified staff and atomic membership/budget gate precede extraction",async()=>{
 const s=setup();const response=await s.handler(request());
 assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
 assert.deepEqual(s.calls,["auth","budget","provider"]);
 assert.equal((await response.json()).status,"needs_review");
});
test("bad origin or missing JWT never reaches provider or budget",async()=>{
 for(const headers of [{origin:"http://evil.example"},{authorization:""}] as Record<string,string>[]){
  const s=setup();const response=await s.handler(request(headers));assert.ok([401,403].includes(response.status));assert.deepEqual(s.calls,[]);
 }
});
test("invalid session, missing key and unsupported/mismatched image never consume paid budget",async()=>{
 for(const [settings,headers] of [[{auth:false},{}],[{key:""},{}],[{}, {"content-type":"image/heic"}],[{}, {"content-type":"image/jpeg"}]] as const){
  const s=setup(settings);assert.ok((await s.handler(request(headers))).status>=400);assert.deepEqual(s.calls,["auth"]);
 }
});
test("membership denial or exhausted durable budget never calls OpenAI",async()=>{
 for(const [budgetError,status] of [["FORBIDDEN",403],["RATE_LIMITED",429]] as const){
  const s=setup({budgetError});assert.equal((await s.handler(request())).status,status);assert.deepEqual(s.calls,["auth","budget"]);
 }
});
test("declared oversized images reject before budget and provider",async()=>{
 const s=setup();assert.equal((await s.handler(request({"content-length":"6000000"}))).status,413);assert.deepEqual(s.calls,["auth"]);
});
test("provider failure returns contract error and never automatically resubmits",async()=>{
 const s=setup({providerError:true});const response=await s.handler(request());
 assert.equal(response.status,502);assert.equal((await response.json()).error.code,"PROVIDER_ERROR");assert.deepEqual(s.calls,["auth","budget","provider"]);
});
