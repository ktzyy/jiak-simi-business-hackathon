# Database checkpoint — applied and hosted-tested, 13 September 2026

Target: `mikpepfrumtglwweolzq`, the explicitly approved nonproduction project. User's existing creation/application approval was used. Management credential and existing server-only project key are now securely configured in ignored `.env.local`; never print values or commit that file.

## Applied migration

- Remote version: `20260913042355`.
- Remote name: `jiak_simi_202609130001_core_ordering`.
- Local file: `supabase/migrations/20260913042355_jiak_simi_202609130001_core_ordering.sql`.
- Exact approved SHA256: `93cc7ec835c22b5747f5719268cf46a247388a89eea44ac0a4c5d4d63d790958`.
- Local file was renamed to match observed remote history; SQL was not changed. Keep only this migration. Do not apply the old timestamp again or repair hosted history back to it.
- Applied via Management API runner after project/empty-object preflight and default ACL review. Read-only API uses `supabase_read_only_user`; hosted fixture validation instead uses a strictly SELECT-only privileged query so RLS cannot hide rows.

## Hosted verification

Nine tables and all nine RLS flags, 15 total functions, eight restricted server RPCs, four application indexes and three staff policies/read grants verified. Forbidden browser writes, private-table reads and non-policy function execution grants all zero.

**53 real hosted pgTAP assertions passed.** The script collected each TAP result, required exactly 53 successful assertions, rolled back fixtures and confirmed empty core tables/fixed test-user absence afterward. No test users, restaurants, menus, orders or outbox entries remain. This is real hosted PostgreSQL/Auth-schema verification, not the earlier stubbed PGlite result. Multi-connection racing and UI/browser acceptance remain untested.

The server adapter reached hosted PostgREST: an unknown/unpublished restaurant produced expected 404 UNKNOWN_MENU, and anonymous kitchen access returned 401. No merchant menu was approved/published; no real customer order submitted.

Security advisors: zero ERROR findings; six INFO findings for deliberately policy-less private RLS tables; WARN for disabled Auth leaked-password protection. Performance advisors: five missing foreign-key covering indexes and four unused indexes (INFO). Preserve denied private browser access; do not add broad policies to clear informational lints. Review Auth warning and index followups before public launch.

## Saved runners and next work

- `scripts/apply-approved-database.mjs`: pinned project/SQL, preflight, single dispatch and catalog checks. Existing schema/history stops reapplication.
- `scripts/verify-database-hosted.mjs`: empty-project-only rollback suite; no automatic retries.
- `artifacts/database-deployment/approved-migration-dispatch.json`: ignored dispatch reservation, retain for reconciliation; not a success receipt by itself.
- `docs/FIRST-BACKEND-SYNC.md`: review package for Kimberley's agent, not delivered yet. User selected her Codex link; PR publication is on hold.

Bootstrap only the agreed restaurant/staff membership, then perform real reviewed-menu → web cart → unpaid ticket → kitchen acceptance. Voice stays with Elsen; WhatsApp, photo enhancement storage, full channel persistence and deployment remain unfinished.
