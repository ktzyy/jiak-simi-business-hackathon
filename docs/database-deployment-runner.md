# Approved core database deployment runner

`scripts/apply-approved-database.mjs` is limited to project `mikpepfrumtglwweolzq` and the exact existing core migration SHA256 `93cc7ec835c22b5747f5719268cf46a247388a89eea44ac0a4c5d4d63d790958`. It does not create a project, obtain credentials, seed menus/users, edit the migration, or run the empty-table regression suite.

Use a Supabase Management API personal access token in ignored `.env.local` as `SUPABASE_ACCESS_TOKEN`. This is different from a publishable key or a service-role API key. No token or provider response body is logged. Run from the repository:

```sh
node --env-file=.env.local scripts/apply-approved-database.mjs
node --env-file=.env.local scripts/apply-approved-database.mjs --apply
```

The default performs project metadata/history reads and a catalog-only SQL query through the dedicated read-only endpoint. It verifies `ref` and `ACTIVE_HEALTHY` status, expected auth/role prerequisites, and absence of target tables, functions and indexes. It stops on unrecognized response formats or access errors. `--apply` uses the user's recorded authorization for this exact hackathon migration. It dispatches the approved file once through the migrations endpoint, then verifies recorded history and catalog counts/grants/RLS. No retries or automatic cleanup occur.

Before mutation, a local exclusive-create receipt is written to `artifacts/database-deployment/approved-migration-dispatch.json`. This is deliberately retained even when dispatch or verification fails. A transport error, HTTP error or interruption after dispatch has an unknown outcome: reconcile remote history and objects using read-only access before any further action. Do not delete this receipt just to retry. The receipt is not a remote lock across machines; keep one deployment owner and do not run concurrent deployment tasks. Existing objects/history produce `existing_state_requires_reconciliation`, never reapplication or a claim that the installed SQL exactly matches the approved file.

The Management API chooses the remote migration version; its documented apply body has `query`, optional `name`, and optional `rollback`, with no client-supplied version. The runner uses the distinctive name `jiak_simi_202609130001_core_ordering` and prints the observed numeric remote version after verification. Preserve that result and reconcile local migration naming/history before a later CLI push. Do not assume remote version `202609130001` matches the local filename, and do not rewrite history automatically.

The exact approved SQL includes its own transaction wrapper and is sent unchanged. If schema application succeeds but history recording/response fails, the runner cannot establish atomic success and stops for reconciliation. Hosted API compatibility, Supabase Auth, Data API exposed-schema settings and two-connection concurrency remain separate checks. Catalog checks cover the expected core objects and browser grants; they are not a full security-advisor audit of unrelated project objects. The manual `supabase/tests/000_remote_preflight.sql` exposes additional schema/default ACL details for review before application, especially if the project already contains other objects or a `private` schema.

Verification: nine mocked runner tests pass with `node --test tests/database-deployment.test.mjs`; scoped ESLint passes. The exact catalog query executes successfully in fresh local PGlite both before and after the approved migration with stubbed auth roles. After migration it reports nine RLS tables, 15 functions, four indexes, eight protected server RPCs, three staff-readable tables/policies, and zero forbidden browser write/private-read/function grants. These are local checks, not evidence of a hosted deployment.

Official API references verified 13 September 2026: [get project](https://supabase.com/docs/reference/api/v1-get-project), [list migration history](https://supabase.com/docs/reference/api/v1-list-migration-history), [read-only SQL](https://supabase.com/docs/reference/api/v1-read-only-query), [apply migration](https://supabase.com/docs/reference/api/v1-apply-a-migration). Required fine-grained permissions are project metadata read, database read, migration history read, and migration write for application. The read-only SQL API is labelled beta; an unexpected response stops the runner instead of falling back to a general write-capable query endpoint.

## Hosted rollback regression verification

After initial application, while the nine core tables are still empty, run:

```sh
node --env-file=.env.local scripts/verify-database-hosted.mjs
```

This separate runner sends the SHA-pinned existing 53-assertion suite through the documented [SQL query API](https://supabase.com/docs/reference/api/v1-run-a-query). It requires database write permission because test fixtures, temporary tables and a transaction-local pgTAP installation may be created, then rolled back. It checks that all nine application tables are empty and fixed fixture auth-user IDs are absent before any test dispatch, then locks the application tables briefly and repeats the check inside the transaction. It does not run against a populated database. Existing pgTAP must be in `extensions`, otherwise preflight stops rather than relocating it.

Every assertion's TAP text is collected in a temporary table. A SQL gate requires exactly 53 successful assertions and rejects failures/skips before rollback. The final SELECT after rollback contains a unique per-run marker; without that exact marker, the HTTP response cannot count as a pass. The runner independently reads the fixture guard again to verify cleanup. Both pre/post guards are strictly SELECT-only queries on the normal query endpoint with `read_only:false`, and require `current_user` to have `rolsuper` or `rolbypassrls`. The dedicated read-only endpoint runs as `supabase_read_only_user` and can hide rows under RLS, so it cannot authoritatively prove fixture absence. Provider error bodies are suppressed and no test request is retried. An API result shape that hides the final SELECT is reported as unconfirmed, even with HTTP success. These checks avoid relying on intermediate SELECT results being returned by a multi-statement API.

Eight mocked runner tests and scoped lint pass. The exact transformed suite passed in local PGlite using compatibility assertion helpers, followed by an empty-fixture check. A negative local run returning `not ok` TAP output raised `HOSTED_TAP_ASSERTIONS_FAILED` before the final marker and was rolled back. Real pgTAP and hosted API behavior must still be verified by the actual hosted run; the local helper run is not a claim of hosted success.

## Executed deployment record

On 13 September 2026 the parent applied the approved migration to `mikpepfrumtglwweolzq`. Observed remote version `20260913042355`, name `jiak_simi_202609130001_core_ordering`. Local filename was aligned afterward; SQL SHA is unchanged. Catalog verification passed, then the hosted runner passed all 53 real pgTAP assertions and confirmed rollback/empty core tables. Do not reapply this migration. Existing-state reconciliation output from the apply runner is expected now. See `checkpoint-database.md` for remaining acceptance work and advisor findings.
