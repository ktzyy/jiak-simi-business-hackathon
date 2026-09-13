import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const PROJECT='mikpepfrumtglwweolzq', NAME='jiak_simi_web_ordering';
export const SHA='da04a28fcaefaf1da36066101cf14faae44c1864ec3752cfcbe4c804f1ea11c5';
const receiptDir=new URL('../artifacts/database-deployment/',import.meta.url);
const dir=new URL('../supabase/migrations/',import.meta.url);
export const WEB_CATALOG=`with t as(select c.* from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('kitchen_order_state','kitchen_completion_requests','stall_details_versions','stall_details_current','menu_stall_details')),
 f as(select p.* from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('complete_kitchen_order','read_stall_details','save_stall_details','read_published_stall'))
 select (select count(*)::int from t) as tables,(select count(*)::int from t where relkind='r' and relrowsecurity) as rls_tables,(select count(*)::int from f) as functions,
 (select count(*)::int from f join pg_catalog.pg_roles r on r.rolname='service_role' where f.prosecdef and 'search_path=""'=any(f.proconfig) and pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE')) as secured_functions,
 (select count(*)::int from f cross join pg_catalog.pg_roles r where r.rolname in ('anon','authenticated') and pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE')) as browser_functions,
 (select count(*)::int from t cross join pg_catalog.pg_roles r where r.rolname in ('anon','authenticated') and pg_catalog.has_table_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) as browser_tables`;
export async function webRequest(suffix,body){
 const token=process.env.SUPABASE_ACCESS_TOKEN;
 if(!token?.trim())throw new Error('missing_management_token');
 let response;try{response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT}${suffix}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(120000),...(body?{body:JSON.stringify(body)}:{})});}catch{throw new Error('management_transport_error');}
 if(!response.ok)throw new Error(`management_http_${response.status}`);
 try{return await response.json();}catch{throw new Error('unrecognized_response');}
}
function validCatalog(row){return row?.tables===5&&row.rls_tables===5&&row.functions===4&&row.secured_functions===4&&row.browser_functions===0&&row.browser_tables===0;}
async function main(){
 if(process.argv.length>3||process.argv[2]&&process.argv[2]!=='--apply')throw new Error('usage_default_preflight_or_apply');
 const files=(await readdir(dir)).filter(f=>/^\d+_jiak_simi_web_ordering\.sql$/.test(f));
 if(files.length!==1)throw new Error('exactly_one_generated_web_migration_required');
 const source=new URL(files[0],dir),sql=await readFile(source,'utf8');
 if(createHash('sha256').update(sql).digest('hex')!==SHA)throw new Error('approved_draft_changed');
 const info=await webRequest('');if(info?.ref!==PROJECT||info.status!=='ACTIVE_HEALTHY')throw new Error('wrong_project_or_health');
 const history=await webRequest('/database/migrations');
 if(!Array.isArray(history)||!history.some(m=>m.version==='20260913050159'))throw new Error('core_history_missing');
 const result=await webRequest('/database/query/read-only',{query:WEB_CATALOG});
 if(!Array.isArray(result)||result.length!==1||typeof result[0]?.tables!=='number'||typeof result[0]?.functions!=='number')throw new Error('catalog_unrecognized');
 if(history.some(m=>m.name===NAME)||result[0].tables||result[0].functions)throw new Error('extension_already_present_reconcile');
 if(process.argv[2]!=='--apply'){console.log(JSON.stringify({status:'web_preflight_ready',project:PROJECT,sha256:SHA}));return;}
 await mkdir(receiptDir,{recursive:true});
 await writeFile(new URL('web-dispatch.json',receiptDir),JSON.stringify({project:PROJECT,name:NAME,sha256:SHA,reservedAt:new Date().toISOString(),state:'reserved_reconcile_before_repeat'},null,2)+'\n',{flag:'wx',mode:0o600});
 try{await webRequest('/database/migrations',{name:NAME,query:sql});}catch{throw new Error('web_outcome_unknown_do_not_retry');}
 const afterHistory=await webRequest('/database/migrations');
 const match=Array.isArray(afterHistory)?afterHistory.filter(m=>m.name===NAME):[];
 const after=await webRequest('/database/query/read-only',{query:WEB_CATALOG});
 if(match.length!==1||!/^\d+$/.test(match[0].version)||!Array.isArray(after)||after.length!==1||!validCatalog(after[0]))throw new Error('web_applied_verification_unconfirmed');
 const aligned=new URL(`${match[0].version}_${NAME}.sql`,dir);
 if(aligned.href!==source.href){
  if((await readdir(dir)).includes(`${match[0].version}_${NAME}.sql`))throw new Error('local_alignment_collision');
  await rename(source,aligned);
 }
 const evidence={status:'web_applied_catalog_verified',project:PROJECT,sha256:SHA,remoteVersion:match[0].version,catalog:after[0],verifiedAt:new Date().toISOString()};
 await writeFile(new URL('web-applied.json',receiptDir),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(evidence));
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main().catch(error=>{const code=error instanceof Error&&/^[a-z_0-9]+$/.test(error.message)?error.message:'local_failure';console.error(JSON.stringify({status:'stopped',code,project:PROJECT}));process.exitCode=1;});
