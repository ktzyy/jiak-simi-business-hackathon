# Dish photo integration proposal

Status: implemented and applied to staging on 13 September 2026 after explicit user approval. Migration `20260913084500_jiak_simi_dish_photos.sql` matches the reviewed SQL hash below. APIs and UI are integrated; real private generation/enhancement previews passed. See `KIM-DEMO-SYNC.md` for current runtime contracts and verification. The design rationale below describes the approved extension; proposed cleanup remains future work.

## What exists today

- `src/components/onboarding/onboarding.tsx` retains an uploaded `File` and an object URL in React memory. The object URL is revoked on replacement/unmount; reload loses the source. Extraction sends the bytes directly to the API. There is no durable source-upload ID to use for a later image job.
- `src/shared/extraction.ts` links extracted items through `sourceEntryId`. Its `sourceEntries.region` is human-readable location evidence, explicitly **not** a verified crop rectangle. A dish name being present on the menu does not establish that its photograph is present.
- `menu-review.tsx` already provides expandable dish cards and separate menu-detail checks. `onboarding.tsx` prepares a preview, persists an uncertain publication attempt in sessionStorage, and reconciles the exact menu/details version before another publication.
- Customer cards and the phone preview share `CustomerCart`. `ordering/demo-photo.ts` provides manually checked positions for stable dummy dish IDs plus exact names, using the bundled original menu photograph. It neither enhances uploaded images nor supplies photos for arbitrary extracted dishes.
- Current strict `MenuSchema` dish fields contain no image. Published menu and stall details are versioned; there is no dish-image manifest, candidate job store or source-photo bucket in the current migrations. Adding an arbitrary `imageUrl` to the current request would fail validation and would bypass the missing approval lifecycle.

## Smallest complete merchant flow

1. Keep “Read my menu” and the existing details review. Add a small **Photo · Optional** panel inside each included dish card, using the existing paper background, border radius, green actions and red error styles.
2. Offer **Use photo from my menu**, **Create an illustrative photo**, and **No photo**. Never silently choose generation because extraction did not locate a crop.
3. For an existing visible photograph, display the whole original uploaded image; an optional region hint may identify the dish, but no crop selection is required. The merchant confirms “This photo shows [dish name]” before enhancement. Show “Choose a clearer photo” when the dish photograph is too small or unclear. Do not turn unreadable pixels into invented toppings, portions or ingredients.
4. For an absent photograph, ask the merchant to confirm the dish name and a short factual description before generation. Caption the result **AI-generated illustration** in the review, phone preview and customer card. An enhanced actual photograph uses **AI-enhanced photo**. Model output must never supply or change menu prices, modifiers or availability.
5. Show original source and candidate side by side with **Use this photo**, **Try again**, and **Keep no photo**. Approval is a separate action from the existing menu-details check. One selected candidate per dish; no batch auto-approval. A failed or slow photo job leaves normal text-menu publication available.
6. Existing phone preview renders only selected, current approvals, with the same customer-facing labels. “Publish menu” snapshots the selected image manifest alongside that exact menu version. Customers never read mutable draft selections.

Loading copy should say “Preparing a photo…” and allow the merchant to keep editing another dish. Do not give a fabricated completion percentage. If dispatch acknowledgement is unknown, show **Check photo status**; do not submit another paid job automatically.

## Proposed sidecar fields (subject to provider-lane schema naming)

Provider-lane alignment: new `src/shared/dish-photo.ts` proposes `DishPhotoRequest` and `DishPhotoCandidate`. `enhance_visible` requires `merchantConfirmedVisible: true`, `sourceImageId`, `sourceEntryId` and an optional normalized `{x,y,width,height}` region hint; `generate_similar` has no source. The server resolves an authorized upload and provides the whole original image bytes. Candidate output is `needs_review`, with source/output hashes and mandatory provenance label. The `sourceId` shorthand below maps to that `sourceImageId`; it is not a second source identity.

