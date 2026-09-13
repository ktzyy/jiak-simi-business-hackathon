# Product contract — candidate v1

Status: candidate for Kimberley's review, not jointly frozen. PR #1 was reviewed; it has not been approved or merged by this work. This revision reconciles its original payment/source assumptions with the approved unpaid-order handoff and the current [typed contracts](../src/shared/contracts.ts). Types and fixtures describe intended behavior; they do not prove that HTTP endpoints or persistence exist. See [engineering handoff](engineering-handoff.md) for actual delivery status.

## Shared rules

- IDs are UUID strings; API dates are UTC ISO 8601 timestamps.
- Currency is SGD; money is integer cents. Only server code calculates authoritative prices.
- Models propose menu data and order intent. Merchant review precedes publication; customer review and explicit placement precede persistence.
- Restaurant membership determines staff authorization, never user-editable profile metadata.
- Use the separate hackathon Supabase project `mikpepfrumtglwweolzq`, never production. The user separately approved core schema creation/application to this project; the contract itself does not authorize production changes.
- Browser code receives only the project URL and publishable key. Guest orders require validated server endpoints; no anonymous table writes.

## Candidate object shapes

The executable field definitions and limits live in [contracts.ts](../src/shared/contracts.ts); representative synthetic data is in [fixtures.ts](../src/shared/fixtures.ts).

| Object | Shape and meaning |
| --- | --- |
| Menu | Stable UUID `id`, `restaurantId`, positive integer `version`, `currency`, `name`, `dishes`. Published versions are immutable. Database version-row UUIDs are internal and must not replace API numeric versions. |
| Dish | Stable `id`, `name`, `priceCents`, `available`, `modifierGroups`. Each group contains stable IDs, selection limits and saved options with integer price deltas. |
| Cart request | `restaurantId`, `menuId`, `menuVersion`, `lines`; each line has `dishId`, quantity 1–20 and saved `optionIds`. At most 50 lines. Extra fields, including client prices and free-text modifiers, are rejected. |
| Intent | Menu identity/version, proposed lines and clarification `issues`; no authoritative prices. Unsupported instructions remain unresolved and cannot become saved options automatically. |
| Quote | Menu identity/version, currency, canonical lines with names/options, unit prices, line totals and `totalCents`. Candidate v1 is a pure quote, with no persisted cart/quote ID or expiry field. |
| Submission | `cart`, `reviewedTotalCents`, `confirmed: true`; request header `Idempotency-Key` is a UUID retained across retries. The trusted adapter establishes channel/session, not model output. |
| Ticket | `id`, `createdAt`, `source: web | whatsapp | telegram | voice`, `status: received`, `paymentStatus: unpaid`, and immutable quoted `cart` snapshot. |
| Error | `{ error: { code, message, retryable } }`; failure to receive an acknowledgement does not establish whether placement committed. |

The candidate menu projection does not yet include restaurant branding, categories, image URLs or display numbers from PR #1's broader shape. Those remain frontend/database integration requirements; coordinate an explicit extension before a UI depends on them. The persistence design additionally proposes durable carts, quotes and sessions; those fields are not silently part of v1.

## Validation, publication and placement

Extraction returns a draft with `status: needs_review`, nullable unknown fields and blocking issues. Its separate [extraction schema](../src/shared/extraction.ts) deliberately accepts more uncertain information than the sellable menu schema. Publication must map reviewed rows to stable identities and validate all v1 limits, prices and modifier cardinality. Extraction neither saves nor publishes a menu. Null prices must never become zero automatically.

Quote and submit must reject unknown/unavailable dishes, unknown/duplicate options, invalid selection counts or quantities, negative resulting prices and stale versions. A stale version returns `STALE_MENU`; the customer reviews a new quote. Free-text modifier submission is outside this initial contract, even if a prior draft permitted zero-price instructions.

Submission recalculates the cart against the current approved menu, checks the customer-reviewed total and requires explicit placement. The intended persistence transaction writes the unpaid ticket, immutable lines, scoped idempotency receipt and delivery event atomically. Acknowledgement comes only after commit. Same session/key and same request return the original ticket; changed contents conflict. The applied SQL transaction implements persistence and idempotency; the local fingerprint helper is used for deterministic validation tests. Without a durable cart ID, a new key is a distinct submission.

Only `received` / `unpaid` is in this slice. PR #1's `received → paid → preparing → ready` flow is replaced in this candidate; there is no payment confirmation, settlement or kitchen status mutation. Any additional state requires another reviewed contract change.

## Integration boundaries

Kimberley owns onboarding/review, storefront/QR, customer cart and kitchen screens. Elsen owns backend, AI, contracts, validation, integration and deployment. The kitchen must show only the signed-in member's restaurant tickets; public guest receipt access must be scoped to the submitting session. Private demo sessions must not expose each other's tickets.

Web, WhatsApp and live voice are intended adapters to the same validated order path. Source `web` includes QR entry. Live audio itself has `orderingEnabled: false`: transcript review and explicit placement use separate staff-authorized voice review/order endpoints. Voice remains a local supervised demo pending real audio verification and server-enforced session lifetime. Personal WhatsApp is not yet connected to a business API. Actual API onboarding and receipt-identifier handling require review before integrating real messages. Store only the minimum restricted recipient data needed to reply, with expiry; never expose phone identifiers in kitchen/public responses or import production chats.

Changes to object names, meanings, status, limits or endpoint semantics require a reviewed contract update and matching fixtures before either surface relies on them. This local candidate is the input to that review, not proof of Kimberley's acceptance.


## Requested UI extensions

Done/Next, dine-in/takeaway and required opening hours are specified for review in [KIMBERLEY-UI-CONTRACTS.md](KIMBERLEY-UI-CONTRACTS.md). They are not accepted fields or persisted mutations in this v1 API. Photo enhancement and page import are deferred. See [FIRST-BACKEND-SYNC.md](FIRST-BACKEND-SYNC.md) for current migration/demo readiness.
