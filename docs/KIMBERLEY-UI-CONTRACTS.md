# Kimberley UI integration handoff — 13 September 2026

This document separates today's supported API from three requested contract additions. **Done/Next, dine-in/takeaway and required opening hours are review proposals below; none is currently a persisted API feature.** Do not send their fields to the current strict schemas yet. Photo enhancement and existing-page import are deferred. Elsen will provide the pushed `elsen/backend` commit separately; this document does not claim an unverified push, database application or membership.

## Assigned files

The local `elsen/backend` tree currently contains only these application UI files, verified with `rg --files`: `src/app/page.tsx`, `src/app/login/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, and `src/app/favicon.ico`. There is no local `src/components` directory and no implemented onboarding, storefront/cart or kitchen page yet. The existing root is an authenticated placeholder workspace. The fetched `kim/front-of-house` branch at `85f3ac38c83c72db343e0d33b84dc03142409fac` contains the same root/layout/styles/favicon UI paths and no onboarding/cart/kitchen implementation. It does not yet contain the new login page. This inventory was checked with `git ls-tree`; no UI branch was merged or overwritten.

Kimberley remains the sole writer for all four UI surfaces. Proposed new paths below establish a collision-free assignment if equivalent files do not already exist on her branch; preserve and report her existing paths instead of duplicating screens.

| Kimberley assignment | Proposed files, not yet present locally |
| --- | --- |
| Stall setup, OCR review and publish preview | `src/app/onboarding/page.tsx`, `src/components/onboarding/stall-details.tsx`, `src/components/onboarding/menu-review.tsx`, `src/components/onboarding/publish-preview.tsx` |
| Public storefront and customer cart | `src/app/order/[restaurantId]/page.tsx`, `src/components/ordering/customer-cart.tsx`, `src/components/ordering/order-review.tsx` |
| Restaurant storefront/QR management | `src/app/storefront/page.tsx`, `src/components/storefront/qr-panel.tsx` |
| Kitchen screen | `src/app/kitchen/page.tsx`, `src/components/kitchen/order-queue.tsx` |
| Branding and presentation | Existing `src/app/globals.css`, `src/app/layout.tsx`, UI portions of `src/app/page.tsx`, `src/app/login/page.tsx`, and approved `public/` assets |

Elsen owns `src/app/api/**`, `src/server/**`, `src/shared/**`, `src/lib/supabase/**`, `src/app/auth/**`, `src/proxy.ts`, dependencies/configuration, backend tests, database work and integration. Coordinate auth changes rather than replacing the existing login/server-action wiring. Portal pages are protected by default. Before wiring the proposed public `/order/[restaurantId]` page, coordinate a narrow public-route exception with Elsen in the Auth proxy; the current API already has its own guest authorization, but a new page is not automatically public. The UI must read the installed Next.js guides required by AGENTS.md before coding. No consumer/mobile app copy should enter this business repository.

## Supported integration today

Use `createApiClient` in `src/shared/api-client.ts`; do not build a second API client. Staff access tokens are the signed-in user's access token, verified server-side with restaurant membership. They are not the publishable key, a hard-coded user ID or a service credential. Guest orders use same-origin HttpOnly cookie sessions.

| UI operation | Current method / contract | Current implementation boundary |
| --- | --- | --- |
| Menu photo OCR | `extract(photo, restaurantId, staffAccessToken)` | Staff-authenticated `/menu-extractions`; returns uncertain draft, never publishes. Requires the OCR budget RPC to be applied remotely. |
| Review uncertain extraction | `buildReviewedMenu(draft, review)` from `src/shared/menu-review.ts` | Local pure gate; accounts for items, source associations, blocking issues and manual dishes. It does not persist a review or publication by itself. |
| Publish reviewed menu | `publishMenu(menu, staffAccessToken)` | Existing `MenuSchema` only: IDs/version/currency/name/dishes/modifier groups. Explicit authenticated publication; no hours or fulfillment fields accepted. |
| Customer menu/session | `readMenu(restaurantId)`, `startGuest(restaurantId)` | Published menu and restaurant-bound guest cookie. Guest-session creation does not place an order. |
| Order interpretation/review | `parseOrder(...)`, `quote(cart)` | Model proposes IDs/options; server calculates authoritative SGD cents. All blocking clarifications must be resolved. |
| Place order | `submit({cart, reviewedTotalCents, confirmed:true}, idempotencyKey)` | Explicit review and atomic unpaid ticket. Preserve key on uncertain acknowledgement; changed content requires new review. |
| Kitchen read | `kitchen(restaurantId, staffAccessToken)` | Read-only `{orders: Ticket[]}`. Current tickets have `status:'received'`, `paymentStatus:'unpaid'`; source includes web/WhatsApp/Telegram/voice. |
| Laptop voice surface | `startLive`, `prepareVoiceReview`, `confirmVoiceOrder`, `closeVoiceSession` | Dedicated voice-session/review APIs exist locally; their channel database extension and real audio/order verification are separate readiness checks. |

Do not use older handoff paragraphs that still show a local demo token for OCR or imply an implemented kitchen status mutation. Current executable types and routes take precedence over stale status prose. A local API implementation is not proof that its dependent remote SQL or demo membership is ready.

## Proposed Done / Next semantics

The labels alone are ambiguous: they could mean onboarding navigation or kitchen queue actions. These are separate UI behaviors. For onboarding, **Next** moves forward after the current step validates; **Done** on review does not publish. Step 3 retains an explicit **Publish menu** action using `publishMenu`. Navigation needs no kitchen mutation or new order status.

For the kitchen, the recommended minimal proposal is **Done marks this ticket completed for kitchen preparation**, then **Next selects the oldest remaining received ticket locally**. Done never means paid, refunded or collected. Next alone changes the selected ticket, not server state. Do not hide a ticket permanently using only local state while claiming it is completed across staff devices.

If accepted, extend kitchen ticket status to `received | done`, adding `statusVersion` (positive integer) and nullable `completedAt`. Price/line/source snapshots remain immutable; operational status is separately versioned. Proposed staff client method and route:

```ts
completeKitchenOrder(
  restaurantId,
  orderId,
  { expectedStatusVersion: 1, action: "complete" },
  idempotencyKey,
  staffAccessToken,
)
// POST /api/v1/kitchen/:restaurantId/orders/:orderId/actions
// -> { order: TicketWithStatus }
```

Require server-verified membership, same-origin staff mutation, per-order optimistic concurrency and a scoped idempotency key. A retry returns the same completed result; mismatched version yields `STALE_ORDER` with a refresh path. Mark done only after acknowledgement; unknown results retain the key and refresh/recover before another mutation. On success, refetch the queue and select the oldest received ticket using `(createdAt,id)` ordering; show an empty state when none remains. Do not add paid/preparing/ready states by inference.

**Missing backend:** shared status schemas/fixtures, status-action client/route, authorized atomic transition RPC, persistence/concurrency tests, and reviewed migration approval/application. Until then, kitchen can read/refresh/select tickets but cannot offer a working persisted Done button.

## Proposed dine-in / takeaway contract

Use `fulfillmentType: 'dine_in' | 'takeaway'` as an explicit customer choice for the entire cart. Do not overload channel/source, free-text notes or an invented modifier. Do not silently default a real order or infer the mode from OCR. No takeaway surcharge, table number or pickup-time semantics are introduced by this choice.

Proposed field propagation:

```ts
// Required in the next CartRequest version:
{ restaurantId, menuId, menuVersion, fulfillmentType: "takeaway", lines }
// Quote echoes fulfillmentType; Ticket.cart snapshots the reviewed value.
```

Server validation, quote fingerprint and submission idempotency comparison must include fulfillment type. Changing it invalidates the current review and requires a fresh quote/key for newly reviewed content. A retry of the same uncertain placement keeps its original mode and key. Voice and Telegram must ask when it is absent; neither may place an order with a guessed mode. For a transitional rollout, legacy historical tickets display “Not specified”; do not fabricate dine-in/takeaway for them.

**Missing backend:** strict cart/intent/quote/ticket schemas and fixtures, core SQL quote/submit/fingerprint validation, channel pending-state validation and prompts, reviewed migration and compatibility strategy. Current `CartRequestSchema` rejects this extra field, so UI must not send it yet. Recommended integration order: land the complete cross-channel change before making mode selection part of the live demo's placement flow.

## Proposed required opening-hours contract

Required means the merchant must explicitly set every weekday as **open** or **closed** before completing stall setup/publication; it does not mean every day must be open. No default schedule and no “unknown” at publication. Draft controls may be incomplete while editing. Proposed stall-details payload:

```ts
{
  restaurantId,
  expectedVersion: 1,
  timezone: "Asia/Singapore",
  weeklyHours: [
    { weekday: 1, closed: false,
      intervals: [{ opens: "09:00", closes: "18:00", closesNextDay: false }] },
    // Exactly one entry per ISO weekday 1–7 (Monday–Sunday).
    { weekday: 7, closed: true, intervals: [] }
  ]
}
```

The snippet abbreviates days 2–6; a real payload requires all seven. Closed days have no intervals. Open days have 1–4 valid intervals. Times use 24-hour `HH:mm`, with explicit next-day closing for overnight service; zero-duration intervals are invalid. Validate overlaps across midnight and consecutive weekdays, not just within each day's array. Split hours are allowed. Special-date overrides and multiple time zones can remain deferred for this demo.

Proposed methods: `saveStallDetails(payload, staffAccessToken)` and `readStallDetails(restaurantId, staffAccessToken)` on `PUT/GET /api/v1/restaurants/:restaurantId/details`, returning `{version,restaurantId,timezone,weeklyHours}`. Draft profile writes require restaurant membership and optimistic version checks. Publication must reference the reviewed `stallDetailsVersion` and snapshot the hours displayed to customers; a subsequent draft edit must not silently change a published preview. Exact publication-envelope extension needs joint review because today's `publishMenu(menu, token)` accepts only a menu object.

Opening hours are display/setup data in this proposal. They do not automatically block ordering or guarantee the stall is accepting orders now. Availability continues to use the approved menu; an operational open/closed gate would be an additional explicit decision.

**Missing backend:** restaurant-profile persistence/read/write route, required-hours schema/fixtures, overlap checks, publication snapshot/version link, reviewed migration approval/application and API tests. `src/shared/ui-additions.ts` has an older optional-hours review proposal; it is not the active contract and must not be treated as satisfying this new requirement.

## Verified remote readiness and remaining acceptance

The integrator has now applied channel migration `20260913050159`, passed 18 hosted channel assertions plus all 53 core assertions, and verified demo staff login, owner kitchen access, published menu version 1 and the OCR budget RPC. See [FIRST-BACKEND-SYNC.md](FIRST-BACKEND-SYNC.md) for the exact IDs. The following evidence requirements remain useful for integration acceptance:

- OCR budget migration: exact applied version/name plus successful `consume_staff_ai_budget` verification. A SQL draft or local passing test is not remote application.
- Demo membership: confirmed demo restaurant `ba2ad996-da84-4653-89a9-c028d77c050d`, active staff membership, successful authenticated kitchen/menu access, and actual published demo menu version. Do not print passwords or tokens.
- Channel extension: applied voice/Telegram routines and one real authorized end-to-end order if claiming those channels live.
- Git handoff: pushed `elsen/backend` commit SHA, review link if created, and any conflicting UI paths from Kimberley's branch.

These readiness facts belong in the final integrator handoff after verification; this contract proposal deliberately does not invent them. Recommended next review is to agree the three proposed semantics together, then let Elsen implement and verify the complete backend extensions while Kimberley integrates already supported OCR/review/publish/guest-order/kitchen-read behavior.
