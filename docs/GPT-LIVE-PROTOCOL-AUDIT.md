# GPT-Live protocol audit — 13 September 2026

The exact `gpt-live-1` provider accepted a bounded synthetic-audio smoke test. The first test was a real OpenAI primary WebSocket session, with no database access, order submission or customer recording. It does **not** prove the browser WebRTC, sideband attachment, quote, playback or kitchen integration works end to end.

## Observed provider result

A local macOS speech fixture said “One char siew rice please.” PCM16 mono audio at 24 kHz was paced in 100 ms packets with a quiet tail. The session used client delegation and a small fixed test menu.

- Model returned: `gpt-live-1`.
- Five input transcript deltas reconstructed “One Char Siew Rice, please”.
- One `session.delegation.created` event, with `id`, `type` and `target` metadata.
- Matching acknowledgments received for input mute, input unmute and `session.instructions.append`.
- Two assistant transcript deltas and 112 output audio packets received.
- No provider errors. `session.closed` confirmed finalization after 17.2 seconds overall.

Temporary script and synthetic fixtures are in `/private/tmp/jiak-live-protocol-smoke.cjs` and `/private/tmp/jiak-live-smoke.wav`. They contain no credentials. The script loads the already-authorized key through the ignored environment file. They are diagnostic artifacts, not an application test suite.

## Protocol conclusions

Input mute and unmute require their matching `client_event_id` acknowledgments; timeout is a failure, not acceptance. Mute does not stop generated speech. Application playback remains separately controlled. [Session controls](https://developers.openai.com/api/docs/guides/live-conversations)

A sideband attaches to an existing WebRTC/SIP session using the opaque session ID. It automatically receives subsequent events; the reference defines no subscription command. Do not send `session.start` on attachment or expect transcript replay. Attach before the browser begins media. Browser data-channel event permissions are separate from trusted server control. [Server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live), [sideband API](https://developers.openai.com/api/reference/resources/live/sideband-websocket)

Input transcript fragments have no authoritative turn-complete event. Client delegation contains metadata, not the user task. Quiet transcript periods may trigger a reversible draft; they never prove order consent. Context appends require a known delegation ID or null. Their acknowledgments do not establish completed spoken readback. [Delegation guide](https://developers.openai.com/api/docs/guides/live-delegation)

## Local corrections and remaining evidence

The controller now waits up to five seconds for the matching mute/unmute acknowledgment. Wrong and late acknowledgments cannot unlock preparation. Failure status contains only an application error code and stage; logs exclude transcript, provider messages, session IDs and credentials. A known transcription 502/504 before submission can replay the same quote with a fresh readback ID; an uncertain submission result fails closed.

Eleven controller/audio tests cover completed confirmation, exact retries, stale quotes, wrong/missing/late acknowledgments, recoverable pre-submit transcription failure and unknown submission outcomes. Lint and TypeScript checking pass. These mocked application tests are distinct from the real provider smoke above.

Still required: actual WebRTC attachment with negotiated media, followed by server quote, finite readback, completed spoken confirmation and visible persisted unpaid ticket. A successful primary WebSocket smoke only narrows the investigation; it does not validate that full path.


## Actual WebRTC and sideband follow-up

A second real provider test used a temporary `werift` installation outside the repository, PCMU RTP carrying the same local synthetic utterance, and the application's exact restricted data-channel event allowlist. Session creation returned 201. The server sideband attached **before** the WebRTC answer was applied, matching the application startup order. ICE progressed from connecting to connected.

The sideband received session.started, matching input mute/unmute acknowledgments, instructions.append acknowledgment, reflected input/output audio, five user transcript deltas, one client delegation, assistant transcripts and terminal session.closed. The data channel independently received the same five user transcript deltas. The reconstructed utterance was “One Char Siew Rice, please”. There were no provider errors; total elapsed time was 22.1 seconds.

This directly verifies WebRTC media, early sideband attachment, automatic transcript events and client delegation. It still does not verify browser permission/autoplay, the real application controller, database quotes, finite readback, confirmation capture or final placement. No database or order endpoint was called. Temporary reproduction: `/private/tmp/jiak-webrtc-probe/probe.cjs`.

## Long-menu context correction

The provider's documented startup instruction limit is **16,384 client-supplied tokens**, not the application's old 24,000-character gate. The conversation menu now omits backend UUIDs and references deduplicated modifier-group display rules. Names, availability, dollar prices, spoken prices and selection bounds remain. Handsfree builds its own prompt directly. The full ten-dish/twelve-extra demo context is now 4,490 characters; tests also cover 100 dishes and ensure price differences prevent incorrect group deduplication. [Create-session reference](https://developers.openai.com/api/reference/resources/live/methods/create)

The new 100,000-character application bound is only a payload bound; it is not a tokenizer estimate or a promise that pathological menus with thousands of distinct options fit the provider context. The provider separately enforces its token budget. No published menu data changed.


## Reproduced application failure and verified fix

Joining real WebRTC media to the actual local application reproduced the customer failure twice. GPT-Live correctly transcribed the utterance, but the app moved from collecting to error with `VOICE_MUTE_FAILED` before any quote preparation. The safe diagnostic located a TypeError in `ws/lib/buffer-util.js` while masking an outgoing WebSocket frame.

Next's bundle treated the missing optional `bufferutil` module as an empty module, so the WebSocket library attempted to call its absent `mask` function. Native Node loading correctly treats that dependency as unavailable and uses `ws`'s JavaScript fallback. `next.config.ts` now declares `serverExternalPackages: ["ws"]`, using Next's documented native-module loading mechanism. Temporary exception-stack diagnostics were removed after identifying the fault.

After Next restarted with that setting, the actual app test succeeded: collecting → preparing → readback. The real server quote was one Char Siew Rice with Chilli, dine-in, S$4.50. No errors occurred. The quote-only test finished in 26.1 seconds. Reproduction harness: `/private/tmp/jiak-webrtc-probe/app-probe.cjs`; it uses the same fixed dummy-stall endpoint and public demo capability as the app, with no injected provider or controller hooks.

## Complete actual-app synthetic order test

The follow-up joined run completed real GPT-Live WebRTC, the actual server sideband/controller, real database quote, 13-second finite TTS, completed-file transcription of a locally generated “Confirm”, and actual submission. It saved one unpaid `voice` ticket, `25028f86-b317-40a2-9695-a2f55e9e359c`, for one Char Siew Rice with Chilli, dine-in, S$4.50. Replaying the identical confirmation command returned the same ticket. No provider or application errors occurred; the run took 48.7 seconds and closed its session.

This harness simulated the customer audio and playback acknowledgment, waiting the measured readback duration before the acknowledgment. It did not capture a human microphone or prove browser autoplay behavior. It did call the actual app endpoint and all real provider/database components, with no mocked transport or business hooks. Exactly one ticket was submitted in this joined test.
