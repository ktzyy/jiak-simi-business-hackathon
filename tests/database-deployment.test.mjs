import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PROJECT, MIGRATION_NAME, runDeployment } from "../scripts/apply-approved-database.mjs";

const sql = await readFile(new URL("../supabase/migrations/20260913042355_jiak_simi_202609130001_core_ordering.sql",import.meta.url),"utf8");
const empty = { required_roles:3,auth_ready:true,target_relations:0,rls_tables:0,target_functions:0,target_indexes:0,
  browser_write_grants:0,private_browser_read_grants:0,browser_function_grants:0,protected_server_functions:0,staff_read_tables:0,target_policies:0 };
const installed = { ...empty,target_relations:9,rls_tables:9,target_functions:15,target_indexes:4,protected_server_functions:8,staff_read_tables:3,target_policies:3 };
function setup(replies) {
  const calls=[]; let reserved=false;
  return { calls, options:{ token:"fake-test-token",readMigration:async()=>sql,
    journal:{exists:async()=>reserved,reserve:async()=>{ assert.equal(reserved,false);reserved=true; }},
    fetcher:async(url,init)=>{
      calls.push({url,method:init.method,body:init.body ? JSON.parse(init.body):null});
      assert.equal(init.redirect,"error");
      assert.equal(new URL(url).origin,"https://api.supabase.com");
      const reply=replies.shift();
      if(reply instanceof Error) throw reply;
      assert.notEqual(reply,undefined,"Unexpected request/retry");
      return reply instanceof Response ? reply : Response.json(reply);
    } } };
}
const preflight = () => [{ref:PROJECT,status:"ACTIVE_HEALTHY"},[],[empty]];

test("absent token and unapproved target fail before any request",async()=>{
  for(const override of [{token:""},{project:"another-project"}]) {
    const s=setup([]);
    await assert.rejects(runDeployment({...s.options,...override}),/missing_supabase_access_token|unapproved_project/);
    assert.equal(s.calls.length,0);
  }
});
test("changed migration cannot dispatch",async()=>{
  const s=setup([]);
  await assert.rejects(runDeployment({...s.options,readMigration:async()=>sql+"\n"}),/approved_migration_changed/);
  assert.equal(s.calls.length,0);
});
test("default preflight uses only project/history reads and the read-only query endpoint",async()=>{
  const s=setup(preflight());
  assert.equal((await runDeployment(s.options)).status,"preflight_ready");
  assert.deepEqual(s.calls.map(c=>c.method),["GET","GET","POST"]);
  assert.ok(s.calls[2].url.endsWith("/database/query/read-only"));
});
test("project mismatch and malformed catalog fail closed",async()=>{
  for(const replies of [[{ref:"wrong",status:"ACTIVE_HEALTHY"}],[{ref:PROJECT,status:"ACTIVE_HEALTHY"},[],{}]]) {
    const s=setup(replies);
    await assert.rejects(runDeployment({...s.options,apply:true}),/project_identity_or_health_unverified|unrecognized_catalog_response/);
    assert.equal(s.calls.filter(c=>c.method==="POST" && c.url.endsWith("/migrations")).length,0);
  }
});
test("existing target objects or migration history never cause reapplication",async()=>{
  for(const [history,row] of [[[],{...empty,target_relations:1}],[[{version:"202609130001",name:"core_ordering"}],empty]]) {
    const s=setup([{ref:PROJECT,status:"ACTIVE_HEALTHY"},history,[row]]);
    assert.equal((await runDeployment({...s.options,apply:true})).status,"existing_state_requires_reconciliation");
    assert.equal(s.calls.length,3);
  }
});
test("ambiguous mutation is attempted once and durable reservation blocks subsequent invocation",async()=>{
  const s=setup([...preflight(),new Error("provider body fake-test-token must not leak"),...preflight()]);
  await assert.rejects(runDeployment({...s.options,apply:true}),/migration_outcome_unknown_reconcile_do_not_retry/);
  await assert.rejects(runDeployment({...s.options,apply:true}),/previous_dispatch_requires_reconciliation/);
  assert.equal(s.calls.filter(c=>c.method==="POST" && c.url.endsWith("/migrations")).length,1);
});
test("HTTP failure after mutation dispatch is never retried",async()=>{
  const s=setup([...preflight(),new Response("sensitive provider text",{status:500})]);
  await assert.rejects(runDeployment({...s.options,apply:true}),error=>error.message==="migration_outcome_unknown_reconcile_do_not_retry");
  assert.equal(s.calls.length,4);
});
test("successful apply sends exact approved SQL once and checks history and security catalogs",async()=>{
  const s=setup([...preflight(),{},[{version:"20260913123456",name:MIGRATION_NAME}],[installed]]);
  const result=await runDeployment({...s.options,apply:true});
  assert.equal(result.status,"applied_catalog_verified");
  assert.equal(result.remoteMigrationVersion,"20260913123456");
  assert.deepEqual(s.calls[3].body,{name:MIGRATION_NAME,query:sql});
});
test("postapply insecurity reports incomplete verification without another mutation",async()=>{
  const s=setup([...preflight(),{},[{version:"20260913123456",name:MIGRATION_NAME}],[{...installed,browser_function_grants:1}]]);
  await assert.rejects(runDeployment({...s.options,apply:true}),/migration_dispatched_verification_incomplete_do_not_retry/);
  assert.equal(s.calls.filter(c=>c.method==="POST" && c.url.endsWith("/migrations")).length,1);
});
