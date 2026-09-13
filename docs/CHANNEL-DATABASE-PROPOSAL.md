# Reviewable channel database extension

**Approved and applied on 13 September 2026.** The user explicitly approved this extension. Supabase CLI 2.117.0 generated the migration; the exact reviewed SQL was applied once through the Management API to hackathon project `mikpepfrumtglwweolzq`. Remote migration version is `20260913050159`, name `jiak_simi_channel_ordering`; local file `supabase/migrations/20260913050159_jiak_simi_channel_ordering.sql` is aligned to that history. SQL SHA256 is `9f2b41f2d59287fd922183e4e48030894a14d1ded1634f19de35abfa8d20c5e9`. The file under `docs/` remains the byte-identical review snapshot, including its original draft header. No seed data or production changes were performed by this deployment.

The extension adds six private RLS-enabled tables and twelve service-only public RPCs for staff OCR quotas, staff-owned voice ordering, and Telegram conversations. It extends the existing immutable order `source` check to include `telegram` and replaces `submit_order` with its exact existing body except that additional source. Existing payment/status behavior remains `unpaid`/`received`. Browser roles receive no access to new tables or RPCs; server credentials and verified webhook/staff authorization remain mandatory. All definer functions fix an empty search path and reference qualified application objects.

| Storage | Purpose |
| --- | --- |
| `private.staff_ai_usage` | Atomic per-restaurant/per-operation allowance: 20 `extraction` calls or 20 `voice` calls in each 10-minute window. Active owner/editor membership required; multiple staff share the allowance. |
| `private.voice_sessions` | Original staff actor, restaurant, provider session identity, guest token hash, fixed 10-minute expiry, monotonically increasing review revision and pending quote/nonce/key. |
| `private.channel_order_receipts` | Durable `(channel, session, confirmation nonce)` receipts for exact confirmation recovery after application interruption. Contains immutable-ticket copies, not payment state. |
| `private.messaging_conversations` | Restaurant-bound provider/account/recipient identity, reusable guest hash, bounded state and a single active update lease. |
| `private.messaging_updates` | Provider/account/update deduplication and durable submitted-ticket evidence. An update cannot be reused for another recipient. |
| `private.messaging_replies` | Pending reply and attempt-before-send status. Unknown delivery is never automatically resent. |

## OCR and voice contract

`consume_staff_ai_budget(p_actor_id, p_restaurant_id, p_operation)` returns the restaurant UUID; `p_operation` is `extraction` or `voice`. The application verifies the staff JWT first. The database verifies active owner/editor membership and atomically spends the shared allowance before provider dispatch. Failed provider requests do not refund the allowance automatically.

Voice RPCs use `p_actor_id` and `p_voice_session_id`:

- `create_voice_session(p_actor_id,p_restaurant_id,p_provider_session_id)` creates a 10-minute session backed by a random guest hash and returns `{id,restaurantId,providerSessionId,status,sessionTokenHash,expiresAt}`. The hash is server-internal and must not be included in public HTTP responses.
- `read_voice_session` permits the original actor with active owner/editor membership to inspect even a closed/expired session for cleanup. `close_voice_session` is idempotent and clears pending review.
- `begin_voice_review` increments the revision and clears the old nonce **before** asynchronous parsing. `save_voice_review(...,p_cart,p_revision)` accepts only the current unsaved revision, computes the canonical quote, and returns `{quote,confirmationNonce,revision}`. A late parser result cannot overwrite a newer review.
- `submit_voice_order(...,p_confirmation_nonce)` submits only the stored cart/quote/key and returns the core Ticket. A stored nonce receipt can be recovered after close/expiry, while still requiring the original actor's active membership. New submissions require an active, unexpired session and matching nonce.

Errors include `FORBIDDEN`, `RATE_LIMITED`, `SESSION_EXPIRED`, `STALE_REVIEW`, and existing core menu/quote errors. The application must expose safe user-facing mappings for newly added business codes.