| Record | Required information | Boundary |
| --- | --- | --- |
| Source upload | `sourceId`, `restaurantId`, `sha256`, width/height, MIME, private object key, `expiresAt` | Server validates actual decoded dimensions/type/size and strips metadata. Never persist a browser blob URL or accept an arbitrary fetch URL. |
| Dish pairing | `dishId`, `draftRevision`, `sourceId`, `sourceEntryId` if available, optional normalized region hint, `pairingConfirmedAt` | Human-confirmed photograph pairing, separate from OCR text evidence. Source hash is immutable. |
| Photo request/job | `jobId`, `restaurantId`, `dishId`, `mode: enhance_visible | generate_similar`, whole source/optional region reference or approved description, `requestHash`, idempotency key, `status`, provider request reference | Exact repeated request reuses its job. A changed request requires a new key. `dispatch_unknown` cannot be automatically retried. |
| Candidate | `candidateId`, `candidateVersion`, `jobId`, output asset ID/hash, dimensions/MIME, origin label, `status: needs_review | approved | rejected` | Output remains private until selected and published. No arbitrary provider URL crosses to the browser. |
| Draft selection | `dishId`, selected candidate ID/version/hash, approved dish-content hash, approved source hash, approval time | Source/region/description/dish identity changes invalidate approval. A new candidate never inherits approval. A price-only change need not invalidate an unchanged food depiction. |
| Published photo manifest | `restaurantId`, `menuId`, `menuVersion`, immutable entries keyed by `dishId`, selected asset ID/hash, alt text and required origin label | Server derives this from valid approvals; clients cannot invent `approved: true`. Missing entries render a placeholder. |

Keep sidecar schemas separate from ordering price/cart contracts. A reviewed publication request may reference `photoSelectionVersion`; the server must validate and snapshot that selection in the same publication transaction. The published stall response can add a validated `photos` manifest, with the API client and preview updated together. Do not publish text first and mutate photos later under the same menu version.

Proposed endpoints, all through the existing shared API client: create bounded source upload; create photo job; read/reconcile job; approve/reject candidate; read photo draft; publish reviewed menu plus selection revision. Exact paths and names should follow the provider lane's new contract. Restaurant scope is explicit on every handler. Existing public-demo sentinel is allowed only for the fixed dummy stall when demo mode is enabled.

## Persistence and infrastructure work required

A hosted, reload-safe generation flow needs new persistence; the current in-memory upload and static bundled files cannot provide it.

- Private source and candidate Storage objects, keyed by server-issued IDs within a restaurant prefix; no anonymous listing/writes. Membership-scoped reads via short-lived signed URLs or a validated same-origin media endpoint. The public demo branch must enforce the one dummy restaurant independently of broader actor membership.
- Durable job/idempotency, candidate, selection and immutable publication-manifest records. Exposed tables require least-privilege grants and membership RLS; prefer existing server-only RPC patterns for mutations. Approval and publication validation belong in the database transaction, not a browser checkbox.
- Public delivery only for selected derivatives from a published manifest. Originals, rejected candidates and provider responses remain private. Keep published asset bytes immutable; generate a new object key for any changed bytes. Do not overwrite a previously published object.
- Retention proposal: unreferenced source/candidate uploads expire after 24 hours; keep active review sources for a clearly disclosed bounded review window, and retain published derivatives while their publication remains available. Deletion must respect references from active jobs and published manifests. Before expiry, show a re-upload path; never reuse an expired source ID with different bytes.
- A dedicated durable image budget, with actor/restaurant caps and an atomic reservation before provider dispatch. OCR/voice counters do not constitute an approved image-generation budget. Paid dispatch uncertainty consumes its reservation until reconciliation. Limit concurrent jobs per restaurant and cap bytes/dimensions/request count.
- The database/storage lane should draft these changes for explicit migration approval before implementation/application. A new operation cannot be silently added to existing SQL enum/check constraints. No such changes are authorized by this proposal alone.

If infrastructure cannot fit the deadline, retain reviewed bundled demo images and the current upload/OCR flow, and show the photo-generation panel as an explicitly unavailable feature. A browser-only generated preview must not be described as published or reload-safe. Avoid a partial feature that loses approved images after a refresh.

## Ownership and verification

Provider/photo-contract lane: bounded transformation inputs, output validation, exact provenance labels, provider dispatch/reconciliation adapter and separate photo schemas. UI lane after coordination: `onboarding.tsx`, `menu-review.tsx`, a new optional dish-photo panel, shared phone/customer renderer and minimal scoped CSS. Database lane: storage, job/approval persistence, budget and atomic publication manifest. Root: approved scope, credentials, migrations and deployment.

