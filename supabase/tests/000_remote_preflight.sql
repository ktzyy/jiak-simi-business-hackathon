-- Read-only catalog preflight for the approved mikpepfrumtglwweolzq project.
-- Run explicitly via the dashboard SQL editor or a trusted database connection.
-- This is a diagnostic script, not a pgTAP suite or a migration.
-- Verify the selected project reference in the dashboard/connection first:
-- current_database() is often simply "postgres" and cannot prove project identity.
-- Do not apply the core migration if target objects already exist; reconcile first.
-- No application rows, auth users, session tokens or function bodies are read.
begin transaction read only;

select current_database() as database_name,
       current_user as execution_role,
       session_user as connection_role,
       current_setting('server_version') as postgres_version,
       current_setting('transaction_read_only') as transaction_read_only,
       current_setting('search_path') as search_path;

-- Role existence, bypass-RLS capability and schema create rights.
select expected.role_name, r.oid is not null as exists,
       r.rolsuper as superuser, r.rolbypassrls as bypass_rls
from (values ('anon'), ('authenticated'), ('service_role')) expected(role_name)
left join pg_catalog.pg_roles r on r.rolname = expected.role_name
order by expected.role_name;

select expected.schema_name, n.oid is not null as exists,
       pg_catalog.pg_get_userbyid(n.nspowner) as owner,
       case when n.oid is not null then pg_catalog.has_schema_privilege(current_user, n.oid, 'CREATE') end as current_role_can_create,
       case when n.oid is not null then pg_catalog.has_schema_privilege(current_user, n.oid, 'USAGE') end as current_role_can_use
from (values ('public'), ('private'), ('auth'), ('extensions'), ('supabase_migrations')) expected(schema_name)
left join pg_catalog.pg_namespace n on n.nspname = expected.schema_name
order by expected.schema_name;

-- Required auth/UUID prerequisites and migration-history presence only.
-- Catalog lookups are safe even if auth or supabase_migrations is absent.
select pg_catalog.to_regclass('auth.users') is not null as auth_users_present,
       pg_catalog.to_regprocedure('auth.uid()') is not null as auth_uid_present,
       pg_catalog.to_regprocedure('pg_catalog.gen_random_uuid()') is not null as core_uuid_generator_present,
       pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null as migration_history_present;

-- Includes absent target tables explicitly, making collisions easy to see.
with targets(schema_name, table_name) as (values
  ('public','restaurants'), ('public','restaurant_memberships'), ('public','orders'),
  ('private','menus'), ('private','menu_versions'), ('private','guest_sessions'),
  ('private','ai_usage_windows'), ('private','idempotency_requests'), ('private','outbox_events')
)
select t.schema_name, t.table_name, c.oid is not null as exists,
       c.relkind as relation_kind, pg_catalog.pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from targets t
left join pg_catalog.pg_namespace n on n.nspname = t.schema_name
left join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = t.table_name
order by t.schema_name, t.table_name;

-- ACLs include PUBLIC grants and default owner ACLs if no explicit ACL exists.
select n.nspname as schema_name, c.relname as table_name,
       case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type, a.is_grantable
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r',c.relowner))) a
where (n.nspname = 'public' and c.relname in ('restaurants','restaurant_memberships','orders'))
   or (n.nspname = 'private' and c.relname in ('menus','menu_versions','guest_sessions','ai_usage_windows','idempotency_requests','outbox_events'))
order by schema_name, table_name, grantee, privilege_type;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where (schemaname = 'public' and tablename in ('restaurants','restaurant_memberships','orders'))
   or (schemaname = 'private' and tablename in ('menus','menu_versions','guest_sessions','ai_usage_windows','idempotency_requests','outbox_events'))
order by schemaname, tablename, policyname;

-- All same-name function overloads are returned to detect signature collisions.
-- Omit source bodies and arbitrary function settings; report only search_path.
select n.nspname as schema_name, p.proname as function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
       pg_catalog.pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       (select setting from unnest(p.proconfig) setting where setting like 'search_path=%' limit 1) as fixed_search_path,
       case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
where (n.nspname = 'public' and p.proname in
  ('publish_menu','read_published_menu','create_guest_session','validate_guest_session','consume_guest_ai_budget','quote_cart','submit_order','read_kitchen_orders'))
   or (n.nspname = 'private' and p.proname in
  ('is_member','reject_mutation','keys_exact','int_between','valid_name','validate_menu','price_cart'))
order by schema_name, function_name, arguments, grantee;

-- Schema grants can affect reachability independently of object grants and RLS.
select n.nspname as schema_name,
       case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type, a.is_grantable
from pg_catalog.pg_namespace n
cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
where n.nspname in ('public','private')
order by schema_name, grantee, privilege_type;

-- Existing defaults may grant access to additional roles beyond the migration's revokes.
select pg_catalog.pg_get_userbyid(d.defaclrole) as object_creator,
       coalesce(n.nspname,'<all schemas>') as schema_name,
       d.defaclobjtype as object_type,
       case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type, a.is_grantable
from pg_catalog.pg_default_acl d
left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
cross join lateral pg_catalog.aclexplode(d.defaclacl) a
where d.defaclnamespace = 0 or n.nspname in ('public','private')
order by object_creator, schema_name, object_type, grantee, privilege_type;

-- History structure only: do not select statements or assume a version row exists.
select n.nspname as schema_name, c.relname as table_name,
       a.attname as column_name, pg_catalog.format_type(a.atttypid,a.atttypmod) as column_type
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where n.nspname = 'supabase_migrations' and c.relname = 'schema_migrations'
order by a.attnum;

rollback;
