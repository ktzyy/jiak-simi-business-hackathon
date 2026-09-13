# Supabase backend design — review proposal

Status: candidate architecture with an approved core migration now authored, 13 September 2026. The user explicitly approved **creation and application** to hackathon project `mikpepfrumtglwweolzq`; no further migration permission is needed within that approved scope. The parent integration workstream handles remote access and application. This workstream has not applied any remote changes. Joint API review with Kimberley remains separate from database authorization.

The initial [core migration](../supabase/migrations/20260913042355_jiak_simi_202609130001_core_ordering.sql) implements nine tables and service-only publish/read/session/quote/submit/kitchen RPCs, using an immutable validated JSON menu graph and ticket snapshots. [Rollback pgTAP tests](../supabase/tests/001_core_ordering.test.sql) passed all 53 assertions in embedded Postgres (PGlite 0.3.14) using stubbed Supabase Auth and SQL assertion compatibility helpers; true hosted pgTAP and concurrency tests remain pending. See [paused database checkpoint](checkpoint-database.md). The larger normalized table design below remains a staged proposal: Storage, extraction persistence, full channel conversations, demo-run grouping and durable cart/quote IDs are not created by the core migration. Do not confuse proposed tables with applied schema. Supabase replaces Neon; this project is the sole authorized target, never production.

Core RPC signatures (all return JSON except session creation; EXECUTE granted only to `service_role`):

- `publish_menu(p_restaurant_id uuid, p_actor_id uuid, p_menu jsonb) → jsonb` (Menu); backend verifies staff JWT and database verifies owner/editor membership. Requires next numeric version.
- `read_published_menu(p_restaurant_id uuid) → jsonb` (Menu).
- `create_guest_session(p_restaurant_id uuid, p_token_hash text) → uuid`; backend hashes a random capability to lowercase SHA-256 hex, with two-hour expiry.
- `validate_guest_session(p_session_token_hash text, p_restaurant_id uuid) → uuid`; checks active matching capability without consuming budget.
- `consume_guest_ai_budget(p_session_token_hash text, p_restaurant_id uuid) → uuid`; validates and atomically consumes per-guest 20/10-minute and per-restaurant 100/10-minute budgets, otherwise `RATE_LIMITED`.
- `quote_cart(p_session_token_hash text, p_cart jsonb) → jsonb` (Quote).
- `submit_order(p_session_token_hash text, p_cart jsonb, p_reviewed_total_cents bigint, p_source text, p_idempotency_key uuid) → jsonb` (Ticket). Backend must enforce `confirmed: true` before RPC; model assertions are insufficient.
- `read_kitchen_orders(p_restaurant_id uuid, p_actor_id uuid) → jsonb` (`{orders: Ticket[]}`); backend verifies staff JWT and database verifies active membership.

The core stores canonical JSONB request bodies for exact retry comparison. JSON object key order does not matter; line/option array order remains part of request identity. Tokens must be generated and hashed by the trusted backend, never supplied as a browser-selected tenant credential. Core tables have deny-default RLS; only member-scoped SELECT is granted on restaurants, memberships and orders. No anonymous RPC access is granted.

## Decisions that must be reconciled before implementation

Reviewed PR #1 differences: its original payment flow (`received → paid → preparing → ready`), `qr | voice | demo` sources and permissive free-text modifiers differ from the approved unpaid-order handoff. The new [candidate v1 types](../src/shared/contracts.ts) use `source = web | whatsapp | voice`, `status = received`, and `paymentStatus = unpaid`. They accept saved option IDs only; unsupported free-text modifications require clarification and cannot be submitted. These candidate types are ready for joint review, not jointly frozen. Optional fulfillment states or free-text instructions require a later contract extension. No payment operation is proposed.

WhatsApp adds a narrowly scoped recipient identifier needed to reply; this needs a reviewed exception to the original no-customer-identity rule, with restricted access and short retention. Never reuse production customer data. Keep `demo_session_id` separate from transport so synthetic runs identify their actual channel.

