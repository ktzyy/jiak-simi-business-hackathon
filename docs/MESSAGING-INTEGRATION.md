> Local activation verified 13 September 2026: channel migration `20260913050159` applied; demo menu and restaurant binding ready; bot `@blackcharsiewbot` verified; one allowlisted private `/start` received a confirmed reply. Polling is running locally, not deployed. A complete customer order remains to be tested. Any older setup prerequisites below are now satisfied in Elsen’s workspace, not automatically in another checkout.

# Telegram ordering pilot

The Telegram webhook and provider-neutral conversation engine are implemented locally. Live Telegram ordering requires the reviewed messaging database extension, a configured bot, a published restaurant menu and server credentials. Use local polling for the laptop demo, or a reachable HTTPS deployment for webhooks. These files alone do not connect a bot or prove remote persistence. No live messages were sent during development.

## Customer flow

In a private chat with the configured bot, `/start` or `/menu` shows menu guidance. Send the complete order with quantities and saved options. The shared order-intent parser proposes lines; `quote_cart` validates them against the published menu and calculates the total. Unsupported or ambiguous options require a complete revised order. Each new order text replaces the draft; it does not silently accumulate line items.

A quote includes a **Place order** callback button. Only a callback with the current persisted confirmation nonce can submit the saved cart and reviewed total. Saying “yes”, instructions in a dish name, or model-generated confirmation cannot place an order. Submission produces the shared unpaid kitchen ticket with source `telegram`. `/status` retrieves the last receipt or current quote; `/cancel` clears an unplaced draft and never cancels a kitchen ticket. The menu and quote display use plain text, with no Telegram HTML/Markdown parsing.

The initial menu preview lists up to 15 available dishes with option groups. Very long previews fall back to asking for dish names from the stall menu. Quotes that cannot fit one review message require a smaller order instead of truncating confirmed contents. Voice notes, photo orders, group chats, bot senders and unallowlisted customers are outside this pilot.

## Server configuration

Set these only in ignored server environment or deployment secrets:

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather token; never expose in browser bundles, logs, shell history or source. |
| `TELEGRAM_BOT_ID` | Numeric bot ID verified using Telegram `getMe`; must match token prefix. |
| `TELEGRAM_WEBHOOK_SECRET` | Random 32–256 characters from A–Z, a–z, 0–9, underscore and hyphen. |
| `TELEGRAM_RESTAURANT_ID` | One authorized staging restaurant UUID bound by server configuration. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Comma-separated private customer chat IDs, 1–20 allowlisted demo users. |
| `OPENAI_API_KEY` | Existing server key for the shared intent parser. |
| Supabase server environment | Existing staging URL and secret/service credential used by `getBackendClient`. |

The restaurant/account never comes from customer text, request headers or callback contents. The route validates the webhook secret in constant time before parsing up to 64 KB of JSON. It accepts only private chats whose human sender ID matches their chat ID and the server allowlist. Database routines must bind the configured bot account to its restaurant as a second check. Keep all conversation recipients, capability hashes and outbox state server-only.

