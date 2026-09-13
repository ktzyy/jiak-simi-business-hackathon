import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PROJECT, DeploymentError } from "./apply-approved-database.mjs";

const suiteUrl = new URL("../supabase/tests/001_core_ordering.test.sql",import.meta.url);
const fail = (code) => { throw new DeploymentError(code); };
export const FIXTURE_GUARD = `not exists(select 1 from public.restaurants)
 and not exists(select 1 from public.restaurant_memberships) and not exists(select 1 from public.orders)
 and not exists(select 1 from private.menus) and not exists(select 1 from private.menu_versions)
 and not exists(select 1 from private.guest_sessions) and not exists(select 1 from private.ai_usage_windows)
 and not exists(select 1 from private.idempotency_requests) and not exists(select 1 from private.outbox_events)
 and not exists(select 1 from auth.users where id in ('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003'))`;
export const HOSTED_PREFLIGHT = `select (${FIXTURE_GUARD}) as fixtures_safe,
 (select rolsuper or rolbypassrls from pg_catalog.pg_roles where rolname=current_user) as privileged_visibility,
 not exists(select 1 from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace where e.extname='pgtap' and n.nspname<>'extensions') as pgtap_schema_safe`;

/** Preserve every assertion; collect TAP text and fail SQL before rollback on any failure. */
export function buildHostedVerification(suite, marker) {
  if (!/^[a-f0-9-]{36}$/.test(marker)) fail("invalid_verification_marker");
  if (!suite.includes("begin;\n") || !suite.endsWith("rollback;\n") || !suite.includes("select * from finish();")) fail("test_suite_shape_changed");
  let count = 0;
  const transformed = suite.replace(/^select (?:is|lives_ok|throws_ok)\(.*;$/gm,(line)=>{
    count++;
    return "insert into pg_temp.jiak_tap_log(result) " + line;
  });
  if (count !== 53) fail("test_assertion_count_changed");
  const setup = `begin;
set local statement_timeout='90s';
set local lock_timeout='5s';
lock table public.restaurants,public.restaurant_memberships,public.orders,private.menus,private.menu_versions,private.guest_sessions,private.ai_usage_windows,private.idempotency_requests,private.outbox_events in share row exclusive mode;
do $guard$ begin if not (${FIXTURE_GUARD}) then raise exception 'TEST_FIXTURES_NOT_SAFE'; end if; end $guard$;
create temporary table jiak_tap_log(result text not null);
grant insert,select on table pg_temp.jiak_tap_log to anon,authenticated;
`;
  const finish = `insert into pg_temp.jiak_tap_log(result) select * from finish();
do $verify$ begin
 if (select count(*) from pg_temp.jiak_tap_log where result ~ '^ok [0-9]+( |$)') <> 53
 or exists(select 1 from pg_temp.jiak_tap_log where result !~ '^ok [0-9]+( |$)' and result <> '1..53')
 or exists(select 1 from pg_temp.jiak_tap_log where result ~ '# (TODO|SKIP)')
 then raise exception 'HOSTED_TAP_ASSERTIONS_FAILED'; end if;
end $verify$;`;
  return transformed.replace("begin;\n",setup).replace("select * from finish();",finish)
    + `select '${marker}'::text as verification_marker,53::integer as assertions_passed;\n`;
}

export async function verifyHosted({token,project=PROJECT,fetcher=fetch,readSuite=()=>readFile(suiteUrl,"utf8")}={}) {
  if(project!==PROJECT) fail("unapproved_project");
  if(typeof token!=="string" || !token.trim()) fail("missing_supabase_access_token");
  const suite=await readSuite();
  if(createHash("sha256").update(suite).digest("hex")!=="813bc71af38aa8ccdc123f7244fa060e3264c2d81acc4405dd548b83fefb7590") fail("approved_test_suite_changed");
  const marker=randomUUID();
  const query=buildHostedVerification(suite,marker);
  const request=async(suffix,body)=>{
    let response;
    try { response=await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}${suffix}`,{
      method:body?"POST":"GET",redirect:"error",signal:AbortSignal.timeout(120_000),
      headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
      ...(body?{body:JSON.stringify(body)}:{}) }); } catch {fail("hosted_test_transport_failed_no_retry");}
    if(!response.ok) fail("hosted_test_request_failed_no_retry");
    try{return await response.json();}catch{fail("hosted_test_response_unrecognized");}
  };
  const info=await request("");
  if(info?.ref!==PROJECT || info.status!=="ACTIVE_HEALTHY") fail("project_identity_or_health_unverified");
  // Read-only endpoint may apply RLS and hide fixtures. This SELECT needs verified privileged visibility.
  const before=await request("/database/query",{query:HOSTED_PREFLIGHT,read_only:false});
  if(!Array.isArray(before)||before.length!==1||before[0]?.fixtures_safe!==true||before[0]?.pgtap_schema_safe!==true||before[0]?.privileged_visibility!==true) fail("hosted_test_preflight_failed");
  const result=await request("/database/query",{query,read_only:false});
  // The final post-ROLLBACK SELECT must be observable. HTTP success alone is never a pass.
  if(!Array.isArray(result)||result.length!==1||result[0]?.verification_marker!==marker||result[0]?.assertions_passed!==53) fail("hosted_assertion_result_unconfirmed");
  const after=await request("/database/query",{query:HOSTED_PREFLIGHT,read_only:false});
  if(!Array.isArray(after)||after.length!==1||after[0]?.fixtures_safe!==true||after[0]?.privileged_visibility!==true) fail("hosted_test_rollback_unconfirmed");
  return {status:"hosted_assertions_passed_and_rollback_verified",project:PROJECT,assertionsPassed:53,
    suiteSha256:createHash("sha256").update(suite).digest("hex")};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  try{
    if(process.argv.length!==2) fail("usage_no_arguments");
    console.log(JSON.stringify(await verifyHosted({token:process.env.SUPABASE_ACCESS_TOKEN})));
  }catch(error){console.error(JSON.stringify({status:"stopped",project:PROJECT,code:error instanceof DeploymentError?error.code:"local_failure"}));process.exitCode=1;}
}