Critical checks: a tiny/unverified crop cannot become an enhanced original; an absent-photo request remains labelled generated; rejecting/replacing a candidate does not alter the live image; edits invalidate stale image approval; reloading resumes the same job without another paid dispatch; old publication manifests remain unchanged; another restaurant cannot read or approve an asset; unknown publication retries retain the same menu and photo selection; ordering totals/options are identical with and without photos.

## Concrete SQL draft for approval

The bounded draft is `docs/dish-photo-extension.sql`, tested locally with PGlite. It is **not** a migration and has not been applied remotely. This section supersedes the broader separate-candidate/selection-table suggestion above for the deadline implementation.

Two private tables: `dish_photo_jobs` combines source descriptor, exact request, durable reservation and immutable ready candidate; `published_dish_photos` pins a photo manifest to a published menu version. The private Storage bucket is `dish-photos-private` (8 MiB object cap; source input remains capped at 5 MiB). No anonymous or authenticated Storage policy is added. Existing menu publishing remains compatible and produces no photo manifest unless the wrapper is used.

Five server-only RPCs:

- `reserve_dish_photo_job(p_actor_id, p_restaurant_id, p_idempotency_key, p_request, p_source)` checks owner/editor membership, serializes per restaurant and enforces 10 reservations per sliding 10 minutes and 50 per sliding 24 hours. Only the first exact reservation returns `dispatchAllowed: true`; all replays return false, including a crash before dispatch. Changed payload with the same key conflicts.
- `finish_dish_photo_job(p_actor_id, p_restaurant_id, p_job_id, p_result)` saves a validated immutable ready candidate, or null for definitive failure. Failure and uncertainty retain the charge. No automatic redispatch or refund.
- `read_dish_photo_job(p_actor_id, p_restaurant_id, p_job_id, p_idempotency_key DEFAULT NULL)` requires exactly one job ID or request key and supplies authenticated preview/status recovery and never authorizes a new dispatch.
- `publish_menu_with_photos(p_restaurant_id, p_actor_id, p_menu, p_stall_details_version, p_selections)` accepts explicit merchant-approved `{dishId, jobId}` selections, checks ready candidates and exact dish ID/name, calls existing `publish_menu` and inserts the immutable manifest in one transaction. A failed photo check cannot leave a half-published menu.
- `read_published_photos(p_restaurant_id, p_menu_id, p_menu_version)` returns the snapshot, or an empty array for a text-only publication. This RPC is also service-role only: the HTTP endpoint sanitizes it, and the media endpoint checks membership in this manifest before fetching private bytes.

The server uploads originals to `{restaurantId}/sources/{sourceImageId}` and derivatives to `{restaurantId}/candidates/{jobId}` with overwrite disabled. Source descriptor is `{sourceImageId, objectKey, sha256, mimeType, sizeBytes}`. Result is `{objectKey, sizeBytes, candidate}` using the provider lane's validated candidate contract; never store base64 in PostgreSQL. Output `candidate.status` remains `needs_review`; job `ready` means bytes are available, not that the merchant approved them. Publication selections are the explicit approval action. A different provider output requires a fresh job.

Handlers must validate actual bytes, object existence, immutable source hash and provider candidate schema before calling SQL. API scope must reject public demo access outside the fixed dummy restaurant before privileged calls. No table grants, direct browser storage writes, source publication or client-supplied approval flag are introduced. The synchronous HTTP job has a bounded provider timeout and persistent unknown state; no worker queue is implied. A server receiving an uncertain result must reconcile the existing job instead of invoking the provider again. Storage cleanup is separate operational work: keep published derivatives indefinitely while referenced, and do not prune job rows within the 24-hour budget window or idempotency recovery lifetime.

HTTP recovery: `GET /api/v1/dish-photos/by-key/{key}?restaurantId=...` retrieves a reservation after an interrupted create response without resending source bytes or making a paid call. The provider response is never exposed as base64; authenticated candidate preview and published manifest-backed media endpoints serve validated JPEG bytes.
