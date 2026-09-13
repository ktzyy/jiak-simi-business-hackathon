# Product contract — implemented backend, frontend integration pending

Status: backend contracts below are implemented; Kimberley’s product UI integration/acceptance is pending. PR #1 was reviewed; it has not been approved or merged by this work. This revision reconciles its original payment/source assumptions with the approved unpaid-order handoff and the current [typed contracts](../src/shared/contracts.ts). Types and fixtures describe intended behavior; they do not prove that HTTP endpoints or persistence exist. See [engineering handoff](engineering-handoff.md) for actual delivery status.

## Shared rules

- IDs are UUID strings; API dates are ISO 8601 timestamps with explicit timezone offsets.
- Currency is SGD; money is integer cents. Only server code calculates authoritative prices.
- Models propose menu data and order intent. Merchant review precedes publication; customer review and explicit placement precede persistence.
- Restaurant membership determines staff authorization, never user-editable profile metadata.
- Use the separate hackathon Supabase project `mikpepfrumtglwweolzq`, never production. The user separately approved core schema creation/application to this project; the contract itself does not authorize production changes.
- Browser code receives only the project URL and publishable key. Guest orders require validated server endpoints; no anonymous table writes.

## Executable object shapes

The executable field definitions and limits live in [contracts.ts](../src/shared/contracts.ts); representative synthetic data is in [fixtures.ts](../src/shared/fixtures.ts).

| Object | Shape and meaning |
| --- | --- |
| Menu | Stable UUID `id`, `restaurantId`, positive integer `version`, `currency`, `name`, `dishes`. Published versions are immutable. Database version-row UUIDs are internal and must not replace API numeric versions. |
| Dish | Stable `id`, `name`, `priceCents`, `available`, `modifierGroups`. Each group contains stable IDs, selection limits and saved options with integer price deltas. |
| Cart request | `restaurantId`, `menuId`, `menuVersion`, required `fulfillmentType: dine_in | takeaway`, `lines`; each line has `dishId`, quantity 1–20 and saved `optionIds`. At most 50 lines. Extra fields, including client prices and free-text modifiers, are rejected. |
| Intent | Menu identity/version, proposed lines, nullable unresolved `fulfillmentType` and clarification `issues`; no authoritative prices. Unsupported instructions remain unresolved and cannot become saved options automatically. |
| Quote | Menu identity/version, required explicit `fulfillmentType`, currency, canonical lines with names/options, unit prices, line totals and `totalCents`. Candidate v1 is a pure quote, with no persisted cart/quote ID or expiry field. |
| Submission | `cart`, `reviewedTotalCents`, `confirmed: true`; request header `Idempotency-Key` is a UUID retained across retries. The trusted adapter establishes channel/session, not model output. |
| Ticket | `id`, `createdAt`, `source: web | whatsapp | telegram | voice`, `status: received | done`, positive `statusVersion`, nullable `completedAt`, `paymentStatus: unpaid`, and immutable quoted `cart` snapshot. Historical cart fulfillment may be null; new receipts require explicit mode. |
| Error | `{ error: { code, message, retryable } }`; failure to receive an acknowledgement does not establish whether placement committed. |

The candidate menu projection does not yet include restaurant branding, categories, image URLs or display numbers from PR #1's broader shape. Those remain frontend/database integration requirements; coordinate an explicit extension before a UI depends on them. Guest/channel sessions are durable; there is no public durable cart/quote ID in this API.

## Validation, publication and placement

Extraction returns a draft with `status: needs_review`, nullable unknown fields and blocking issues. Its separate [extraction schema](../src/shared/extraction.ts) deliberately accepts more uncertain information than the sellable menu schema. Publication must map reviewed rows to stable identities and validate all v1 limits, prices and modifier cardinality. Extraction neither saves nor publishes a menu. Null prices must never become zero automatically.

Quote and submit must reject unknown/unavailable dishes, unknown/duplicate options, invalid selection counts or quantities, negative resulting prices and stale versions. A stale version returns `STALE_MENU`; the customer reviews a new quote. Free-text modifier submission is outside this initial contract, even if a prior draft permitted zero-price instructions.

