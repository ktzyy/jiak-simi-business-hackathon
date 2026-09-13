# UI additions — review proposal, 13 September 2026

Status: isolated proposal for Kimberley and Elsen. The new handoff permits review exploration, not application integration, infrastructure changes, or freezing a new shared contract. The existing candidate v1 contracts and `createApiClient` remain unchanged. No enhancement service, metadata importer, asset storage, or image publication integration is implemented by these files.

The current executable proposal lives in `src/shared/ui-additions.ts`; synthetic states live in `src/shared/ui-additions-fixtures.ts`. Neither is imported by an application endpoint. These drafts make review concrete; they are not a security boundary, ownership check, persistence layer, or authorization to publish a merchant menu.

## Source photo and approval lifecycle

Use stable `restaurantId` and `dishId` for each photo association. A source revision carries `sourceVersion`, `originalUploadAssetId`, `normalizedAssetId`, `dishCropAssetId`, crop coordinates, `provenance`, `pairing`, and `quality`. Crop coordinates are normalized against the orientation-corrected image; retain the source dimensions and orientation transform in protected asset metadata. A replacement upload, different crop, or reassignment creates a new source revision and clears pairing and image approval. Stable dish IDs must come from the reviewed-menu identity mapping, not OCR array positions or inferred names.

Retain the raw original unchanged. Decode MPO/JPG and other permitted formats to conventional JPEG/PNG with orientation applied before service dispatch, strip private metadata from derivatives, and inspect the actual decoded format. Format normalization is separate from enhancement. The original choice means the verified dish crop, not the entire menu board with unrelated dishes/contact details. For an uploaded single-dish photograph, create a normalized dish derivative too.

Pairing must be merchant-verified and quality usable before enhancement or selection. Low resolution, printed-photo glare, obscured food or texture must remain `fresh_photo_required` when fidelity cannot be judged. Never synthesize an absent dish from its menu name. Do not infer hidden toppings/ingredients or call a clean image faithful merely because it looks plausible. Input selection should exclude unrelated personal/contact details wherever feasible.

`jobId` identifies one durable optional dish job. Bind its restaurant/dish/source revision, request fingerprint and `idempotencyKey` before provider dispatch. Same key and same fingerprint return the same job; changed input conflicts. Proposed states are `not_dispatched`, `queued`, `running`, `dispatch_unknown`, `succeeded`, `failed`. A timeout after dispatch is unknown, not proof of failure. Reconcile by durable job identity/provider receipt before any new billable attempt; preserve the key. Only a proven non-dispatch may use “Photo not sent. Try again when you're connected.” Do not automatically create a new job after an unknown result. Explicit “Try again” after a terminal/reconciled job creates a new candidate revision and clears prior photo approval. If the provider cannot reconcile, keep the job unresolved and offer original/no photo rather than automatically rebilling.

A candidate binds `assetId`, `candidateVersion`, and `sourceVersion`. Approval binds restaurant, dish, source revision, current candidate revision (null if none), selected asset, reviewer and timestamp. Replacing a source or regenerating a candidate invalidates prior approval, including an original-photo choice. Choosing original/candidate is explicit; “No photo” clears the selection. “Upload another photo” restarts match review. Jobs completing later never replace an approved published asset.

`draftApprovedPhotoProjection` returns only the selected derivative identity when all approval bindings still match. It returns null for stale/unverified/low-quality state; it does not select a fallback. A future publish transaction must surface unresolved selections and let the merchant wait, explicitly keep an eligible original, or choose no photo. Photo failure cannot block a text-only menu. Menu/pricing approval and photo approval are separate: neither implies the other. Publish snapshots the approved asset IDs alongside a new immutable menu version; no mutable “latest photo” links. Object keys must also be immutable, so frozen references cannot silently change their bytes.

The known `IMG_4544.JPG` reference and $4.50 Char Siew Rice label are handoff context, not an approved source/dish mapping, menu price or full extraction. The synthetic fixtures do not claim those real approvals.

## Proposed shared client methods and endpoints

These routes are suggestions for review, not implemented endpoints. Extend the existing `src/shared/api-client.ts` after agreement; do not add a parallel image client or let UI call providers directly. Resolve authenticated restaurant membership and asset ownership on every request. All writes require validation, CSRF/origin controls appropriate to the existing authenticated transport, and scoped idempotency/version checks.

| Proposed client method | Proposed route under `/api/v1` | Purpose |
| --- | --- | --- |
| `createDishPhotoSource` | `POST /restaurants/:restaurantId/dishes/:dishId/photo-sources` | Protected upload/normalized crop creation and source revision; limits enforced before provider dispatch. |
| `verifyDishPhotoMatch` | `POST /restaurants/:restaurantId/dishes/:dishId/photo-match` | Explicit match review against source revision. |
| `startDishPhotoCleanup` | `POST /restaurants/:restaurantId/dishes/:dishId/photo-jobs` | Revision-bound job with `Idempotency-Key`; accepts asset IDs, never arbitrary fetch URLs. |
| `readDishPhotoJob` | `GET /restaurants/:restaurantId/dishes/:dishId/photo-jobs/:jobId` | Poll/reconcile the same job; no new billable dispatch. |
| `selectDishPhoto` | `POST /restaurants/:restaurantId/dishes/:dishId/photo-selection` | Original/candidate/no-photo choice with source/candidate revision precondition. |
| `readStallDetails`, `saveStallDetails` | `GET`, `PUT /restaurants/:restaurantId/details` | Member-only draft fields with optimistic revision check. |
| `proposeStallDetailsImport` | `POST /restaurants/:restaurantId/detail-imports` | Controlled supported-provider import, review-only response. |