**Implementation boundary:** candidate v1 currently defines a pure quote (`restaurantId`, stable UUID `menuId`, numeric `menuVersion`, lines and total), with no persisted cart or quote identifier. Submission carries the cart request, `reviewedTotalCents` and explicit `confirmed: true`. The durable cart/quote/session design below is a proposed persistence phase, not a claim that the current API implements it. Adding cart revisions, quote IDs or expiry to public requests requires a coordinated contract extension. The initial persistence adapter can instead accept v1's full cart request, recalculate it, compare the reviewed total and persist an immutable ticket atomically using a request idempotency key. It must not invent mandatory quote IDs absent from v1.

Kimberley owns all four screens, including kitchen UI, per the approved handoff; [TEAM_WORKFLOW.md](TEAM_WORKFLOW.md) assigns kitchen display differently and needs correction by the integration owner. Elsen owns APIs, validation, data and integration. This document does not change those shared files.

The user subsequently explicitly approved creating and applying this hackathon schema. That satisfies [AGENTS.md](../AGENTS.md) for this scope; application remains the parent integration workstream’s responsibility. Production changes and unrelated external setup remain outside this approval.

## Architecture and access boundary

Supabase provides Postgres, staff Auth and private Storage. Next.js server endpoints mediate all customer actions and authoritative mutations. One deterministic quote/submit service serves web, WhatsApp and live voice; models return untrusted intent only. Staff reads may use an authenticated Supabase client with the publishable key and the user's verified session. Secret credentials remain in local ignored environment files or deployment secret settings, never in browser code, fixtures or logs.

Place browser-readable restaurant, membership, published menu and kitchen tables in an exposed schema with explicit grants and restaurant-membership RLS. Keep conversations, guest credentials, cart internals, model jobs, webhook payloads, idempotency and outbox in an unexposed `private` schema with no `anon` or `authenticated` grants. All tenant tables still receive RLS; server-only tables have no client policies. Prefer a restricted backend database role with only required functions/table privileges. If the initial adapter uses a Supabase secret client, its elevated access bypasses RLS: every endpoint must independently resolve the actor and restaurant and constrain every query. This is not a substitute for testing browser RLS.

Public storefront reads go through a server endpoint that returns an allowlisted projection of a published restaurant and its current published, available menu. Anonymous callers receive **no direct table grants**, satisfying the repository's membership-only exposed-table boundary. Customer cart/order access requires an expiring bearer capability verified by the server, not knowledge of a UUID. Store only a hash of the capability. Staff roles are `owner`, `editor`, `kitchen`; do not authorize from user-editable metadata.

Supabase requires both grants and policies; enabling RLS alone does not define usable access. Views need deliberate treatment because ordinary views can bypass underlying RLS; avoid views initially, or use `security_invoker` with corresponding base-table permissions. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Schema conventions

Unless noted, every table has a UUID primary key, `restaurant_id`, `created_at timestamptz`, and tenant-local uniqueness `(restaurant_id, id)` for composite foreign keys. Mutable rows additionally carry `updated_at` and integer `revision` for optimistic concurrency. References between tenant records use composite foreign keys containing `restaurant_id`; a valid UUID from another stall must never satisfy a relation. Use `timestamptz` for database times, UTC ISO strings at the API, integer cents and `currency = SGD`. Validate bounded input lengths, quantities and arithmetic overflow in server code and database checks. JSON is for bounded snapshots/model drafts, not authorization rules or authoritative relational prices.

### Restaurant and staff

| Table | Important columns | Constraints and indexes |
| --- | --- | --- |
| `restaurants` | `id`, `name`, `slug`, `description`, `primary_color`, `logo_asset_id`, `published`, `current_menu_version_id`, `currency`, timestamps | Unique normalized `slug`; currency SGD; current version composite FK back to this restaurant; publication requires an approved published version |
| `restaurant_memberships` | `restaurant_id`, `user_id → auth.users`, `role`, `active`, timestamps | PK `(restaurant_id,user_id)`; role allowlist; index `(user_id,active,restaurant_id)`; membership administration only through owner-checked operation; protect last active owner |
| `demo_sessions` (private) | `id`, `restaurant_id`, `label`, `created_by`, `expires_at`, `closed_at`, `kitchen_token_hash` | Synthetic run boundary; expiry after creation; hashed optional kitchen capability distinct from customer token; index expiry for cleanup |

Initial owner bootstrap is a reviewed setup operation; no self-enrollment or browser membership insertion. Deactivating membership immediately removes subsequent API/database access; do not rely on a stale JWT role claim.

