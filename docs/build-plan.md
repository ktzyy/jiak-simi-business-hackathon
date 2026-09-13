# Jiak Simi Business — shared build plan

## Status and goal

Implementation is authorized in Kimberley's task, within the ownership boundaries below. This handoff pack completes independent preparation; frontend implementation waits for Elsen's frozen API contract/client/fixtures. The existing starter has been cloned at fbc7c52. Elsen remains the sole repository/Site setup, backend and deployment owner. His receiving session should establish authorization before taking infrastructure actions.

Repository reconciliation note: the provided starter uses Supabase, src/app/, kim/front-of-house and husband/ai-butler, and an older payment/kitchen contract. Preserve that setup pending Elsen's contract reconciliation; see docs/repository-alignment.md. The original architectural defaults below are not permission to create a second database or override shared files.

Deliver a publicly deployed working app, a public GitHub repository and an exactly 90-second public demo video before 3:30pm Singapore time. The build is a five-hour hackathon demonstration, not a production restaurant deployment.

## Protected MVP

One real hawker-menu photograph → AI extraction → editable merchant approval → branded mobile menu and QR → tap or typed natural-language order → server-validated/priced cart → explicit placement → persisted unpaid kitchen ticket visible on a second device.

Defaults: one stall, roughly 8–12 dishes, SGD, English/Singlish. Do not truncate a chosen menu silently; choose a suitably sized menu/photo. A photograph and its prices/options have not yet been supplied to Kimberley's task. The sample wanton-mee order is illustrative until supported by the real menu and merchant-approved options.

Exclude payment integration, delivery, inventory, POS/printers, analytics, multi-stall management, account onboarding, generated food photography, translation, consumer discovery features and custom illustrations. Push-to-talk is optional.

## Architecture and model routing

TypeScript, React, Tailwind, Sites' Next-compatible starter, server route handlers, Zod shared contracts and Neon Postgres. Persist approved versioned menus and order snapshots. Transiently handle photographs for extraction; do not retain originals in the application or public Git history by default. Kitchen polls every two seconds.

Sites first. Keep business logic and database access independent of Sites-native storage. Prove a conventional Next.js build for Vercel early; use the same database on fallback. Do not claim compatibility until built and smoke-tested. Runtime credentials, model availability, public Sites access and Neon/Vercel access are unverified dependencies.

Astra assists architecture, schemas, prompts, integration and adversarial tests. Start runtime extraction/parsing with `gpt-4o-mini`; allow one `gpt-5.4-mini` retry for technical/schema failure. Do not retry ambiguous content into a guess: request human clarification. Optional `gpt-4o-mini-transcribe` produces editable text for the existing parser. Use strict structured output and deterministic schema/business checks. Astra development credits do not establish API access.

## Contract and invariants

- Menu: ID, version, currency SGD, branding, stable item IDs, names, integer priceCents; modifier groups with selection limits, stable option IDs and integer price deltas.
- Extraction draft: proposed menu and unresolved fields. Unknown price is null; merchant review resolves it before publishing.
- Intent: menu ID/version, item IDs, integer quantities and option IDs, plus unresolved/clarification issues; no authoritative totals.
- Cart: canonical names/options, line totals and total calculated server-side against the selected menu version.
- Ticket: order ID, immutable cart snapshot, timestamp, status received, paymentStatus unpaid.

API capabilities: extract photo; publish/read menu; parse order; quote; submit; read kitchen orders. Exact wire types, endpoint fixtures and shared client are Elsen's deliverables. Reference route names: POST /api/extract, POST /api/menus, GET /api/menus/:id, POST /api/parse-order, POST /api/quote, POST /api/orders, GET /api/orders?menuId=… .

Merchant approval establishes the published menu. Never invent available dishes/options or silently omit an unsupported instruction. Quote and submission validate IDs, quantities, conflicts, selection limits and version; submission recalculates in integer cents. Require explicit customer placement and idempotency. Acknowledge only after persistence. AI cannot persist tickets or confirm payment. Keep secrets server-side, cap uploads and inputs, rate-limit expensive endpoints and isolate demo workspaces. Merchant/kitchen capabilities must not leak into public QR URLs.

## Ownership and Git

