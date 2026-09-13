import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PROJECT } from "../scripts/apply-approved-database.mjs";
import { buildHostedVerification, verifyHosted } from "../scripts/verify-database-hosted.mjs";
const suite=await readFile(new URL("../supabase/tests/001_core_ordering.test.sql",import.meta.url),"utf8");
const safe=[{fixtures_safe:true,pgtap_schema_safe:true,privileged_visibility:true}];
function setup({preflight=safe,reply="pass",after=safe}={}){
 const calls=[];
 return {calls,options:{token:"fake-test-token",readSuite:async()=>suite,fetcher:async(url,init)=>{
  calls.push({url,body:init.body?JSON.parse(init.body):null});
  if(calls.length===1)return Response.json({ref:PROJECT,status:"ACTIVE_HEALTHY"});
  if(calls.length===2)return Response.json(preflight);
  if(calls.length===3){
   if(reply==="fail")return new Response("sensitive diagnostics",{status:500});
   if(reply==="missing")return Response.json({});
   const marker=JSON.parse(init.body).query.match(/select '([a-f0-9-]+)'::text as verification_marker/)[1];
   return Response.json([{verification_marker:marker,assertions_passed:53}]);
  }
  if(calls.length===4)return Response.json(after);
  assert.fail("Unexpected retry");
 }}};
}
test("build preserves all 53 assertions and gates success before rollback",()=>{
 const query=buildHostedVerification(suite,"00000000-0000-4000-8000-000000000001");
 assert.equal((query.match(/insert into pg_temp.jiak_tap_log\(result\) select (?:is|throws_ok|lives_ok)\(/g)||[]).length,53);
 assert.ok(query.indexOf("HOSTED_TAP_ASSERTIONS_FAILED")<query.indexOf("rollback;"));
 assert.ok(query.indexOf("as verification_marker")>query.indexOf("rollback;"));
 assert.match(query,/lock table .* in share row exclusive mode;/);
});
test("nonempty fixture preflight prevents test mutation",async()=>{
 const s=setup({preflight:[{fixtures_safe:false,pgtap_schema_safe:true}]});
 await assert.rejects(verifyHosted(s.options),/hosted_test_preflight_failed/);
 assert.equal(s.calls.length,2);
});
test("HTTP success without the unique assertion marker cannot pass",async()=>{
 const s=setup({reply:"missing"});
 await assert.rejects(verifyHosted(s.options),/hosted_assertion_result_unconfirmed/);
 assert.equal(s.calls.length,3);
});
test("failed test request never retries or leaks provider diagnostics",async()=>{
 const s=setup({reply:"fail"});
 await assert.rejects(verifyHosted(s.options),error=>error.message==="hosted_test_request_failed_no_retry");
 assert.equal(s.calls.length,3);
});
test("verified TAP result still requires empty fixtures after rollback",async()=>{
 const s=setup({after:[{fixtures_safe:false}]});
 await assert.rejects(verifyHosted(s.options),/hosted_test_rollback_unconfirmed/);
});
test("success requires assertion marker plus verified rollback",async()=>{
 const s=setup();
 assert.equal((await verifyHosted(s.options)).assertionsPassed,53);
 assert.equal(s.calls.length,4);
 for(const index of [1,3]){
  assert.ok(s.calls[index].url.endsWith('/database/query'));
  assert.equal(s.calls[index].body.read_only,false);
  assert.match(s.calls[index].body.query,/^select /);
 }
});
test("RLS-hidden empty results without bypass privilege cannot pass",async()=>{
 for(const config of [{preflight:[{...safe[0],privileged_visibility:false}]},{after:[{...safe[0],privileged_visibility:false}]}]){
  const s=setup(config);
  await assert.rejects(verifyHosted(s.options),/hosted_test_preflight_failed|hosted_test_rollback_unconfirmed/);
 }
});
test("changed suite and foreign project fail before network calls",async()=>{
 for(const override of [{project:"foreign"},{readSuite:async()=>suite+"\n"}]){
  const s=setup();
  await assert.rejects(verifyHosted({...s.options,...override}),/unapproved_project|approved_test_suite_changed/);
  assert.equal(s.calls.length,0);
 }
});