### Menu, versioning and merchant review

| Table | Important columns | Constraints and indexes |
| --- | --- | --- |
| `menus` | stable `id`, `restaurant_id`, `name` | Unique `(restaurant_id,id)`; one menu per restaurant for MVP |
| `menu_items` | stable `id`, `restaurant_id`, `archived_at` | Identity only; never overwrite historical display/price data here |
| `modifier_groups` / `modifier_options` | stable `id`, `restaurant_id`, `archived_at`; option has stable `group_id` | Composite tenant FKs; options cannot change stable parent group |
| `menu_versions` | `id`, `restaurant_id`, `menu_id`, `version_number`, `status: draft/published`, `currency`, `extraction_job_id`, `reviewed_by`, `reviewed_at`, `published_at` | Unique `(restaurant_id,menu_id,version_number)`; published requires review actor/time; published content immutable |
| `menu_version_items` | `id`, `restaurant_id`, `menu_version_id`, `menu_item_id`, `category`, `name`, `description`, `base_price_cents`, `image_asset_id`, `available`, `published`, `sort_order` | Unique `(restaurant_id,menu_version_id,menu_item_id)`; nonnegative integer price; names nonempty; index version/order |
| `menu_version_groups` | `id`, `restaurant_id`, `menu_version_id`, `group_id`, `name`, `min_selections`, `max_selections` | Unique version/group; `0 ≤ min ≤ max`; reviewed option count must support minimum |
| `menu_version_item_groups` | `restaurant_id`, `menu_version_id`, `menu_item_id`, `group_id`, `sort_order` | PK all four IDs; FKs to item and group in same version |
| `menu_version_options` | `id`, `restaurant_id`, `menu_version_id`, `group_id`, `option_id`, `name`, `price_delta_cents`, `available`, `sort_order` | Unique version/option; FKs to stable option and version group; signed integer deltas permitted, final unit price cannot be negative |
| `menu_assets` | `id`, `restaurant_id`, `bucket`, `object_path`, `kind: source/menu_image/logo`, `mime_type`, `byte_size`, `sha256`, `created_by` | Unique bucket/path; byte limit and MIME allowlist; source assets never enter public projection |
| `extraction_jobs` (private) | `id`, `restaurant_id`, `asset_id`, `state: queued/running/needs_review/approved/failed`, `model`, `schema_version`, `attempts`, `lease_until`, `raw_draft`, `reviewed_draft`, `warnings`, `error_code`, `approved_by`, `approved_at`, `result_menu_version_id` | Approval requires actor and reviewed draft; unique result version; index `(state,lease_until)`; raw output is untrusted and size bounded |

API `menuId` maps to stable `menus.id`; API numeric `menuVersion` maps to `menu_versions.version_number`. Resolve both plus restaurant to the internal `menu_versions.id` UUID, which is never substituted for the API version number. API `dishId` maps to stable `menu_items.id`, qualified by that resolved version; internal version-item row IDs never replace it. Modifier group/option IDs are stable in the same way. The public contract's `priceCents` maps to `base_price_cents`, while cart unit price includes selected price deltas.

Editing clones a published version into a draft; publishing freezes its entire item/group/option graph. Database guards must reject insert/update/delete of child content under a published version as well as modifications of published version fields. Availability changes publish a new version in the MVP, avoiding mutable exceptions to immutability. Archive identities rather than deleting records referenced by tickets. A stable restaurant pointer identifies the current version; older published versions remain historical and are not orderable.

Extraction stores the original image privately, attempts a bounded model call, and validates its structural output. Missing/ambiguous prices remain unresolved, never default to zero. Merchant correction and explicit approval are required; zero is allowed only when deliberately approved. Approval maps proposed rows onto stable identities (or creates new ones), prevents accidental duplicates, and produces a publishable draft. A job cannot approve itself.

### Channels, carts and orders