New standalone repository: jiak-simi-business-hackathon. Elsen creates it. Separate clones; kim/ui and elsen/backend branches; Elsen merges small changes to main every 30 minutes. No application code in this handoff folder.

Kimberley is the sole frontend writer: UI under app/ excluding app/api/, components/, public/, theme implementation, product copy, video and submission. Elsen owns app/api/, server/, shared/, tests/, root files, dependencies, lockfiles, configuration, database, prompts, shared API client and deployment. Kimberley does not duplicate shared schemas or authoritative pricing code. Elsen scaffolds page placeholders if needed, then hands UI ownership over.

K2 pitch runs independently and does not edit application files. K3 QA prepares tests independently and reviews the deployed app; it does not fix or deploy. Root coordination records decisions. Contract changes are announced and recorded before either lane adopts them. Only the Site owner registers or deploys the Site.

## Brand

Source: https://www.figma.com/design/ItlJWuBatnVMXGkrIjocfw/Jiak-Simi-Beta?node-id=0-1 . Verified tokens are in design-tokens.json. League Spartan; cream #FBF2E6; card #FFFBF5; text #1E1E1E; coral #EF2626; teal #20564B; selected teal-light #A8E0D3; borders #EFE6D2. Use 18px cards, 10px inputs and 20px primary-button radius with restrained warm shadows.

Business adaptation: 26px page headings, 20px section headings, 16px body/inputs, 14px labels, 44px minimum targets, 20px mobile gutters. Text lockup “Jiak Simi / for Business.” No custom illustration assets. Kitchen emphasizes quantity, dish and explicit modifier text. See docs/ui-spec.md.

## Schedule and gates

Assumed kickoff: 10:30am Singapore time. Confirm event date/start time rather than treating this as a running timer. If starting later, cut features and preserve recording/submission buffers.

| Time | Outcome |
|---|---|
| 10:30–10:50 | Select photo, check credentials, establish repository and freeze contract |
| 10:50–11:30 | Kimberley: fixture-driven UI. Elsen: deployed API/database/model path; Sites gate at 11:15, switch to Vercel if blocked |
| 11:30–12:30 | Integrate real photo → review/publish → customer order → persisted kitchen ticket |
| 12:30–1:15 | Two-device and failure tests; optional voice only after core passes |
| 1:15–1:45 | Feature freeze, final public deployment and repository/README |
| 1:45–2:30 | Record, edit, export exactly 90 seconds; only blocker fixes |
| 2:30–3:00 | Public upload, verify three links without login, submit |
| 3:00–3:30 | Recovery buffer and submission receipt verification |

## Acceptance, fallbacks and cuts

Tests: real photo/source accuracy, missing price, unknown dish, unsupported/conflicting modifier, invalid quantity, forged client price, stale menu, prompt injection, duplicate/concurrent submit, model outage, network interruption, cross-session isolation, two-device kitchen display, public artifacts. See docs/qa-checklist.md. All tests are unrun until an app is available.

Model failure: clearly labelled merchant-reviewed saved menu and tap ordering; never present fixture extraction as live. Voice failure: type. Network failure: hotspot, retain draft and show Not sent; if submission result is unknown, retry/reconcile with the same key. Never claim no order exists when acknowledgement is merely lost. Sites failure: tested Vercel build, same database, regenerated QR. Preserve an earlier successful recording.

Cut order: illustrations already excluded → animation/extra styling → voice → extra photographs → kitchen status controls. Never cut merchant approval, real extraction, typed parsing, deterministic validation/totals, persistence, public access or submission buffers.

## Video

Exactly 90 seconds: 0–8 problem; 8–23 photo/extraction; 23–35 merchant approval/publish; 35–47 QR/menu; 47–63 order/cart; 63–75 kitchen ticket; 75–84 Astra/guardrails; 84–90 value/links. Export 2,700 frames at 30fps and verify 90.000 seconds including titles/cards and audio track duration. Script and recording checklist: docs/demo-video.md. Do not claim untested functionality or fabricate a live demo.

## Decision/change log

Initial implementation handoff: Sites first confirmed; existing Figma brand reused with larger operational controls; illustrations excluded; Elsen retains sole setup/integration/deployment ownership. Await one real menu/photo and Elsen's repository/base commit/shared contract. Any adjustment to endpoints, schema or hosting must be logged here by the owner before integration.
