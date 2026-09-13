# Jiak Simi — integration sync, 13 September 2026

Public Site: https://jiak-simi-business-demo.elsenyong.chatgpt.site

Repository branch: `elsen/backend`. Reuse the existing Site project `appgprj_6aa6330ed72c819186a4fff3288b4caf`; do not register another Site. Deployed commit: `26f2570b191879a5c28f9178ce9b82550b9f2781`, published successfully at 16:58 Singapore time. This update supersedes the earlier recording-only handoff.

## GPT Live ordering

The reproduced failure was Next bundling the optional `ws` native mask helper incorrectly. `serverExternalPackages: ["ws"]` keeps the Node dependency intact. The Site forwards voice commands to the existing authenticated laptop relay; the laptop, Next server and Cloudflare tunnel must remain running.

The actual app now completes `gpt-live-1` WebRTC audio → backend intent → database quote → finite spoken readback → separate recorded confirmation → one unpaid voice ticket. A real protocol test with synthetic input and confirmation created ticket `25028f86-b317-40a2-9695-a2f55e9e359c`; replay returned that same ticket and the kitchen contained exactly one copy. A subsequent hosted test created ticket `2944904e-eab7-4b88-b9b4-36b9993778ff`, again one unpaid ticket on replay. The user then tested the public Site in their browser and confirmed that the order and kitchen ticket appear. Evidence: `artifacts/joint-test/voice-runtime-result.json`.

Voice defaults are dine-in and free chilli unless explicitly changed, as approved for this demo. Web orders still require explicit dining choice. The page shows the canonical order summary as soon as quoting finishes, then the persisted ticket. Known transcription failure can request a fresh readback/capture; uncertain database submission retries the same confirmation nonce. Error diagnostics never include customer speech or credentials.

The menu context omits UUIDs and deduplicates shared modifier groups. The full ten-dish photographed menu uses about 4,500 characters; a 100-dish fixture is covered. OpenAI separately enforces a 16,384-token startup instruction limit, so arbitrary thousands of unique options are not promised. Current published demo menu remains version 4 with three dishes at the user's recording request.

Test page: `/voice-test`. Say “One Char Siew Rice”; after the readback and beep say “Confirm.” Expected total S$4.50, dine-in, chilli, unpaid. Details: `docs/GPT-LIVE-PROTOCOL-AUDIT.md`.

## OCR and dish photos

Upload menu → extract readable dishes/prices → review → optional dish photos → customer preview → publish. In dummy demo mode unreadable entries are skipped; normal strict review remains available outside the dummy scope.

Each included dish has optional **Enhance menu photo** and **Generate dish photo** actions. Enhancement requires the merchant to confirm that the selected dish is visible in the uploaded source; it uses the original image and dish identity, with no forced crop workflow. Generation produces an illustration when a matching source photo is absent. Both require **Use photo** before publication.

Customer cards and previews display **AI-enhanced source photo** or **AI-generated illustration**. These are AI outputs and should be reviewed for ingredients and serving accuracy. No generated photo changes prices, availability, modifiers or dietary claims.

Photo jobs use frozen request keys, private Storage and immutable outputs. Unknown outcomes use read-only status checks and never automatically buy another image. Replacing the source or changing a dish's name invalidates its selection. The publication request carries exact selected job IDs; the database commits the photo manifest with the menu version atomically. A text-only menu is still supported.

Shared client methods:

- `createDishPhoto(restaurantId, key, request, staffToken, source?)`
- `readDishPhoto(restaurantId, jobId, staffToken)` and `findDishPhoto(restaurantId, key, staffToken)`
- `dishPhotoPreview(restaurantId, jobId, staffToken)` returns a private Blob
- `publishMenuWithPhotos(menu, staffToken, stallDetailsVersion, selections)`
- `readPublishedPhotos(restaurantId, menuId, menuVersion)` returns version-bound same-origin image URLs and disclosure metadata

Contracts: `src/shared/dish-photo.ts`. Routes: `/api/v1/dish-photos/**`. Provider: Sunburst enhancement / Flare illustration, one low-quality 1024px JPEG per request, no automatic provider retries. Original upload max 5 MiB; candidate max 8 MiB; request deadline 180 seconds. Independent image cap: 10 requests per 10 minutes and 50 per day per stall.

Real generation and enhancement have produced private candidates. Authenticated previews succeed; anonymous previews and unpublished public image access are rejected. Hosted Supabase atomic photo publication passed in a rolled-back transaction, leaving menu version 4 unchanged. Evidence: `artifacts/photo-smoke/`.

## Database and other ordering contracts

Only staging Supabase `mikpepfrumtglwweolzq` is used. Browser code receives only project URL and publishable key; privileged keys are server-side.

Approved migrations applied:

1. `20260913042355_jiak_simi_202609130001_core_ordering.sql`
2. `20260913050159_jiak_simi_channel_ordering.sql`
3. `20260913053454_jiak_simi_web_ordering.sql`
4. `20260913084500_jiak_simi_dish_photos.sql`

Photo extension: two private RLS tables, five service-only functions and a private bucket. No browser table/function grants. Application receipts are in `artifacts/database-deployment/`.

Dummy restaurant: `ba2ad996-da84-4653-89a9-c028d77c050d`. Staff owner: `hawker-demo@jiak-simi.example`; credentials stay in ignored local configuration. Merchant APIs permit the public demo sentinel only for this restaurant when demo mode is enabled; other restaurant authorization is unchanged.

- Web fulfillment: explicit `dine_in` or `takeaway` through cart, quote and ticket, no surcharge/default.
- Hours: all seven days explicitly open/closed, interval validation, optimistic editing and published version snapshots. Current saved details may be newer than the published snapshot; always read before publishing.
- Kitchen: completion uses expected status version plus a stable key, advances only after acknowledgement and retains unpaid status.
- Joint base order: 2 Char Siew Rice + 1 Braised Pork Knuckle Rice = S$14.00 before extras.
- Telegram remains `@blackcharsiewbot` via the laptop polling process. Payments are demo-only; database tickets remain unpaid.

## Access and remaining operational limits

The Site audience is public. Sites identifies `tzykim@gmail.com` as an external viewer; a viewing invitation has been added. Publishing editor access is **not granted**: the connector restricts editors to the Site's ChatGPT workspace. The user confirmed that publishing will stay with the owner for this demo. GitHub source collaboration and Site publishing are separate permissions.

The laptop voice relay and Telegram polling process are demo dependencies, not permanent hosting. Voice currently limits one active device for the shared dummy actor. The user has confirmed browser voice ordering works. The complete merchant photo UI still needs device acceptance; API, database and synthetic WebRTC checks are recorded separately. Photo retention cleanup is not automated yet.

Validation before this release: 234 tests passed, TypeScript passed, lint passed with one existing unused-variable warning in an older test artifact. Worker build and public deployment passed. Hosted GPT Live ordering and real hosted image generation/private preview/replay checks passed. Release evidence: `artifacts/joint-test/hosted-voice-photo-release.json`. The generated and enhanced photo examples remain unpublished private previews; the live menu stays at three dishes.
