import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROJECT = "mikpepfrumtglwweolzq";
export const MIGRATION_NAME = "jiak_simi_202609130001_core_ordering";
export const APPROVED_SHA256 = "93cc7ec835c22b5747f5719268cf46a247388a89eea44ac0a4c5d4d63d790958";
const migrationUrl = new URL("../supabase/migrations/20260913042355_jiak_simi_202609130001_core_ordering.sql", import.meta.url);
const receiptDir = new URL("../artifacts/database-deployment/", import.meta.url);
const receiptUrl = new URL("approved-migration-dispatch.json", receiptDir);

export class DeploymentError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new DeploymentError(code); };

// One catalog-only SELECT. No app rows, function bodies or stored statements.
export const CATALOG_QUERY = `with targets(schema_name,table_name) as (values
 ('public','restaurants'),('public','restaurant_memberships'),('public','orders'),
 ('private','menus'),('private','menu_versions'),('private','guest_sessions'),
 ('private','ai_usage_windows'),('private','idempotency_requests'),('private','outbox_events')
), tables as (
 select n.nspname,c.* from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 join targets t on t.schema_name=n.nspname and t.table_name=c.relname
), functions as (
 select n.nspname,p.* from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname in ('publish_menu','read_published_menu','create_guest_session','validate_guest_session','consume_guest_ai_budget','quote_cart','submit_order','read_kitchen_orders'))
 or (n.nspname='private' and p.proname in ('is_member','reject_mutation','keys_exact','int_between','valid_name','validate_menu','price_cart'))
), browser_roles as (select r.oid from pg_catalog.pg_roles r where r.rolname in ('anon','authenticated'))
select
 (select count(*)::int from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role')) as required_roles,
 (pg_catalog.to_regclass('auth.users') is not null and pg_catalog.to_regprocedure('auth.uid()') is not null and pg_catalog.to_regprocedure('pg_catalog.gen_random_uuid()') is not null) as auth_ready,
 (select count(*)::int from tables) as target_relations,
 (select count(*)::int from tables where relkind='r' and relrowsecurity) as rls_tables,
 (select count(*)::int from functions) as target_functions,
 (select count(*)::int from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where (n.nspname='public' and c.relname in ('memberships_user_active','orders_kitchen'))
  or (n.nspname='private' and c.relname in ('guest_sessions_expiry','outbox_pending'))) as target_indexes,
 (select count(*)::int from tables t cross join browser_roles r
  where pg_catalog.has_table_privilege(r.oid,t.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as browser_write_grants,
 (select count(*)::int from tables t cross join browser_roles r
  where t.nspname='private' and pg_catalog.has_table_privilege(r.oid,t.oid,'SELECT')) as private_browser_read_grants,
 (select count(*)::int from functions f cross join browser_roles r
  where not (f.nspname='private' and f.proname='is_member' and r.oid=(select oid from pg_catalog.pg_roles where rolname='authenticated'))
  and pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE')) as browser_function_grants,
 (select count(*)::int from functions f join pg_catalog.pg_roles r on r.rolname='service_role'
  where f.nspname='public' and f.prosecdef and pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE')
  and 'search_path=""'=any(f.proconfig)) as protected_server_functions,
 (select count(*)::int from tables t join pg_catalog.pg_roles r on r.rolname='authenticated'
  where t.nspname='public' and pg_catalog.has_table_privilege(r.oid,t.oid,'SELECT')) as staff_read_tables,
 (select count(*)::int from pg_catalog.pg_policy p join tables t on t.oid=p.polrelid) as target_policies`;

function catalogRow(value) {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== "object") fail("unrecognized_catalog_response");
  const row = value[0];
  const keys = ["required_roles","target_relations","rls_tables","target_functions","target_indexes","browser_write_grants","private_browser_read_grants","browser_function_grants","protected_server_functions","staff_read_tables","target_policies"];
  if (keys.some((key) => !Number.isSafeInteger(row[key]) || row[key] < 0) || typeof row.auth_ready !== "boolean") fail("unrecognized_catalog_response");
  return Object.fromEntries([...keys,"auth_ready"].map((key) => [key,row[key]]));
}
function migrationHistory(value) {
  if (!Array.isArray(value) || value.some((m) => !m || typeof m.version !== "string" || !/^\d+$/.test(m.version) || !(m.name === null || typeof m.name === "string"))) fail("unrecognized_history_response");
  return value;
}
function matchesHistory(history) {
  return history.filter((m) => m.name === MIGRATION_NAME || m.name === "core_ordering" || m.version === "202609130001");
}
function verifiedCatalog(row) {
  return row.required_roles === 3 && row.auth_ready && row.target_relations === 9 && row.rls_tables === 9
    && row.target_functions === 15 && row.target_indexes === 4 && row.browser_write_grants === 0
    && row.private_browser_read_grants === 0 && row.browser_function_grants === 0
    && row.protected_server_functions === 8 && row.staff_read_tables === 3 && row.target_policies === 3;
}

