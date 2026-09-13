# Kimberley UI integration handoff — 13 September 2026

Done/Next, explicit dine-in/takeaway and versioned opening hours are implemented backend contracts. The approved web migration `20260913053454_jiak_simi_web_ordering.sql` is applied to hackathon project `mikpepfrumtglwweolzq`. This document describes supported behavior; it does not claim Kimberley's frontend integration or a Git push is complete. Photo enhancement and existing-page import remain deferred.

## Ownership and integration

Kimberley owns onboarding/stall setup/OCR review, storefront/QR, customer cart and kitchen screens. Elsen owns API routes, server/shared contracts, auth wiring, dependencies, backend tests and database integration. A staff login and supervised `/voice-test` surface exist locally; the customer/onboarding/kitchen product screens remain Kimberley's integration work. Coordinate existing UI paths instead of creating duplicate pages. Read the installed Next.js guides required by AGENTS.md before coding. The narrow public storefront route exception is handled by the Auth proxy; API guest authorization remains separate.

Use `createApiClient` from `src/shared/api-client.ts`. Staff arguments are signed-in Supabase user access tokens, verified with active restaurant membership. Guest ordering uses same-origin HttpOnly cookie sessions. Never use a publishable key or service credential as a staff token.

| Operation | Client method | Response / requirement |
| --- | --- | --- |
| Extract photo | `extract(photo, restaurantId, staffAccessToken)` | Reviewed-owner/editor authorization and durable OCR budget; uncertain draft, never publication. |
| Review OCR | `buildReviewedMenu(draft, review)` | Local explicit item/source/issue resolution; see [OCR integration](OCR-FRONTEND-INTEGRATION.md). |
| Read stall setup | `readStallDetails(restaurantId, staffAccessToken)` | `{details:null|snapshot}`. |
| Save stall setup | `saveStallDetails(restaurantId, input, staffAccessToken)` | `{details:snapshot}` with new version; owner/editor only. |
| Publish | `publishMenu(menu, staffAccessToken, stallDetailsVersion)` | Sends `{menu,stallDetailsVersion}`; returns Menu; explicit reviewed publication. |
| Read public storefront | `readPublishedStall(restaurantId)` | `{menu,details:null|snapshot}` pinned to that publication. `readMenu` remains available. |
| Start customer session | `startGuest(restaurantId)` | Restaurant-bound guest cookie; does not order. |
| Interpret and price | `parseOrder(...)`, `quote(cart)` | Model proposes; server calculates integer SGD cents. Resolve all blocking issues. |
| Place order | `submit({cart,reviewedTotalCents,confirmed:true}, idempotencyKey)` | Atomic unpaid Ticket; keep key when acknowledgement is uncertain. |
| Kitchen queue | `kitchen(restaurantId, staffAccessToken)` | `{orders,counts:{received,done,total}}`. |
| Complete ticket | `completeKitchenOrder({restaurantId,orderId,expectedStatusVersion}, idempotencyKey, staffAccessToken)` | Updated Ticket; POST `/api/v1/kitchen/orders/complete`. |

## Stall-name section: required seven-day opening hours

Place hours alongside the stall-name controls. Read details first; `details:null` means no reviewed details exist. The demo now has reviewed details version 1 (09:00–18:00 all seven days) published with menu version 2. For other stalls with unknown details, show incomplete setup rather than preselecting an approved schedule. Draft controls may remain incomplete while editing; publication requires an explicit decision for all seven days.

Save input is `{expectedVersion,name,timezone:"Asia/Singapore",weeklyHours}`. Use expectedVersion 0 initially and the saved snapshot's version thereafter. A snapshot also includes `restaurantId` and positive `version`. `weeklyHours` must contain exactly one entry per ISO weekday 1–7 (Monday–Sunday):

```ts
{ weekday: 1, closed: false,
  intervals: [{ opens: "09:00", closes: "18:00", closesNextDay: false }] }
{ weekday: 7, closed: true, intervals: [] }
```

These are shape examples, not approved demo hours. Closed days have zero intervals; open days have 1–4. Times are 24-hour `HH:mm`. Explicit overnight closing must produce a positive duration of at most 24 hours. Overlaps across midnight and Sunday/Monday are rejected; touching boundaries are allowed.

`STALE_STALL_DETAILS` (409) means refresh/reconcile another staff edit. `INVALID_STALL_DETAILS` (400) requires corrections; `STALL_DETAILS_REQUIRED` (409) requires saved reviewed details. Preview the exact saved version with the menu and pass it to `publishMenu`. A later details save does not change the existing publication; explicitly publish a fresh menu version to update storefront hours. Hours are display/setup data, not an automatic accepting-orders gate. Special-date overrides remain deferred.

## Explicit dine-in / takeaway

Every new cart requires `fulfillmentType:'dine_in'|'takeaway'`, alongside restaurant/menu identity/version and lines. Quote echoes it and Ticket.cart snapshots it. Do not default a real order, infer the choice from OCR, encode it in channel/source, or add an unapproved surcharge. Both modes use the same prices.

Changing mode requires a fresh quote/review and key for newly reviewed content. Retrying an uncertain placement retains its original content and key. Voice and messaging must obtain explicit mode; unresolved model intent may contain null but cannot become a valid cart. Historical Ticket.cart may contain `fulfillmentType:null`; display “Not specified”, preserving the historical record.

## Persisted kitchen Done and local Next

Tickets have `status:'received'|'done'`, positive `statusVersion` and nullable `completedAt`. New submissions start received/version 1 with null completion time. Done transitions to version 2, records completion time and remains unpaid. Financial snapshots and the original submission receipt remain immutable; kitchen reads overlay current operational status.

Call `completeKitchenOrder` with the displayed version and a UUID idempotency key. Active owner/editor/kitchen staff may complete. A matching retry returns the recorded success before stale-version checks. Changed content under the same key yields `IDEMPOTENCY_CONFLICT`; a different key with an old version yields `STALE_STATUS` (409). On uncertain acknowledgement, retain the key, reconcile/refetch and do not assume failure or advance the selection.

After acknowledged Done, refetch queue/counts and select the oldest remaining received ticket by `(createdAt,id)`. Next alone changes local selection. Show an empty state when none remain. Do not introduce paid/preparing/ready states. Onboarding Next remains ordinary validated navigation; completing OCR review never replaces explicit Publish.

## Verification and frontend acceptance

The applied web migration passed 16 hosted assertions with uniquely scoped rollback fixtures and 8 local database scenarios. The existing demo was preserved. A real authenticated HTTP test then placed **two Char Siew Rice plus one Braised Pork Knuckle Rice for 1400 cents**, dine-in and unpaid: ticket `0c124fc9-9220-4592-82f3-df0cf6077e25`. Submission replay created no duplicate; completion replay returned the same acknowledgement. The observed queue after completion was `{received:1,done:1,total:2}`; these counts are a test observation, not permanent UI fixtures.

Kimberley's remaining work is to wire these contracts into the product screens, including incomplete hours, explicit fulfillment, publication preview, unknown acknowledgements, stale versions and Done/count refresh. The user reviewed and published the dummy stall hours; legacy publications may still have unknown hours. Backend test results do not establish frontend acceptance or verified live microphone/Telegram delivery. See [database proposal/evidence](WEB-ORDERING-DATABASE-PROPOSAL.md) and [first backend sync](FIRST-BACKEND-SYNC.md) for deployment context.
