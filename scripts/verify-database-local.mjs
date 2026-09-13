import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root=fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/,'');
const db=await PGlite.create();
const bootstrap=`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to public; grant execute on function auth.uid() to public;
create schema extensions; grant usage on schema extensions to public;
-- Minimal assertion compatibility layer; PGlite does not ship pgTAP.
create function extensions.no_plan() returns text language sql as $$ select 'assertion compatibility run' $$;
create function extensions.finish() returns setof text language sql as $$ select 'assertions completed' $$;
create function extensions.is(actual anyelement,expected anyelement,description text) returns text language plpgsql as $$ begin if actual is distinct from expected then raise exception 'ASSERTION FAILED: % actual % expected %',description,actual,expected; end if; return 'ok: '||description; end $$;
create function extensions.lives_ok(statement text,description text) returns text language plpgsql as $$ begin execute statement; return 'ok: '||description; exception when others then raise exception 'ASSERTION FAILED: % unexpected % %',description,sqlstate,sqlerrm; end $$;
create function extensions.throws_ok(statement text,wanted_code text,wanted_message text,description text) returns text language plpgsql as $$ declare actual_code text; actual_message text; begin begin execute statement; exception when others then actual_code:=sqlstate; actual_message:=sqlerrm; end; if actual_code is distinct from wanted_code or (wanted_message is not null and actual_message is distinct from wanted_message) then raise exception 'ASSERTION FAILED: % got % % expected % %',description,actual_code,actual_message,wanted_code,wanted_message; end if; return 'ok: '||description; end $$;
`;
try {
 await db.exec(bootstrap);
 await db.exec(await readFile(root+'/supabase/migrations/20260913042355_jiak_simi_202609130001_core_ordering.sql','utf8'));
 console.log('Migration executed successfully in PGlite.');
 const suite=(await readFile(root+'/supabase/tests/001_core_ordering.test.sql','utf8')).replace('create extension if not exists pgtap with schema extensions;','');
 const results=await db.exec(suite);
 const assertions=results.flatMap(x=>x.rows).flatMap(x=>Object.values(x)).filter(x=>typeof x==='string'&&x.startsWith('ok:'));
 for(const a of assertions)console.log(a);
 console.log(`PASS ${assertions.length} SQL assertions with compatibility helpers. Supabase Auth is stubbed; hosted environment and true pgTAP remain separate verification.`);
} catch(error) { console.error(error.message, error.detail??'', error.where??''); process.exitCode=1; }
finally { await db.close(); }
