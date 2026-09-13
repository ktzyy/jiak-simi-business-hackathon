# AI butler channels and integration boundary

Updated 13 September 2026. The voice-assisted ordering transport and backend adapter are implemented and mock-tested. Real laptop audio, deployed database RPCs and screen integration still need an end-to-end test. Kimberley owns the screens; Elsen owns the voice implementation and order service. No remote migration or account change is performed by this document.

## Implemented voice-assisted ordering

The requested model remains `gpt-live-1`. Start exchanges a browser WebRTC SDP offer at OpenAI's Live `/v1/live/sessions` endpoint. The server supplies the published menu, availability, prices and modifier constraints. Client instructions and menus are rejected. [Official create-session reference](https://developers.openai.com/api/reference/resources/live/methods/create)

The browser opens `oai-events` before its offer. Only `session.started`, `session.input_transcript.delta`, `session.closed` and error events are received; the sole allowed client command is `session.close`. Input transcript fragments accumulate in order and duplicate event IDs are ignored, with a 4,000-character cap. Assistant speech is never added to the customer request. Fragments are imperfect and have no completed-turn event; Prepare review uses a deliberate snapshot, not each fragment. [Live transcript and application processing guide](https://developers.openai.com/api/docs/guides/live-delegation)

| Endpoint | Request | Result |
| --- | --- | --- |
| `POST /api/v1/live/sessions` | `{restaurantId,sdp}` | `{sessionId,sdp,model,voiceSessionId,expiresAt,reviewEnabled:true,orderingEnabled:false}` |
| `POST /api/v1/live/reviews` | `{voiceSessionId,text,fulfillmentType}` | `{intent,review:null}` for clarification, or `{intent,review:{quote,confirmationNonce,revision}}` |
| `POST /api/v1/live/orders` | `{voiceSessionId,confirmationNonce,confirmed:true}` | Persisted unpaid ticket with source `voice` |
| `POST /api/v1/live/close` | `{voiceSessionId}` | `{ok:true}` only after provider close acknowledgement and database close |

Every endpoint requires a verified staff Bearer session and same-origin request. Database RPCs scope ownership to active restaurant staff. Session creation consumes a distributed staff AI budget before the provider call; preparation consumes the internal guest AI budget. The internal guest hash stays on the server. Creation persists provider-to-restaurant/actor ownership before returning SDP. If persistence fails, it attempts an awaited provider close.

Prepare review requires an explicit `fulfillmentType` selection (`dine_in` or `takeaway`) with no default. A conflicting spoken dining choice returns clarification rather than overriding the selection. The quote and unpaid ticket snapshot this choice. Changing the selection invalidates the displayed review and requires Prepare review again.

Prepare review invalidates the old confirmation nonce before interpreting the transcript. The model proposes item IDs/options only; the server builds a cart from the authoritative menu, and SQL quotes it. Ambiguity returns issues without a submit nonce. A revision check prevents an earlier parse from overwriting a newer review. Confirm uses the stored cart, quote and nonce, with database idempotency: no caller-supplied prices or carts are accepted at the submit route. Stale menu/nonce requires another review; an exact confirmed retry recovers the persisted ticket.

`orderingEnabled:false` means the **Live model cannot place an order**. `reviewEnabled:true` means the app can build a reviewed order from the transcript through the separate authenticated adapter. The confirmation button is mandatory. There is no model delegation, autonomous placement, payment confirmation or hands-free confirmation claim.

## Laptop integration and lifecycle

`connectLiveAudio(audio, createSession, options)` supplies transcript and connection-state callbacks, `transcript()` for Prepare review, and async `close()`. Pass an AbortController signal so End also cancels pending microphone permission/ICE/SDP. Late microphone tracks are stopped; the UI must surface playback permission and close errors. Use `setMicrophoneEnabled(false)` while preparing and reviewing, without ending the server session; Confirm first, then End, because End invalidates any pending unsubmitted review. Late transcript fragments can still arrive. New transcript after a shown review must mark that review outdated in the UI and require Prepare review again. Disable overlapping Prepare clicks and ignore responses whose revision is older than the currently displayed review.

Pass `options.endSession` to call `/live/close` with the server-issued `voiceSessionId`. Normal End immediately stops microphone tracks and playback, then awaits the server close before disposing transport. If it fails, the client attempts `session.close` directly and surfaces the failure for retry. Page hiding and the returned expiry trigger cleanup, but browsers may abort requests during navigation and timers can be suspended.

Server termination opens a bounded sideband WebSocket, sends `session.close` and waits up to ten seconds for `session.closed`. A socket disconnect alone is not accepted as proof of termination. It does not use `/hangup`, which the official reference describes for SIP. Sideband does not replay earlier terminal events: if the session already ended before attach, authoritative acknowledgement may remain unavailable and End will report an unconfirmed result. [Sideband control reference](https://developers.openai.com/api/reference/resources/live/sideband-websocket), [SIP hangup reference](https://developers.openai.com/api/reference/resources/live/subresources/sessions/methods/hangup)

**Session creation remains development-only.** The ten-minute database expiry and browser timer limit this supervised demo's ordering window, but do not impose a provider audio spending limit. Production returns `503 NOT_CONFIGURED` until server-enforced provider lifetime and recovery of interrupted creation are implemented. Do not bypass this gate to host public voice sessions. No durable worker is needed for transcript review; reliable unattended provider lifetime still needs hosting/scheduling work.

## Verification and remaining acceptance gates

Offline tests cover exact Live permissions and request shape, published menu grounding, staff budget denial before billing, creation rollback cleanup, nonce invalidation before ambiguous parsing, review revision propagation, strict explicit confirmation, channel provenance, owned close acknowledgement, transcript deduplication and End during pending microphone permission. Provider tests use mocks; these are not successful real audio calls.

Next integration gates: apply the separately approved voice RPC draft and run hosted regression checks; connect the staff-supervised laptop screen with the callbacks above; test real audio, echo, interruption and menu pronunciation; demonstrate transcript → review → explicit confirmation → unpaid kitchen ticket and exact retry. Existing tap ordering must remain available on audio/provider failure. A model's spoken success cannot substitute for a persisted receipt.

## Personal WhatsApp account

Elsen confirmed his account is **personal WhatsApp**. It is not presently an attached Cloud API business number. Do not automate WhatsApp Web, send messages, migrate the account, remove its registration or upload its chats as part of this work.

Meta's official Cloud API collection requires a Meta business portfolio, WhatsApp Business Account and business phone number. API tokens and the `whatsapp_business_management` / `whatsapp_business_messaging` permissions are separate from the OpenAI key. User tokens are short-lived, so deployment must use an appropriate managed credential. [Meta-owned API documentation](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)

Recommended next check is whether the Meta app dashboard offers a test business sender for the demo, with Elsen's personal number acting as the customer. This would demonstrate real WhatsApp ordering but would not make his personal account the hawker's sender. If the personal number must be the hawker sender, review official number onboarding with Elsen before changing anything.

Coexistence is a possible **WhatsApp Business app** path, not evidence that this personal account can be attached unchanged. Meta's current [business-app onboarding reference](https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users/) could not be fetched during this research. Exact eligibility, regional availability, provider/self-onboarding requirements and migration impact therefore remain unverified; do not promise coexistence works for this account.

Once provisioned, proposed adapter work is: publicly reachable HTTPS webhook; challenge verification; raw-body signature validation; server-side recipient phone-number-to-restaurant mapping; durable inbound-event deduplication; quote-bound confirmation; and an outbound delivery queue. Verify current Meta messaging-window/template rules before enabling replies. The user has not authorized this agent to send messages. Phone identifiers belong in restricted channel/session records rather than public kitchen payloads; use synthetic message fixtures until the connection is approved.

## Acceptance gates

1. Offline tests pass for exact Live request/response shape, redacted errors, strict HTTP inputs, tenant mismatch, absent published menu, server menu grounding, oversize-menu rejection and production fail-closed behavior. These tests do not call paid APIs.
2. Test microphone audio on localhost with actual `gpt-live-1` access; label session as conversation-only.
3. Freeze quote/confirm/submit fixtures with Kimberley and reconcile shared contract.
4. Persist and recover unpaid tickets on staging Supabase after separately approved database work.
5. Exercise stale menu, unknown modifier, interrupted voice, duplicate submit and reconnect.
6. Complete Meta onboarding and verify provider rules before claiming WhatsApp integration.

The existing photo-to-reviewed-menu-to-web-order journey remains demonstrable even if Live account access or Meta onboarding takes longer.