After bot setup and live-demo authorization, register HTTPS `/api/v1/messaging/telegram` using `setWebhook`, the configured `secret_token`, allowed updates `message` and `callback_query`, and `max_connections: 1` for this small pilot. Do not run `getUpdates` concurrently with an installed webhook. Telegram documents the webhook secret header and callback/update API in its [Bot API reference](https://core.telegram.org/bots/api#setwebhook). Bot setup and updates are described in [Telegram's bot tutorial](https://core.telegram.org/bots/tutorial). No credential should be pasted into a task response.

Use an authenticated setup script or secret-aware deployment tool for registration; do not put a token-bearing URL into a shell command, screenshot or log. Confirm the webhook status and make the customer initiate the private bot conversation. Setting configuration does not itself send customer messages.

## Local laptop polling

An HTTPS deployment is optional for the demo. After the SQL, bot identity and allowlist are ready and the user authorizes live messages, run:

```sh
node --conditions=react-server --env-file=.env.local --import tsx scripts/run-telegram-polling.ts
```

This starts real message processing and replies; it has not been run during development. The runner checks `getWebhookInfo` and refuses an active webhook. It keeps a per-bot lock directory under the operating-system temporary directory; stop the existing runner before starting another. If a crash left a stale lock, inspect its owner PID before removing it. The runner never deletes a configured webhook.

Polling uses `getUpdates` and advances its offset only after processing the whole batch durably. If a batch fails midway or the process restarts, the same updates replay through database deduplication; completed replies are not duplicated. Provider errors and database uncertainty retain the offset and retry after five seconds. Ctrl+C stops polling. Do not run a second polling host: the local process lock protects one machine, while database leases protect order processing but cannot coordinate Telegram polling offsets across machines.

## Durable processing contract

`src/server/messaging/core.ts` is independent of Telegram transport. `store.ts` calls these service-only RPCs through the existing Supabase backend; [Supabase's RPC documentation](https://supabase.com/docs/reference/javascript/rpc) describes this client mechanism.

| RPC | Required behavior |
| --- | --- |
| `messaging_claim_update(provider, account, restaurant, recipient, update, session-hash)` | Atomically deduplicate the provider/account/update; resolve the scoped conversation and guest session; return `status`, `conversationId`, `leaseId`, `state`, `sessionTokenHash`. Active conversation claims serialize processing. |
| `messaging_complete_update(conversation, lease, update, state, reply)` | Check lease, persist reviewed state and reply outbox, and complete input atomically before any outbound message. |
| `messaging_submit_order(conversation, lease, update, confirmation-nonce)` | Validate active lease and stored nonce under lock, then call core `submit_order` with stored session hash, cart, reviewed total, source and key; never accept callback prices/cart. |
| `messaging_claim_reply(conversation, update)` | Atomically mark first delivery attempt and return saved reply; repeat attempts return `already_attempted`. |
| `messaging_finish_reply(conversation, update, status, provider-message-id)` | Record `sent`, `not_sent`, or `unknown` without manufacturing another attempt. |

Exact named SQL arguments are in `store.ts`. The shared state is `{version:1,pending:{cart,quote,confirmationNonce,idempotencyKey}|null,lastTicket:Ticket|null}`. Reply state is `{text,confirmationNonce:uuid|null}`. The quote/nonce/key must be durably saved before showing its button. Unknown database submission outcomes retain this same state/key; retrying the same incoming callback recovers the original order even if the first response was lost.

Lease expiry must allow recovery of the same active update, not permit a different message to bypass a possibly committed confirmation. A lease-bound submit wrapper prevents an expired worker from placing an order after a newer state wins. The default route execution limit is 120 seconds; SQL lease should exceed it (proposed 180 seconds). Guest-session expiry/recreation must preserve any pending uncertain order's recovery identity. The implementation calls `consume_guest_ai_budget` before intent parsing: its existing durable limits are 20 calls per guest and 100 per restaurant per ten minutes. Apply any additional input limits in the durable claim path before public enablement.

A duplicate completed input still checks the saved outbox, allowing recovery after a crash between transaction completion and first send. A crash after marking delivery attempted, malformed provider acknowledgement or timeout remains an unknown send and is not automatically repeated. This favors avoiding duplicate receipts over guaranteed delivery; a new customer `/status` explicitly requests a receipt/quote again. `not_sent` is retained for operations and is also not automatically retried by this pilot. Telegram callback progress indicators are not separately acknowledged by this implementation; the reply is a normal chat message.

Restrict messaging tables/functions to service access; add RLS and least-privilege grants, TTL cleanup, scoped identity constraints and a durable update/reply audit. These are in the separately coordinated database extension, not created by this messaging lane. Do not enable the webhook until that extension and its SQL checks pass.

## Verification and remaining deployment checks

Run `node --conditions=react-server --import tsx --test tests/messaging.test.ts`. Mocked tests cover review before placement, replay after a simulated committed-order timeout, reconstructed handlers using persistent state, duplicate incoming updates, stale nonce/menu invalidation, unsupported modifier clarification, unknown outbound delivery, webhook authentication, recipient scoping and plain-text callback construction. These tests verify orchestration; they do not prove PostgreSQL concurrency or a real Telegram exchange.

Before calling this live: apply the approved messaging SQL, run its lease/dedup/atomic-order checks, verify the staging bot/restaurant binding and private allowlist, choose local polling or configure/inspect the HTTPS webhook, then have an authorized test customer order and explicitly tap Place order. Check the resulting kitchen ticket and replay the same update to confirm exactly one order. Interrupt a submission acknowledgement and verify same-key recovery. Confirm contact/chat identifiers never appear in public menu or kitchen payloads. Capture only redacted evidence.

WhatsApp personal-account automation is not implemented. The user selected Telegram for this demo; the shared engine keeps a provider boundary for a later separately reviewed WhatsApp Business adapter.