Submission recalculates the cart against the current approved menu, checks the customer-reviewed total and requires explicit placement. The applied persistence transaction writes the unpaid ticket, immutable lines, scoped idempotency receipt and delivery event atomically. Acknowledgement comes only after commit. Same session/key and same request return the original ticket; changed contents conflict. The applied SQL transaction implements persistence and idempotency; the local fingerprint helper is used for deterministic validation tests. Without a durable cart ID, a new key is a distinct submission.

New submission receipts remain `received`/version 1/`unpaid`. The applied kitchen extension persists Done/version 2 and completion time separately from immutable financial snapshots; kitchen reads overlay this state and return `{orders,counts:{received,done,total}}`. `completeKitchenOrder({restaurantId,orderId,expectedStatusVersion}, idempotencyKey, staffAccessToken)` returns an updated Ticket. Matching retries recover the same acknowledgement before stale checks; another stale request gets `STALE_STATUS`. After acknowledged Done, refetch counts and select Next locally. Unknown acknowledgements retain the key and require reconciliation. There is no payment confirmation or settlement.

## Integration boundaries

Kimberley owns onboarding/review, storefront/QR, customer cart and kitchen screens. Elsen owns backend, AI, contracts, validation, integration and deployment. The kitchen must show only the signed-in member's restaurant tickets; public guest receipt access must be scoped to the submitting session. Private demo sessions must not expose each other's tickets.

Web, WhatsApp and live voice are intended adapters to the same validated order path. Source `web` includes QR entry. Live audio itself has `orderingEnabled: false`: transcript review and explicit placement use separate staff-authorized voice review/order endpoints. Voice remains a supervised demo pending real audio verification; its applied database routines enforce a ten-minute session lifetime. Personal WhatsApp is not yet connected to a business API. Actual API onboarding and receipt-identifier handling require review before integrating real messages. Store only the minimum restricted recipient data needed to reply, with expiry; never expose phone identifiers in kitchen/public responses or import production chats.

Changes to object names, meanings, status, limits or endpoint semantics require a reviewed contract update and matching fixtures before either surface relies on them. Backend implementation and test evidence do not by themselves establish Kimberley’s frontend acceptance.


## Applied UI contract extensions

Done/counts, required dine-in/takeaway and versioned opening hours are implemented in applied migration `20260913053454_jiak_simi_web_ordering.sql`; exact methods and frontend behavior are in [KIMBERLEY-UI-CONTRACTS.md](KIMBERLEY-UI-CONTRACTS.md). Photo enhancement and page import are deferred. See [FIRST-BACKEND-SYNC.md](FIRST-BACKEND-SYNC.md) for current migration/demo readiness.


Stall name and hours belong in one reviewed setup section. `saveStallDetails(restaurantId, {expectedVersion,name,timezone:"Asia/Singapore",weeklyHours}, staffAccessToken)` requires seven unique ISO weekdays, each explicitly closed with zero intervals or open with 1–4 valid intervals. Initial expectedVersion is 0; subsequent writes use the current version. Overlaps, including across Sunday/Monday, are rejected. `readStallDetails` returns `{details:null|snapshot}`; legacy publications can have unknown hours. The approved demo now has details version 1: 09:00–18:00 all seven days, published with menu version 2.

`publishMenu(menu, staffAccessToken, stallDetailsVersion)` sends `{menu,stallDetailsVersion}` and pins the reviewed current details snapshot to that immutable menu publication. `readPublishedStall(restaurantId)` returns `{menu,details:null|snapshot}`. Later setup edits do not silently change published hours; explicitly publish a fresh menu version. Hours do not automatically block ordering. OCR review notes remain local and are not persisted by publication.

New carts must explicitly choose dine-in/takeaway across web, voice and messaging. No default or surcharge is inferred. Mode participates in quote and idempotency; changing it requires new review. The authenticated HTTP joint test passed: two Char Siew Rice plus one Braised Pork Knuckle Rice, 1400 cents, dine-in, unpaid, ticket `0c124fc9-9220-4592-82f3-df0cf6077e25`; submission replay created no duplicate and completion replay returned the same acknowledgement. Observed queue counts were received 1, done 1, total 2. Kimberley owns the remaining product frontend wiring and acceptance.
