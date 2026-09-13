# Local hands-free voice ordering

Open `/voice-test` on the local development server, or on the hosted site when its supervised relay is configured. Staff presses **Start device** and grants microphone/speaker access once; customers do not operate the screen. With `DEMO_MODE=true`, the page and endpoint use the explicit public-demo sentinel, restricted to the dummy restaurant. Without demo mode, a verified staff session is required locally. Production returns 404 for the page and 503 for the endpoint unless the supervised relay is configured.

1. **GPT-Live (`gpt-live-1`)** collects the spoken order and dine-in/takeaway, then delegates to the server. The sideband owns all backend actions. Browser transcript text never authorizes submission.
2. The server mutes Live input, parses its observed conversation against the current published menu, obtains a database quote, and stores its revision/confirmation nonce privately. Missing choices trigger spoken clarification.
3. The operator device mutes Live playback. **`gpt-4o-mini-tts`** reads a finite canonical quote: quantities, options, dining mode, SGD total and unpaid status. This is a separate speech utility; it does not replace GPT-Live as the conversation model.
4. Only successful finite playback completion arms a fresh recording. After a beep, say **“Yes, place this order”**, then wait quietly. The separate mono PCM recording ends after speech followed by one second of quiet, with an eight-second maximum. The server validates the file's 1.25–8 second duration, speech energy and quiet final second; silence, cutoff speech and malformed audio cannot place an order.
5. **`gpt-4o-transcribe`** transcribes that completed recording. Only the entire exact affirmative phrase, allowing punctuation/case differences, permits `submit_voice_order` with the saved nonce. Corrections, negation and other answers invalidate the review and return to clarification. Exact recording retries reuse the same pending result and database idempotency; they do not create a second order. Payment stays unpaid.

The device's playback acknowledgment is trusted within this supervised local demo. This is not speaker authentication or a production consent-verification system. Microphone noise can reject otherwise valid answers; do not bypass the guard. Audio-level speech/quiet detection frames the recording; it is not an invented GPT-Live turn-done event or semantic approval. An audible beep marks when to answer.

Runtime state is held by one local Node process, with a ten-minute session timer and existing database AI budgets. A process restart loses confirmation authority and fails closed; it does not reconstruct or automatically repeat an uncertain action. If a submission result is uncertain, check the kitchen queue before starting a new order. The existing database remains authoritative for saved carts and order receipts. A dedicated managed runtime and real acoustic testing remain prerequisites for independently hosted voice. The temporary supervised relay keeps that runtime on the operator laptop; it does not move live session state into the Sites Worker.

## Supervised hosted relay

The laptop runs Next development on `http://localhost:3000` with `DEMO_MODE=true`. Start the narrow relay using:

```sh
node --env-file=.env.local --conditions=react-server --import tsx scripts/run-voice-relay.ts
```

The relay listens only on `127.0.0.1:3002`. It accepts only `POST /api/v1/live/handsfree` with the machine bearer from `VOICE_BACKEND_TOKEN`; bodies are bounded to 1.4 MB and validated against the voice-command schema. Its only upstream is the fixed local handsfree endpoint, with a fixed local origin and the public dummy-stall sentinel. Other paths, methods, credentials and restaurant scopes are rejected. It neither handles general HTTP proxying nor exposes database credentials.

An operator-controlled Cloudflare Quick Tunnel can expose this relay. Configure the hosted server with `DEMO_MODE=true`, `VOICE_BACKEND_URL` set to the exact HTTPS `*.trycloudflare.com` origin (no path/query/credentials), and the same server-only `VOICE_BACKEND_TOKEN`. The hosted endpoint requires same-origin requests and the demo sentinel, validates the command again, and forwards only to the fixed handsfree path. Redirects are refused. Neither tunnel URL nor machine token is sent to browser code. The local handsfree handler's production gate remains intact.

The laptop, dev server, relay and tunnel must stay running; this is a supervised judge demo with one active voice session at a time, not independent production hosting. A changed Quick Tunnel URL requires updating the hosted server setting. Do not restart the device to retry an uncertain order without checking the kitchen queue.

Validation: mocked provider protocol, complete HTTP/RPC sequence, exact replay, negation/corrections, stale review, wrong restaurant, production gate, cutoff/silence, playback interruption and microphone cleanup. No paid provider or real microphone/speaker test was run during implementation.

Official references: [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation), [Live timing limitations](https://developers.openai.com/api/docs/guides/live-conversations), [speech generation](https://developers.openai.com/api/docs/guides/text-to-speech), [completed file transcription](https://developers.openai.com/api/docs/guides/speech-to-text).

## Hosted connection verification — 13 September 2026

Deployed c8bf859cf88cb419b63624220cc22322e431e132 at https://jiak-simi-business-demo.elsenyong.chatgpt.site/voice-test. The page returns 200 and its same-origin API reaches the authenticated relay (expected 404 for an invented session). workerd rejects `redirect: "error"`; the hosted proxy uses `manual` and explicitly rejects 3xx without following or forwarding credentials. Local Node relay keeps its fixed upstream and redirect rejection. This verifies transport only; a real microphone-to-ticket test still needs the operator device.
