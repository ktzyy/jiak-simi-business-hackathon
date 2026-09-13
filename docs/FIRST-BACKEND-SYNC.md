# Backend sync for Kimberley — 13 September 2026

Use branch **`elsen/backend`** in `ktzyy/jiak-simi-business-hackathon`. Elsen will send the exact pushed commit ID separately; this file travels with that commit. No UI branch has been merged and no application has been deployed.

Kimberley owns the onboarding/review, storefront/QR, customer cart and kitchen UI. Elsen retains OCR, Telegram, voice, API/server, shared contracts, Supabase and integration. [Assigned UI files and requested contracts](KIMBERLEY-UI-CONTRACTS.md) are listed separately. Photo enhancement and page import are deferred.

## Database and demo readiness

Target: **`mikpepfrumtglwweolzq`**, the Singapore hackathon project. Browser configuration contains only its URL and publishable key. All privileged credentials remain server-side and are excluded from Git.

- Core migration **`20260913042355_jiak_simi_202609130001_core_ordering.sql`** was applied and verified with 53 hosted pgTAP assertions and fixture rollback.
- Channel migration **`20260913050159_jiak_simi_channel_ordering.sql`** is applied. Six additional private RLS tables and twelve service-only RPCs passed permissions checks. **18 hosted channel assertions and all 53 core pgTAP assertions passed after application**, with rollback verified. No browser grants were added. Security advisors reported no errors; intentional private-table policy notices and the existing leaked-password-protection warning remain.
- The synthetic demo is seeded: **Jiak Simi Roast Meat Demo**, restaurant **`ba2ad996-da84-4653-89a9-c028d77c050d`**; staff **`hawker-demo@jiak-simi.example`**, user ID `b123ff27-d269-4b0f-97f6-78a3e97170a3`, owner membership. Password is available only in Elsen’s ignored `.env.local` as `DEMO_STAFF_PASSWORD`; it is not in Git or this document.
- Published menu **`0b151d11-36e0-4089-90e0-8265f7b77322`**, version **1**: Char Siew Rice S$4.50, Braised Pork Knuckle Rice S$5.00, Braised Pork Knuckle Noodles S$5.00. These are deliberately selected synthetic demo entries based on the mockup, not a complete approved merchant extraction.

**Live verification passed:** demo email/password login, published menu equality, authenticated kitchen access and `consume_staff_ai_budget` succeeded against the hosted project. This used no paid AI call.

Do not reapply a migration already recorded on the remote. The original core verification runner requires empty application tables; **do not run it after the demo seed**. Consult deployment scripts and their guards before running any mutation.

## OCR: integration entry point

Read **[OCR-FRONTEND-INTEGRATION.md](OCR-FRONTEND-INTEGRATION.md)** for exact payloads, review decisions and error handling. Use:

```ts
const api = createApiClient();
const draft = await api.extract(photoFile, restaurantId, staffAccessToken);
// Merchant resolves uncertain items, prices, sources and blocking issues.
const menu = buildReviewedMenu(draft, explicitReview);
// Only after the merchant presses Publish:
await api.publishMenu(menu, staffAccessToken);
```

Imports: `src/shared/api-client.ts`, `src/shared/menu-review.ts`; schemas: `src/shared/extraction.ts`, `src/shared/contracts.ts`. `src/shared/ocr-fixtures.ts` contains a sanitized real extraction for UI development, not a published menu.

`extract` sends raw JPEG/PNG/WebP bytes up to 5 MiB, **not FormData**. It uses the signed-in staff JWT and `X-Restaurant-Id`. Server identity verification and the SQL owner/editor quota run before paid extraction. Drafts always need review; null prices cannot become zero. No extraction auto-publishes, stores source images or enhances food photos. Uploads are synchronous and may require up to 150 seconds; verify hosting request limits. Unknown upload outcomes must not be automatically retried.