Private original/candidate preview URLs should be short-lived, restaurant-authorized URL envelopes resolved by asset ID, with `expiresAt`; do not store expiring URLs in publication snapshots. Public selected derivatives get a separate immutable public URL mapping only on explicit publish. Existing menu publication must gain a reviewed extension carrying image selection versions and stall-publication projection. Do not silently add these properties to current strict `MenuSchema` or advertise them in today's menu responses.

## Optional stall details

Proposed fields: `address` (line, optional unit/postal code/country), `contact` (country, canonical phone, `publish` default false), `timezone`, `weeklyHours`, `dateOverrides`, `existingPageUrl`. Address and contact may be null for the demo. No default phone consent from pasted page, country inference, or sign-in identity. Saving/importing a number does not publish it. `draftPublicStallProjection` excludes the contact unless opted in and excludes the import link entirely.

The initial draft deliberately supports Singapore only (`SG`, `Asia/Singapore`). Its phone check is a narrow Singapore domestic-format check, not ownership verification, reachability, WhatsApp eligibility, or exhaustive international validation. UI retains user input for correction; do not silently prepend +65 to foreign numbers. Adding countries requires explicit country-aware normalization/validation using a maintained numbering library and matching fixtures before release. No new dependency is introduced here.

Hours use ISO weekdays (Monday 1), local `HH:mm`, explicit `closesNextDay`, and date-specific overrides. Null intervals mean unknown; an empty list means closed. Multiple intervals allow split opening hours. Overrides take precedence for their local date. Before production integration, implement cross-midnight overlap checks and define special-date behavior for a previous day's overnight interval. These are display/review fields, not a guarantee the stall is currently accepting orders; order availability remains separately controlled.

## Public-page metadata import

All providers currently unsupported until server access is implemented and verified. Google Maps, inline and Oddle are requested candidates, not working integrations. Prefer each provider's documented authorized API or supported public metadata access; do not scrape behind login, evade rate limits or introduce new credential onboarding as part of this proposal. Unsupported, private, blocked and unavailable pages offer manual entry and never block onboarding. A link supplies no permission to import third-party food imagery.

A future server importer must use a reviewed provider/host allowlist; HTTPS only; no URL credentials/nonstandard ports; reject localhost, IP literals, loopback/private/link-local/metadata ranges including IPv6 and IPv4-mapped forms. Validate every resolved address before connection, pin the validated destination while preserving TLS hostname verification, and recheck each allowed redirect. Default to no redirects unless a provider's approved canonical redirect is required. Apply timeout, response-size, decompression, MIME-type and redirect-count limits; reject arbitrary proxying. Browser URL validation alone is not an SSRF defense. Strip active content and treat imported text as data, never execution instructions. Log only necessary source/job metadata, not tokens or unrelated page personal data.

`DraftMetadataImportSchema` returns `requestId`, restaurant scope, source URL, review-only `proposals`, `unresolvedFields` and status. Per-field source URL and `existingManualText` support comparison. Raw proposals require normal validation and explicit per-field merchant acceptance before saving; preserve untouched manual fields, and reject stale revisions. Accepting contact never turns publication on. Success means data was found, not verified or saved. Fixtures cover success, partial data, conflicts, unsupported link, unavailable page, validation error and known-not-sent. Network uncertainty must not be mislabeled known-not-sent; read/reconcile the import request identity if its state is unknown.

## Storage and operations decisions to route to the database task

The separate database task owns any Supabase migration/application. Core schema approval from earlier work does not silently cover these new infrastructure additions. Send this proposal for review before adding asset, job, approval or metadata tables/buckets.

Proposed pilot limits for review: JPEG/PNG/normalized MPO input; 15 MB upload and 40 megapixels decoded maximum; at most one active enhancement per dish, two per restaurant; five explicit enhancement attempts per dish per day and twenty per restaurant per day; a server-enforced provider spend cap configured before enablement. Enforce limits atomically across workers, count uncertain dispatches toward the cap, and do not trust browser MIME/size declarations. Limit normalization resource usage and re-encode safely before service dispatch.

Proposed lifecycle: restaurant-private originals, normalized crops and unused candidates expire after 7 days unless actively referenced by review; active review may extend retention explicitly, with a 30-day ceiling. Published selected derivatives remain while referenced by retained immutable menu versions; unpublish/deletion behavior and backup retention require explicit policy. Never delete a referenced published asset via temporary cleanup. Merchant removal, restaurant deletion and expired private preview access need deliberate handling. Job records need a minimal retained idempotency/fingerprint tombstone for the chosen retry window; final duration must be agreed with the database task.

Required infrastructure: tenant-scoped asset ownership metadata and protected storage, immutable object keys, scoped signed preview access, a restricted upload path, durable per-dish queue/job/dispatch receipts, revision-bound approvals, atomic publish snapshot checks, retention jobs, and least-privilege policies. Only approved derivatives may be exposed publicly. Originals/candidates and membership/recipient data must never leak in public menu or kitchen responses. None is created here.

## Ownership and verification

Kimberley: visual layout, microcopy, photo matching/comparison/selection controls and approved image presentation in her assigned UI files. Preserve warm plain wording from the handoff; no confidence scores in customer copy. Elsen: source matching, provider integration, validated revisions, shared client extension/fixtures, job reconciliation and publication behavior. Separate database task: storage/RLS/schema/atomic persistence after the new proposal is agreed. Existing payment, kitchen status, modifier and access conflicts remain governed by the current candidate product contract; this proposal does not expand those states.

Files produced for this review only: this document; `src/shared/ui-additions.ts`; `src/shared/ui-additions-fixtures.ts`; `tests/ui-additions.test.ts`. Four behavioral tests verify stale-approval rejection, selected-derivative projection, detached immutable publication snapshots and opt-in public phone projection. They do not demonstrate provider fidelity, security of a future importer, database authorization or deployment readiness.
