# OCR integration for Kimberley

The real extraction endpoint is `POST /api/v1/menu-extractions`. It accepts raw JPEG, PNG or WebP bytes up to **5 MiB**. Send `Content-Type` matching the file, `X-Restaurant-Id` with the active restaurant UUID, and `Authorization: Bearer <Supabase staff access token>`. Requests must originate from this app. Use the shared API client; no separate image API or local demo token is needed.

The handler verifies the staff session using Supabase Auth. The server's `consume_staff_ai_budget` RPC requires active owner/editor membership and consumes the durable extraction allowance before any OpenAI call. Kitchen-only staff cannot extract. Missing OpenAI configuration or invalid/oversized images fail before budget consumption. The staff-budget migration `20260913050159_jiak_simi_channel_ordering.sql` is applied to the hackathon project, and the demo owner successfully exercised its extraction budget RPC. Absent RPCs on another environment still fail closed. Secrets and the Management API access token stay server-side; only the staff session JWT accompanies the browser request.

Uploads are raw bytes, **not multipart FormData and not JSON/base64**. HEIC is not accepted. Ask for a JPEG export/upload or convert locally to a supported conventional format while preserving orientation; never merely rename a HEIC extension. Current image validation checks type signatures and size, not a complete decoder. A malformed or MPO file may still require conventional JPEG normalization. Original files must remain unchanged.

Successful responses conform to `extractedMenuDraftSchema` in `src/shared/extraction.ts` and always have `status: "needs_review"`. Each item contains its draft ID, name, nullable `priceCents`, raw observed price text, modifier groups and a source-entry link. `sourceEntries` retain numbered dishes, add-ons, fees and headings as evidence; repeated labels remain separate. `region` describes an image position, not a crop rectangle or confirmed dish-photo match. No images are enhanced, matched or published by this endpoint.

Use `OCR_DRAFT_FIXTURE` from `src/shared/ocr-fixtures.ts` for frontend development. It is the actual verified orange-board response with private paths and provider metadata removed: 16 numbered dishes, two Rice add-on occurrences and three blocking review issues. It remains unapproved. `OCR_ERROR_FIXTURES` supplies authentication, membership, rate-limit and upload-error states. Names/descriptions/issues must render as text, never HTML.

The flow is:

1. Retain the original uploaded file locally while displaying the returned draft for review. Show unknown prices as needing input; never coerce `null` to zero. Keep source rows for add-ons/fees visible so they cannot silently disappear.
2. Let the merchant correct names/prices and explicitly decide item inclusion, source association and modifier applicability. Unknown/slash/range prices require a concrete merchant-entered value. Assign option rules explicitly; OCR does not infer free options or availability.
3. Construct `MenuExtractionReview` and call `buildReviewedMenu(draft, review)` from `src/shared/menu-review.ts`. This is a browser-safe review helper that returns the existing `Menu` contract only when all required decisions are supplied.
4. Show the result in preview, then call the existing authenticated publish method only after the merchant presses Publish. The publish endpoint revalidates menu structure and restaurant membership. A new extraction needs new review decisions.

`MenuExtractionReview` requires:

| Field | Required review decision |
| --- | --- |
| `draftId`, `confirmed: true` | Confirm this specific extraction has been reviewed. |
| `menu` | Complete existing Menu contract with integer prices, valid option rules, active restaurant/menu IDs and next version. |
| `itemResolutions` | Exactly one `{draftItemId, dishId, reason}` per extracted item. Use `dishId: null` with a reason to exclude an item. |
| `sourceResolutions` | Exactly one `{sourceEntryId, dishIds, reason}` per source entry, including Rice/add-ons/fees/headings. Empty `dishIds` explicitly excludes that evidence. Included extracted items must retain their corresponding source pairing. |
| `issueResolutions` | Exactly one `{issueId, reason}` per blocking issue. Describe the correction or exclusion instead of automatically marking all issues resolved. |
| `manualDishIds` | IDs of explicitly entered additional dishes in `menu`. Every final dish must have exactly one extracted-item origin or manual origin. |

These review notes are local workflow evidence. The current publish API accepts only `Menu`; it does not persist OCR source/review notes or claim durable photo provenance. Do not tell merchants that uploaded sources or review history are saved across sessions. Optional protected image storage and photo enhancement need the separately scoped contract/workflow.

Errors use `{error:{code,message,retryable}}` with `Cache-Control: no-store`. Handle 401 by signing in again, 403 by checking restaurant access, 429 by waiting for quota recovery, 400/413 by asking for a suitable image, and 502/503 by offering manual menu entry. Do not automatically replay a failed upload: it may already have consumed a paid call. The extraction service may make one internal technical retry within its shared 150-second deadline, while the frontend submits only once per deliberate upload action. This is synchronous extraction; there is no persisted OCR job ID or cross-session status-recovery endpoint yet.

Validation completed: 11 OCR handler/review integration tests, existing 11 extraction unit tests, scoped lint and TypeScript checking. Live extraction accuracy observations remain in `docs/menu-ocr-evaluation.md`; these new integration tests use mocks and do not claim a live authenticated browser run or additional OCR accuracy results.