## Telegram contract

`messaging_claim_update(p_provider,p_account_id,p_restaurant_id,p_recipient_id,p_update_id,p_session_token_hash)` accepts provider `telegram`, string update IDs and a candidate random 64-hex guest hash. It returns `{status,conversationId,leaseId,state,sessionTokenHash}`; unavailable fields are null for `busy`/`duplicate`. The webhook must authenticate provider delivery and bind the configured bot/account to the restaurant before calling any messaging RPC.

A lease lasts 180 seconds. A different update remains busy while an earlier update is unresolved, including after lease expiry. Only redelivery of that same update may recover an expired lease. This prevents a newer callback from skipping an unresolved confirmation. Old workers cannot complete or submit after their lease is replaced. An abandoned update with no redelivery requires operator investigation; the draft deliberately provides no force-unlock shortcut.

State remains exactly `{version:1,pending:null|{cart,quote,confirmationNonce,idempotencyKey},lastTicket:null|Ticket}`. It is limited to 64 KiB. Pending review expires after 10 minutes; preserving its nonce cannot extend expiry or change its cart/quote/key. A new guest capability after expiry clears pending review. `messaging_complete_update(p_conversation_id,p_lease_id,p_update_id,p_state,p_reply)` validates canonical quote equality, source links implicit in the published cart, state continuity and reply structure, then atomically saves state and outbox reply. Reply is `{text:string<=4000,confirmationNonce:uuid|null}`; a callback nonce must match the pending review. Expired/stale reviews require a fresh quote.

`messaging_submit_order(p_conversation_id,p_lease_id,p_update_id,p_confirmation_nonce)` validates the current lease and stored nonce, then calls the existing core submit with source `telegram`. Ticket, receipt, pending-clear and last-ticket updates commit together. **The callback handler must call this RPC even when `pending` is null if it has a known confirmation nonce**: the durable receipt may recover a successful order after a process crash. It must not derive a fresh key or submit directly to the core RPC from a callback.

`messaging_claim_reply(p_conversation_id,p_update_id)` atomically changes ready to attempted before a network send and returns `{status:claimed|already_attempted,reply}`. `messaging_finish_reply(...,p_status,p_provider_message_id)` records `sent`, `unknown` or `not_sent`. An attempted/unknown/not-sent reply is not automatically claimed again; an operator or a new customer interaction can handle recovery without guessing whether a message was delivered. This favors avoiding duplicate messages over guaranteed automatic delivery.

## Validation and rollout

The local test file `tests/channel-database.test.mjs` executes the exact existing core and this draft in isolated PGlite with Supabase Auth role stubs. It checks quotas/membership, review revision races, nonce recovery, Telegram dedup/leases, quote tampering, pending expiry, reply attempt suppression, RLS and privileged RPC access. It also reruns all 53 existing core assertions after the extension. Local tests do not prove hosted pgTAP behavior, real two-connection timing or provider delivery.

Run with an installed PGlite module, for example `PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node --test tests/channel-database.test.mjs`. No dependency or environment file is modified by these tests.

Hosted validation now confirms six added tables all have RLS, all twelve added public RPCs are service-only with fixed search paths, and browser roles have zero table/function grants. Eighteen channel assertions and all 53 existing core pgTAP assertions passed remotely inside rollback-only transactions; privileged before/after checks confirmed empty application and channel tables with no test fixtures retained. Evidence is saved in `artifacts/database-deployment/channel-applied.json` and `channel-hosted-verification.json`. The security advisor reported informational no-policy findings on private deny-by-default tables, as designed, plus an existing project-level warning that leaked-password protection is disabled. No auth settings were changed.

These records have no automatic retention job: establish a deliberate post-demo purge/retention policy for provider recipient IDs, conversations and receipts. The extension does not store raw audio or menu images, connect WhatsApp, or send Telegram messages itself.