| Table | Important columns | Constraints and indexes |
| --- | --- | --- |
| `channel_accounts` (private) | `id`, `restaurant_id`, `channel`, `provider`, `external_account_id`, `credential_reference`, `enabled` | Unique provider/account; reference to secret storage only, no token plaintext |
| `conversations` (private) | `id`, `restaurant_id`, `demo_session_id`, `channel_account_id`, `channel`, `provider_thread_key_hash`, `recipient_ciphertext`, `guest_token_hash`, `expires_at`, `state`, `next_sequence` | Token hash unique when present; provider session lookup index; tenant/demo FKs; recipient decrypted only for delivery; do not persist raw audio by default |
| `conversation_messages` (private) | `id`, `restaurant_id`, `conversation_id`, `sequence`, `direction`, `provider_message_id`, `text_redacted`, `intent_json`, `created_at` | Unique conversation/sequence; unique provider/account/message for inbound dedup; bounded content; no authoritative prices from model |
| `carts` (private) | `id`, `restaurant_id`, `demo_session_id`, `conversation_id`, `menu_version_id`, `state: draft/quoted/submitted/expired`, `revision`, `expires_at`, `submitted_order_id` | Composite scope FKs; one submitted order per cart; edits invalidate quote and increment revision |
| `cart_lines` (private) | `id`, `restaurant_id`, `cart_id`, `menu_item_id`, `quantity`, `option_ids`, `sort_order` | Quantity 1–20 (candidate v1 limit); selected IDs unique; item/version membership and allowed combinations validated at quote/submit |
| `cart_quotes` (private) | `id`, `restaurant_id`, `cart_id`, `cart_revision`, `menu_version_id`, `canonical_snapshot`, `subtotal_cents`, `total_cents`, `currency`, `expires_at` | Immutable; nonnegative totals; unique cart/revision; no fees in demo so total=subtotal |
| `orders` | `id`, `restaurant_id`, `demo_session_id`, `conversation_id`, `cart_id`, `menu_version_id`, `display_number`, `source`, `status`, `payment_status`, `subtotal_cents`, `total_cents`, `currency`, `placed_at`, `revision` | Unique cart; unique restaurant/display number; payment unpaid; status proposal above; amount checks; index `(restaurant_id,demo_session_id,placed_at,id)` and `(restaurant_id,status,placed_at)` |
| `order_items` | `id`, `restaurant_id`, `order_id`, `menu_item_id`, `name_snapshot`, `base_price_cents`, `unit_price_cents`, `quantity`, `line_total_cents`, `modifiers_snapshot`, `sort_order` | Composite tenant/order FK; immutable snapshot; unit≥0; line total=unit×quantity; modifiers include saved option ID/name/delta; no free-text modifiers in v1 |
| `order_events` | `id`, `restaurant_id`, `order_id`, `sequence`, `event_type`, `from_status`, `to_status`, `actor_user_id`, `created_at` | Append only; unique order/sequence; contains no conversation text or recipient identifier |
| `order_number_counters` (private) | `restaurant_id`, `next_number` | PK restaurant; atomic increment under submit transaction; never use `max()+1` |

Customer order responses include only that customer's immutable receipt and status, verified through its conversation capability. Staff kitchen reads show the approved ticket projection, excluding recipient metadata and model transcripts. Capability credentials are never encoded into an unprotected shared kitchen QR. Any demo kitchen capability is server-validated and limited to one synthetic run; it confers no direct Supabase access.

### Reliability and minimal audit

| Table (private) | Important columns | Constraints and indexes |
| --- | --- | --- |
| `idempotency_requests` | `restaurant_id`, `conversation_id`, `operation`, `key`, `request_hash`, `order_id`, `response_snapshot`, `created_at`, `expires_at` | Unique `(restaurant_id,conversation_id,operation,key)`; immutable committed result; retain receipt lookup at least as long as the associated order |
| `inbound_events` | `id`, `restaurant_id`, `channel_account_id`, `provider_event_id`, `payload_redacted`, `state`, `attempts`, `lease_until`, `last_error` | Unique account/provider event; validate webhook signature before insert; index pending/lease; distinguish message events from delivery receipts |
| `outbox_events` | `id`, `restaurant_id`, `aggregate_id`, `event_type`, `dedup_key`, `payload`, `state`, `attempts`, `available_at`, `lease_until`, `provider_message_id` | Unique dedup key; index `(state,available_at)`; payload holds references, not credentials |
| `audit_events` | `id`, `restaurant_id`, `actor_user_id`, `action`, `target_id`, `request_id`, `created_at`, `metadata_redacted` | Append only; index tenant/time; record publish, membership and status changes without secrets/customer content |

## Atomic operations