const diskJournal = {
  async exists() {
    try { await readFile(receiptUrl); return true; }
    catch (error) { if (error?.code === "ENOENT") return false; fail("dispatch_journal_unreadable"); }
  },
  async reserve(record) {
    await mkdir(receiptDir, { recursive: true });
    try { await writeFile(receiptUrl, JSON.stringify(record,null,2)+"\n", { flag: "wx", mode: 0o600 }); }
    catch { fail("dispatch_journal_already_exists_or_unwritable"); }
  },
};

/** No retries, no alternate targets, no schema repair and no secret logging. */
export async function runDeployment({ apply = false, project = PROJECT, token,
  fetcher = fetch, readMigration = () => readFile(migrationUrl,"utf8"), journal = diskJournal } = {}) {
  if (project !== PROJECT) fail("unapproved_project");
  if (typeof token !== "string" || !token.trim()) fail("missing_supabase_access_token");
  const sql = await readMigration();
  if (createHash("sha256").update(sql).digest("hex") !== APPROVED_SHA256) fail("approved_migration_changed");
  const base = `https://api.supabase.com/v1/projects/${PROJECT}`;
  const request = async (suffix, method = "GET", body) => {
    let response;
    try {
      response = await fetcher(base+suffix, { method, redirect: "error", signal: AbortSignal.timeout(120_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { fail("management_transport_failed"); }
    if (!response.ok) fail("management_request_failed");
    try { return await response.json(); } catch { fail("management_response_unrecognized"); }
  };
  const projectInfo = await request("");
  if (!projectInfo || projectInfo.ref !== PROJECT || projectInfo.status !== "ACTIVE_HEALTHY") fail("project_identity_or_health_unverified");
  const history = migrationHistory(await request("/database/migrations"));
  const row = catalogRow(await request("/database/query/read-only","POST",{ query: CATALOG_QUERY }));
  if (row.required_roles !== 3 || !row.auth_ready) fail("database_prerequisites_missing");
  const existing = matchesHistory(history);
  if (existing.length || row.target_relations || row.target_functions || row.target_indexes) {
    // Observing an existing install never authorizes a reapplication or claims exact SQL equality.
    return { status: "existing_state_requires_reconciliation", project: PROJECT, migrationSha256: APPROVED_SHA256,
      matchingHistoryEntries: existing.length, catalogChecksPass: verifiedCatalog(row), catalog: row, mutationAttempted: false };
  }
  if (!apply) return { status: "preflight_ready", project: PROJECT, migrationSha256: APPROVED_SHA256, mutationAttempted: false };
  if (await journal.exists()) fail("previous_dispatch_requires_reconciliation");
  // Write BEFORE dispatch. An interrupted/ambiguous attempt must never silently repeat.
  await journal.reserve({ project: PROJECT, migrationName: MIGRATION_NAME, migrationSha256: APPROVED_SHA256,
    state: "dispatch_reserved_reconcile_before_any_repeat", reservedAt: new Date().toISOString() });
  try {
    await request("/database/migrations","POST",{ name: MIGRATION_NAME, query: sql });
  } catch { fail("migration_outcome_unknown_reconcile_do_not_retry"); }
  try {
    const afterHistory = migrationHistory(await request("/database/migrations"));
    const recorded = afterHistory.filter((m) => m.name === MIGRATION_NAME);
    const after = catalogRow(await request("/database/query/read-only","POST",{ query: CATALOG_QUERY }));
    if (recorded.length !== 1 || !verifiedCatalog(after)) fail("postapply_verification_failed");
    return { status: "applied_catalog_verified", project: PROJECT, migrationSha256: APPROVED_SHA256,
      remoteMigrationVersion: recorded[0].version, mutationAttempted: true, catalog: after };
  } catch { fail("migration_dispatched_verification_incomplete_do_not_retry"); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--apply")) fail("usage_default_preflight_or_apply");
    const result = await runDeployment({ apply: args[0] === "--apply", token: process.env.SUPABASE_ACCESS_TOKEN });
    console.log(JSON.stringify(result));
    if (result.status === "existing_state_requires_reconciliation") process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "stopped", code: error instanceof DeploymentError ? error.code : "local_failure",
      project: PROJECT, dispatchReceipt: fileURLToPath(receiptUrl) }));
    process.exitCode = 1;
  }
}
