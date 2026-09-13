# Backend sync for Kimberley — 13 September 2026

Use branch **`elsen/backend`** in `ktzyy/jiak-simi-business-hackathon`. Elsen will supply the exact final pushed commit separately. The public-order-page Auth proxy fix is already pushed in `d632190`; subsequent source changes are still being assembled. Kimberley's onboarding, storefront/cart and kitchen UI is not present in this checkout, and no UI branch has been merged.

Kimberley owns those four product surfaces. Elsen owns OCR, Telegram, GPT-Live voice/testing, server/API, shared contracts and database integration. Photo enhancement and existing-page imports are deferred. The explicitly approved demo modifier additions are published in menu version 2. See [KIMBERLEY-UI-CONTRACTS.md](KIMBERLEY-UI-CONTRACTS.md).

## Applied database and verified demo

The only target is Singapore hackathon project **`mikpepfrumtglwweolzq`**. Browser code receives its URL and publishable key; privileged credentials remain server-side and Git-ignored.

| Applied migration | Verification |
| --- | --- |
| `20260913042355` core ordering | 53 hosted rollback assertions passed |
| `20260913050159` channel ordering | 18 hosted channel assertions passed; the 53 core assertions also passed at that stage |
| `20260913053454` web ordering extension | 16 hosted assertions passed for fulfillment, kitchen completion and versioned stall details/publication |

These migrations are already recorded remotely; do not reapply them. The old empty-database core test runner must not be run against the seeded project. Local/hosted regression assertions do not establish every concurrency or provider scenario.

Demo restaurant: **`ba2ad996-da84-4653-89a9-c028d77c050d`**, Jiak Simi Roast Meat Demo. Staff login: **`hawker-demo@jiak-simi.example`**, with active owner membership. The password is in Elsen's ignored `.env.local` as `DEMO_STAFF_PASSWORD`; never copy it into a shared handoff.

The synthetic published menu contains Char Siew Rice S$4.50, Braised Pork Knuckle Rice S$5.00 and Braised Pork Knuckle Noodles S$5.00. The current published menu is **version 2**, paired with **stall details version 1** and explicitly approved hours **09:00–18:00 every Monday–Sunday, Asia/Singapore**. Read the current pair with `readPublishedStall(restaurantId)`; `readMenu(restaurantId)` returns the menu alone. These are selected demo entries, not an exhaustive merchant-approved OCR menu. Real hosted login, published-menu access, staff kitchen access and staff AI-budget checks have passed.

Every dish now supports optional **Egg +S$1.00, Char Siew +S$2.00 and Shao Rou +S$2.00**, selecting zero to three distinct extras. A separate optional group allows **Chilli or No chilli**, both free and mutually exclusive. Hosted quote checks confirmed the original joint base remains S$14.00 and one Char Siew Rice with all three extras is S$9.50. The publication/quote verification created no order; evidence is `artifacts/demo-menu/version-2-verification.json`. `DEMO_MENU` remains the historical v1 fixture; `DEMO_MENU_WITH_EXTRAS` is the exact approved v2 fixture, with `DEMO_APPROVED_DETAILS` supplying the reviewed schedule.

**A real HTTP backend joint test passed on v1:** two Char Siew Rice plus one Braised Pork Knuckle Rice, **dine-in, S$14.00**, produced unpaid ticket **`0c124fc9-9220-4592-82f3-df0cf6077e25`**. Replaying the same submission key returned that ticket. Done completed it; repeating the same Done action returned the same acknowledgement. At verification, the queue contained **1 received + 1 done = 2 tickets**. This is backend HTTP acceptance, not an implemented Kimberley UI walkthrough or a voice/audio acceptance claim.

## Stall setup and publication

Opening hours belong beside the **stall name** in Kimberley's stall-details step. `readStallDetails(restaurantId, staffAccessToken)` returns `{details:null|snapshot}`. Save with:

```ts
await api.saveStallDetails(restaurantId, {
  expectedVersion: currentDetails?.version ?? 0,
  name: stallName,
  timezone: "Asia/Singapore",
  weeklyHours: sevenExplicitDays,
}, staffAccessToken);
```

Each ISO weekday 1–7 must appear once, explicitly open or closed. A closed day has no intervals; an open day has 1–4. Intervals use `{opens:"09:00",closes:"18:00",closesNextDay:false}`. Invalid times, zero/overlong durations, and overlaps across midnight or the Sunday/Monday boundary are rejected. No schedule is silently defaulted. The current demo’s seven-day schedule was explicitly approved and saved as details version 1; future edits start from that returned version. Use validation from `src/shared/stall-details.ts`.