**Publish menu:** authenticate editor/owner, lock the restaurant row, verify expected current version, validate the complete reviewed draft and modifier constraints, allocate version number, freeze the graph, update current version pointer and write audit event in one transaction. Concurrent publications return a revision conflict. Quote and submit use the same restaurant lock protocol so a concurrent publication cannot slip between stale-version validation and commit.

**Durable quote (proposed persistence phase):** authenticate the guest capability, verify unexpired active demo session/conversation, lock restaurant then cart, require expected cart revision and current published menu version, validate item availability, group selection limits, unknown/duplicate/conflicting options, quantities and supported saved selections. Compute `unit = base + sum(option deltas)`, `line = quantity × unit`, `total = sum(lines)` with overflow checks. Persist an immutable quote. Unsupported free text returns clarification; it is not an accepted cart field. A stale version returns `STALE_MENU` and requires customer review plus a fresh quote; never silently move a cart forward.

**Durable submit (proposed persistence phase):** authenticate actor/capability and resolve restaurant from server-owned context. Normalize semantic request fields and hash cart ID/revision, quote ID, menu version, confirmed selections and reviewed total; exclude any untrusted item price claims. For the current v1 shape, hash the canonical full cart request, reviewed total and confirmation instead, without nonexistent persisted IDs. Begin one database transaction; claim the unique idempotency key. A concurrent conflict waits for the first transaction: same hash returns the stored receipt even if the menu subsequently changed; different hash returns `IDEMPOTENCY_CONFLICT`. Do this replay lookup before revalidating expired quotes. For a fresh request, lock restaurant then cart, require explicit customer placement, validate quote freshness/revision and current menu again, recalculate totals and compare the customer-reviewed total, then write order, all immutable items, initial event, cart submitted pointer, counter increment, idempotency receipt and outbox together. Commit before acknowledging success. Any failure rolls everything back. Do not call a model/provider or send a message inside this transaction.

