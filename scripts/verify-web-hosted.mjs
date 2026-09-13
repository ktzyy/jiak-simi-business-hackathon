import {readFile,writeFile} from 'node:fs/promises';
import {webRequest,PROJECT,WEB_CATALOG} from './deploy-web-extension.mjs';
const scopedGuard=`select (select rolsuper or rolbypassrls from pg_catalog.pg_roles where rolname=current_user) as privileged,
not exists(select 1 from auth.users where id='a32f563d-a342-4b3a-a432-41552b32fd98') and not exists(select 1 from public.restaurants where id='b32f563d-a342-4b3a-a432-41552b32fd98' or slug='web-rollback-a32f563d') and not exists(select 1 from private.guest_sessions where token_hash=repeat('ab32',16)) as fixtures_absent`;
async function guard(){const r=await webRequest('/database/query',{query:scopedGuard,read_only:false});if(!Array.isArray(r)||r.length!==1||!r[0].privileged||!r[0].fixtures_absent)throw new Error('scoped_fixture_guard_failed');}
try{
 if(process.argv.length!==2)throw new Error('usage_no_arguments');
 const info=await webRequest('');if(info?.ref!==PROJECT||info.status!=='ACTIVE_HEALTHY')throw new Error('project_check_failed');
 await guard();
 const result=await webRequest('/database/query',{query:await readFile(new URL('../tests/web-ordering-hosted.sql',import.meta.url),'utf8'),read_only:false});
 if(!Array.isArray(result)||result.length!==1||result[0].verification_marker!=='jiak_web_rollback_verified_v1'||result[0].assertions_passed!==16)throw new Error('web_assertions_unconfirmed');
 await guard();
 const catalog=await webRequest('/database/query/read-only',{query:WEB_CATALOG});
 const evidence={status:'hosted_web_assertions_passed',project:PROJECT,assertionsPassed:16,scopedRollbackVerified:true,catalog:catalog[0],verifiedAt:new Date().toISOString()};
 await writeFile(new URL('../artifacts/database-deployment/web-hosted-verification.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(evidence));
}catch(error){console.error(JSON.stringify({status:'stopped',project:PROJECT,code:error instanceof Error&&/^[a-z_0-9]+$/.test(error.message)?error.message:'local_failure'}));process.exitCode=1;}