Publication is now explicit and version-bound:

```ts
const draft = await api.extract(photoFile, restaurantId, staffAccessToken);
const menu = buildReviewedMenu(draft, explicitReview);
await api.publishMenu(menu, staffAccessToken, savedDetails.version);
```

`publishMenu` sends `{menu,stallDetailsVersion}`. Required current stall details are validated and their immutable version is associated with this publication. Editing stall name/hours later does not change a published snapshot; explicitly publish a new menu version. `readPublishedStall(restaurantId)` returns `{menu,details}`; legacy publications may return `details:null`. `readMenu` remains available for the existing menu-only contract.

OCR accepts raw JPEG/PNG/WebP bytes up to 5 MiB, not FormData. Staff JWT and restaurant header are checked before the paid extraction quota is consumed. Resolve all blocking source/item/price issues before publication; null prices cannot become zero. No automatic image storage, enhancement or publication is introduced. See [OCR-FRONTEND-INTEGRATION.md](OCR-FRONTEND-INTEGRATION.md) for extraction/review detail; use the new three-argument publication method above if older examples omit the details version.

## Ordering and kitchen contracts now supported

| Operation | Current contract |
| --- | --- |
| Customer capability | `startGuest(restaurantId)` establishes a same-origin HttpOnly guest cookie |
| Cart / quote | Required `fulfillmentType:'dine_in'|'takeaway'` on the complete cart; no default or surcharge |
| Interpretation | `parseOrder(...)` proposes IDs/options and a nullable explicit mode; unresolved issues require clarification |
| Placement | `submit({cart,reviewedTotalCents,confirmed:true}, idempotencyKey)` persists an unpaid ticket; mode participates in validation/idempotency |
| Kitchen queue | `kitchen(restaurantId,staffAccessToken)` returns current persisted ticket status |
| Kitchen Done | `completeKitchenOrder({restaurantId,orderId,expectedStatusVersion},idempotencyKey,staffAccessToken)` persists `done` with optimistic concurrency |
| Kitchen Next | Select the oldest remaining received ticket locally after an acknowledged Done/refetch; Next alone does not mutate data |

Ticket status is `received|done`, with `statusVersion` and nullable `completedAt`. Done means kitchen preparation completed, never paid or collected. Historical orders may have a null fulfillment mode; display “Not specified,” never invent a choice. Retain the original key on unknown placement/Done outcomes; a changed review needs a new explicit action. Display success only from the persisted receipt.

The pushed proxy change permits the narrow public `/order/:restaurantId` surface without exposing other staff pages. APIs continue enforcing their own guest/staff authorization. Kimberley's public order UI still needs to be built/integrated.

## Channels and test surfaces

- **Telegram:** `@blackcharsiewbot` is configured for the explicitly allowlisted private demo account. The laptop polling runner is required; this is not hosted. A welcome reply was confirmed sent. Text and provisional audio-derived orders use explicit dine-in/takeaway and a separate Place order button. Audio uses exact **`gpt-live-1`**, locally on the Mac, at most **5 MB (5,000,000 bytes) / 20 seconds**; input transcript fragments are provisional and require careful review. No fully verified audio-order round trip is claimed. `/paydemo` is a clearly fake two-second payment presentation; it moves no money and the database ticket remains **unpaid**. See [MESSAGING-INTEGRATION.md](MESSAGING-INTEGRATION.md).
- **Laptop GPT-Live:** staff-protected `/voice-test` supplies Start, microphone pause/resume, transcript, required dining-mode selection, Prepare review, explicit unpaid confirmation and End. The server owns prices and receipts; the Live model cannot place orders. Model access was checked, but actual microphone/provider audio remains a hands-on test. Creation remains local/development-only pending server-enforced audio lifetime.
- **WhatsApp:** deferred; the personal account is not connected to a business API.

## Hosting is registered, not deployed

Sites project **`appgprj_6aa6330ed72c819186a4fff3288b4caf`** is registered privately in `.openai/hosting.json` and is **UNPUBLISHED**. The reserved expected address is [jiak-simi-business-demo.zesty-crown-3337.chatgpt.site](https://jiak-simi-business-demo.zesty-crown-3337.chatgpt.site), with intended Auth callback `/auth/confirm`. The address is not a verified live application. Supabase Auth staging Site URL/redirect settings have **not** yet been changed. Do not use the reserved URL as evidence that login, OCR request duration or voice hosting works.

Follow [DEMO-ORDERING-TEST.md](DEMO-ORDERING-TEST.md) for deliberate channel tests. Final source commit/build results will accompany the next push; the verified HTTP and migration facts above are separate from future UI and deployment acceptance.
