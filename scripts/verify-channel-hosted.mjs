import {readFile,writeFile} from 'node:fs/promises';
import {channelRequest,PROJECT,CHANNEL_CATALOG} from './deploy-channel-extension.mjs';
import {HOSTED_PREFLIGHT} from './verify-database-hosted.mjs';
const emptyQuery=`select (select rolsuper or rolbypassrls from pg_catalog.pg_roles where rolname=current_user) as privileged,
 not exists(select 1 from private.staff_ai_usage) and not exists(select 1 from private.voice_sessions) and not exists(select 1 from private.channel_order_receipts) and not exists(select 1 from private.messaging_conversations) and not exists(select 1 from private.messaging_updates) and not exists(select 1 from private.messaging_replies) as empty`;
async function checkEmpty(){
 const core=await channelRequest('/database/query',{query:HOSTED_PREFLIGHT,read_only:false});
 const channel=await channelRequest('/database/query',{query:emptyQuery,read_only:false});
 if(!Array.isArray(core)||core.length!==1||!core[0].fixtures_safe||!core[0].privileged_visibility||!Array.isArray(channel)||channel.length!==1||!channel[0].empty||!channel[0].privileged)throw new Error('fixture_visibility_or_emptiness_failed');
}
try{
 if(process.argv.length!==2)throw new Error('usage_no_arguments');
 const info=await channelRequest('');if(info?.ref!==PROJECT||info.status!=='ACTIVE_HEALTHY')throw new Error('project_check_failed');
 await checkEmpty();
 const result=await channelRequest('/database/query',{query:await readFile(new URL('../tests/channel-database-hosted.sql',import.meta.url),'utf8'),read_only:false});
 if(!Array.isArray(result)||result.length!==1||result[0].verification_marker!=='jiak_channel_rollback_verified_v1'||result[0].assertions_passed!==18)throw new Error('channel_assertion_response_unconfirmed');
 await checkEmpty();
 const catalog=await channelRequest('/database/query/read-only',{query:CHANNEL_CATALOG});
 const evidence={status:'hosted_channel_assertions_passed',project:PROJECT,assertionsPassed:18,rollbackVerified:true,catalog:catalog[0],verifiedAt:new Date().toISOString()};
 await writeFile(new URL('../artifacts/database-deployment/channel-hosted-verification.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(evidence));
}catch(error){console.error(JSON.stringify({status:'stopped',project:PROJECT,code:error instanceof Error&&/^[a-z_0-9]+$/.test(error.message)?error.message:'local_failure'}));process.exitCode=1;}
