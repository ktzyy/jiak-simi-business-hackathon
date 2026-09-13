# Test Telegram, GPT-Live and the web backend

Target: hackathon Supabase project `mikpepfrumtglwweolzq`, demo restaurant **`ba2ad996-da84-4653-89a9-c028d77c050d`**. Current publication: **menu version 2 / details version 1**. Use `readPublishedStall(restaurantId)` for the menu and pinned hours, or `readMenu(restaurantId)` for the menu alone; read current IDs/versions instead of hard-coding them.

| Synthetic demo dish | SGD |
| --- | ---: |
| Char Siew Rice | 4.50 |
| Braised Pork Knuckle Rice | 5.00 |
| Braised Pork Knuckle Noodles | 5.00 |

All dishes support these approved options:

| Option | Extra SGD | Selection rule |
| --- | ---: | --- |
| Egg | 1.00 | Optional extras group: zero to three distinct choices |
| Char Siew | 2.00 | Same extras group |
| Shao Rou | 2.00 | Same extras group |
| Chilli / No chilli | 0.00 | Separate optional group: choose at most one |

One Char Siew Rice with Egg, Char Siew and Shao Rou is **S$9.50**. The original two Char Siew Rice plus one Braised Pork Knuckle Rice, without extras, remains **S$14.00**. Both totals and chilli exclusivity were verified through hosted guest quotes without placing another order. `DEMO_MENU_WITH_EXTRAS` is the exact current v2 fixture; `DEMO_MENU` intentionally remains v1 for historical tests.

Every new order requires an explicit **dine-in or takeaway** choice. Tickets remain unpaid; kitchen Done does not change payment status. Deliberately confirming a test order creates a real ticket in this hackathon database.

## Telegram text and audio

Open [@blackcharsiewbot](https://t.me/blackcharsiewbot) from the allowlisted demo account while the laptop polling runner is active.

1. Send `/menu` to load the published menu.
2. Send `2 Char Siew Rice, takeaway`.
3. Check two portions, **S$9.00**, and **takeaway** on the review. Missing dining mode should prompt clarification, not silently default.
4. Tap **Place order** once. Check the persisted receipt and unpaid total.
5. Send `/status` to recover the latest receipt. Repeating the same confirmation should return the original ticket.
6. Try a dish or option absent from the menu: expect clarification, not an invented price.

`/cancel` clears only an unsubmitted draft. To change a draft, send the complete revised order including dining mode; fragments do not accumulate into a conversation cart.

For the **provisional audio path**, send a voice note or supported audio recording no larger than **5 MB (5,000,000 bytes) and 20 seconds**, for example “Two char siew rice, takeaway.” The local Mac adapter decodes the recording and uses **GPT-Live `gpt-live-1`** input transcript fragments. It does not substitute browser speech recognition or another transcription model. Check every item, quantity, mode and total on the resulting review before tapping Place order. Failed or uncertain audio may require typing the full order or sending a new recording; there is no automatic placement. This path is implemented, but a successful real audio-order round trip has not been verified.

After a receipt, `/paydemo` shows a **fake two-second payment animation/presentation**. It is a demo only: no invoice/payment service or money movement, and the actual database order remains **unpaid**.

Restart polling only if no existing runner is active; never start a second copy or delete a webhook automatically:

```sh
node --env-file=.env.local --conditions=react-server --import tsx scripts/run-telegram-polling.ts
```

## GPT-Live on the laptop

Start the development server if it is not already running:

```sh
npm run dev -- --webpack --hostname localhost
```

Open [http://localhost:3000/voice-test](http://localhost:3000/voice-test). Sign in as `hawker-demo@jiak-simi.example` using `DEMO_STAFF_PASSWORD` from the ignored `.env.local`. Do not share or commit the password.

1. Press **Start GPT-Live** and allow microphone access. The model is **`gpt-live-1`** over WebRTC with server-read published menu context.
2. Say “I would like two char siew rice” and check the transcript.
3. Explicitly select **Dine in** or **Takeaway**. There is no default. A conflicting spoken choice requires clarification.
4. Press **Prepare order review**; the microphone pauses. Check the transcript, chosen mode and **S$9.00** total. Resume to clarify if needed, then prepare a fresh review.
5. Press **Place unpaid order** once and check its persisted receipt.
6. End the audio after placement. Ending beforehand invalidates an unsubmitted review.

If playback is blocked, press play on the audio control. New speech or a changed dining choice invalidates the displayed review. If submission acknowledgement is unknown, retry the **same confirmation**; do not change its nonce or start another order to retry. Keep the test short and supervised.

The page and creation endpoint are development-only pending reliable server-enforced provider lifetime. `gpt-live-1` account access was verified through a read-only model lookup; authenticated page rendering was checked. Neither proves microphone audio, a paid session handshake or a voice-to-kitchen round trip. No browser automation connection was available for audio verification.

## Web/backend acceptance already performed

All three migrations are applied, including web extension **`20260913053454`**; its **16 hosted assertions passed**. A real HTTP test on the original menu v1 already created this deliberate test order (the historical receipt is unchanged by publication of v2):

- Two Char Siew Rice + one Braised Pork Knuckle Rice.
- **Dine in · S$14.00 · unpaid**.
- Ticket **`0c124fc9-9220-4592-82f3-df0cf6077e25`**.
- Same-key submission replay recovered that ticket.
- Done and same-key Done replay returned the same completed acknowledgement.
- Observed queue afterwards: **1 received, 1 done, 2 total**. Counts may change as further tests run.

Read actual tickets with `createApiClient().kitchen(restaurantId,staffAccessToken)`. Verify source, mode, menu version, quantities, price, status and receipt ID. Done uses `completeKitchenOrder` with the current `expectedStatusVersion` and a preserved idempotency key. After successful Done, refresh and select the oldest remaining received ticket for Next. Do not relabel Done as paid.

Kimberley's onboarding/storefront/cart/kitchen UI is still absent from this checkout. The successful test above exercises HTTP/backend behavior, not those screens. The public `/order/:restaurantId` proxy allowance is pushed in `d632190`, ready for her UI integration.

## Opening hours and the future hosted link

The user-approved demo hours are now published: **09:00–18:00 every Monday–Sunday, Asia/Singapore**, details version 1 paired with menu version 2. They are reviewed demo values, not defaults for other stalls. Save the stall name with all seven explicit Singapore opening days before a new menu publication. Publish with the saved `stallDetailsVersion`; updating details alone does not change published hours. Public `readPublishedStall` exposes the immutable menu/details pairing. Legacy publications can still report hours as absent; the current demo v2 publication has the approved schedule. See [FIRST-BACKEND-SYNC.md](FIRST-BACKEND-SYNC.md).

Sites has a private, **unpublished** registration for project `appgprj_6aa6330ed72c819186a4fff3288b4caf`. The expected reserved address [jiak-simi-business-demo.zesty-crown-3337.chatgpt.site](https://jiak-simi-business-demo.zesty-crown-3337.chatgpt.site) and `/auth/confirm` callback are **not live or verified**. Supabase Auth staging URL/redirect settings have not been changed. Use localhost for the current voice test.