Once durable cart IDs exist, a new idempotency key for an already submitted cart returns its original receipt when the request matches, otherwise a cart conflict; the unique cart constraint prevents a second order. The current v1 full-cart submission has no stable cart ID, so its first persistence implementation can guarantee duplicate suppression only for the same idempotency key; changing the key is a distinct submission. If connection loss leaves commit uncertain, retry the same key. A sequence of Supabase `.insert()` calls is not an atomic transaction: use a single reviewed Postgres function/RPC or a server database connection transaction. Restrict function execution explicitly; use invoker rights where possible. If definer rights are needed, set a safe empty search path, fully qualify objects and recheck authorization. [Supabase database functions](https://supabase.com/docs/guides/database/functions)

**Kitchen status:** the initial slice is read-only and remains `received` / `unpaid`. If fulfillment controls are subsequently approved, require verified owner/kitchen membership, tenant-scoped lookup, expected revision and legal transition checks; update status plus append-only event in one transaction. No direct browser update grant.

**Inbound and outbox:** webhook signature verification precedes durable event insert; acknowledge provider receipt only after that insert, then process asynchronously. Workers claim rows with bounded leases and retry limits. Deduplicate both provider event IDs and order submissions. Claim work in a short transaction, call provider outside it, then record result. Delivery is at least once; a crash after a provider accepts a reply may produce a duplicate unless that provider supports an idempotency mechanism. Never promise exactly-once messaging. Provider failure cannot undo a placed order. Failed events retain an actionable error and can be retried by the operator.

## RLS, grants and Storage policy matrix

| Resource | Anonymous direct DB | Active restaurant member | Server operations |
| --- | --- | --- | --- |
| Restaurant and published menu graph | None | SELECT own restaurant; editor/owner may read drafts | Project public storefront; validate all mutations |
| Memberships | None | SELECT own membership only | Owner-scoped administration/bootstrap |
| Orders/items/events | None | SELECT own restaurant's tickets | Submit and role-checked status transition |
| Menu assets metadata | None | SELECT own restaurant; kitchen role excluded from source assets | Register/approve assets |
| Private tables | None | None | Explicit tenant and capability checks; minimum privileges |

Every exposed table has RLS enabled and explicit least-privilege grants in the same eventual reviewed migration. Membership checks use a narrowly scoped helper in an unexposed schema to avoid recursive membership policies; it checks `(select auth.uid())`, tenant and active role, returns only a boolean, uses a safe search path and has no public broad EXECUTE grant. No policy trusts request-provided restaurant ID alone. Child policies independently enforce membership. Staff mutations run through authenticated endpoints with database authorization checks; do not pass an arbitrary user ID into an elevated function as proof of identity. The integration must either propagate verified Supabase JWT identity or use a backend-only role that authenticates it first.

Use private `menu-source` and `menu-published-assets` buckets. Object paths are `restaurant_id/asset_id/safe_filename`. Source upload/read is restricted to active owner/editor membership, checked against the first folder segment; object updates cannot move tenants. Limit content type and file size; server verifies actual image bytes before extraction. Public menu image URLs are short-lived signed reads issued only after the server verifies that the asset belongs to the current published menu. Do not put source photographs in a public bucket. With private buckets, downloads need authorization or a signed URL. [Supabase Storage access](https://supabase.com/docs/guides/storage/buckets/fundamentals)

Kitchen initially polls the authenticated API every two seconds using a `(placed_at,id)` cursor and status refresh. Realtime is optional: explicitly add only safe ticket tables to the publication and preserve member SELECT policies; channel filters are not authorization. Reconnect always refetches canonical data. Do not publish conversations or private event payloads. Supabase checks subscriber access for Postgres Changes and documents throughput considerations. [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)

## Retention and demo isolation

Suggested demo defaults: guest/voice sessions expire after two hours, quotes after five minutes, source photographs and redacted transcripts after 24 hours, synthetic tickets after seven days. These are proposed configurable limits, not existing jobs. Keep idempotency records for the full ticket retention period so delayed retries do not recreate receipts; expired capabilities prevent new activity. Retain delivery recipient ciphertext only through active messaging and pending deliveries, then delete it. Encrypt recipient data with an application-managed key kept outside the database; use a keyed hash for lookup to resist phone-number enumeration. Raw audio is streamed, not stored.

Each demo run has a server-created session; cart, conversation and order relationships must agree on tenant and demo scope through composite uniqueness/FKs (including session ID where relevant). Public storefront content can be shared between runs; private kitchen tickets cannot. Closing/resetting a demo session disables its capabilities and hides its active queue rather than truncating shared tables. A scheduled retention worker uses the Storage API to remove objects and then deletes eligible metadata in dependency order; DB cascades do not remove stored image bytes. Logs contain request IDs, timings and sanitized error codes, never credentials or full webhook bodies.

## Integration and approval checkpoints

1. Reconcile unpaid status, source/channel values, immutable version shapes, privacy exception and kitchen ownership in the shared contract. Supply matching typed fixtures to Kimberley before she binds screens.
2. Verify access to the existing non-production Singapore project. Obtain its URL/publishable key locally; establish staff sign-in, initial owner identity, allowed redirect origins and a backend credential strategy without sharing secrets in chat.
3. Creation and application were explicitly approved. Review the authored core migration, grants, RLS, transactional functions and allow/deny tests together, then apply only to the named hackathon project; no remote Table Editor improvisation.
4. Prove allow/deny behavior for anon, unaffiliated signed-in user, owner/editor/kitchen and cross-restaurant IDs, including Storage. Test expired/revoked guest tokens, cross-demo references, published-child mutation, unknown prices/options, stale versions, negative computed prices, concurrent duplicate submits, changed-key contents, rollback and outbox retries. Run the database tests and security advisors after approved application.
5. Integrate one photo → reviewed draft → published menu → reviewed quote → persisted unpaid ticket on a second device. Persisted mode must be distinguishable from in-memory fixtures. Test lost submit acknowledgement with a same-key retry.
6. Add web and live microphone/speaker through the same cart service. Realtime voice session secrets are short-lived and server-minted; database stores only references/metadata. Microphone permission and actual hardware behavior require device testing.
7. Add WhatsApp once the provider account, eligible business number, webhook URL/signature secret and send permissions are configured. A personal WhatsApp login alone is not a database integration. Provider setup and its number eligibility must be verified by the integration workstream; this design does not claim the user's current account can already receive API orders.

Deferred: payments, production migration, inventory/POS, delivery, customer accounts, analytics/embeddings and automatic merchant onboarding. They are unnecessary to prove the complete approved ordering path.