The original live OCR service was tested against the hawker photos. The orange-board sample matched all 18 visible price occurrences; tray-menu uncertainty remains. New staff-authenticated handler tests use mocks; the live demo readiness check separately verifies real Auth, published-menu access, kitchen membership and the OCR budget RPC without a paid OCR request. No browser upload-to-publication acceptance run is claimed.

## Ordering and kitchen API

| Action | Shared client method | Behavior |
| --- | --- | --- |
| Published menu | `readMenu(restaurantId)` | Immutable reviewed version |
| Guest capability | `startGuest(restaurantId)` | Same-origin restaurant-bound HttpOnly cookie |
| Interpret text | `parseOrder(restaurantId, menuId, menuVersion, text)` | Proposed IDs/options and clarifications; no order placement |
| Price review | `quote(cart)` | Server-calculated SGD integer cents |
| Place web order | `submit({cart,reviewedTotalCents,confirmed:true}, idempotencyKey)` | Atomic received/unpaid ticket; retain key after uncertain response |
| Kitchen queue | `kitchen(restaurantId, staffAccessToken)` | Member-authorized read; no status mutation |

Use the existing same-origin HTTP client. Never expose the Supabase secret key or call privileged RPCs from browser code. A signup alone grants no restaurant access. Display success only from the persisted Ticket; model speech and local fixtures are not receipts.

## Channel status

- **Telegram:** adapter, private-chat allowlist, durable review/confirmation, duplicate handling and laptop polling runner are implemented. Bot `@blackcharsiewbot` was verified, and the user's `/start` was matched to one private chat. Credentials and recipient binding are local only. The local polling runner is active, and the database confirms **one sent welcome reply with zero unconfirmed replies**. No complete Telegram customer order has been verified yet. The laptop process must remain running for this local demo; it is not a hosted deployment. See [MESSAGING-INTEGRATION.md](MESSAGING-INTEGRATION.md).
- **Voice:** GPT-Live laptop transport, transcript handling, Prepare review, explicit Confirm, microphone pause and End cleanup are implemented. Audio itself has `orderingEnabled:false`; placement uses the separate staff review/order APIs. Pause the microphone during review; Confirm before End because End invalidates the pending review. Real audio remains untested and production creation is disabled pending server-enforced audio lifetime. See [butler-channels.md](butler-channels.md).
- **WhatsApp:** deferred in favor of Telegram; personal WhatsApp is not connected to a business API.

## Requested UI additions

The current strict API **does not persist Done/Next, dine-in/takeaway or opening hours**. [KIMBERLEY-UI-CONTRACTS.md](KIMBERLEY-UI-CONTRACTS.md) supplies concrete proposed semantics and missing backend work:

- Onboarding Next advances after validation; review Done does not publish. For kitchen, proposed Done completes preparation and Next selects the oldest remaining ticket. Payment remains unpaid.
- Proposed `fulfillmentType: 'dine_in' | 'takeaway'` is an explicit cart choice, echoed in quote/ticket and included in idempotency. Current schemas reject it.
- Required opening hours need all seven Singapore weekdays explicitly open/closed, valid intervals and publication versioning. Current menu publication has no hours field.

These are reviewable next contracts, not active endpoints. Kimberley can integrate supported OCR/review/publish/menu/cart/kitchen reads now and keep the new controls clearly in review until Elsen lands their complete backend support.

## Validation and first joint run

94 local tests pass, including eight isolated database scenarios that rerun all 53 core assertions after the extension. TypeScript, ESLint and the webpack production build pass. PGlite is pinned as a dev dependency so `npm ci && npm test` works without a machine-specific module path. Hosted results are recorded above; local tests do not prove real provider delivery or concurrent multi-connection behavior.

First joint run: sign into the demo staff account; load its published menu; upload/review a supported photo; publish only after merchant approval; open customer ordering; quote and explicitly submit; confirm the persisted unpaid ticket in kitchen; replay the same key and verify only one ticket. Keep demo credentials out of chat and source control.
