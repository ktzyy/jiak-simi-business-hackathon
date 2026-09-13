# Kimberley: working GPT Live integration handoff

Prepared 13 September 2026. Elsen's Site has been withdrawn from public access at the user's request; deploy Kimberley's replacement Site. No database, menu, voice runtime or Telegram service was removed.

## Source to integrate

Repository: `ktzyy/jiak-simi-business-hackathon`, branch `elsen/backend`.

Working application revision: **`5b945ab5f718109b28ec65db67fc664c61059d01`**.

- `ced1554a541d9bf2aae47f99093b200f66341760`: faster readback, short Singapore English conversation, immediate receipt display, bounded speech cache, menu-question handling and voice-only dining aliases.
- `5b945ab5f718109b28ec65db67fc664c61059d01`: explicitly selects `marin` for BOTH Live conversation and finite TTS; shared regional style through readback and final acknowledgement.
- This branch already integrates Kim's `8aad6341817a1e9d468f1f8c7047adc29f041883` UI polish, plus earlier backend fixes. The two voice commits depend on the existing hands-free implementation: do not apply just the final styling commit to an older incompatible voice flow.

Preserve Kimberley's own `.openai/hosting.json` project ID and Site origin during integration. **Do not deploy or republish Elsen's owner-only Site** (`appgprj_6aa6330ed72c819186a4fff3288b4caf`). A later handoff-only commit may follow this application revision.

## Architecture that actually worked

```text
Browser /voice-test
  ├─ WebRTC microphone/speaker ↔ OpenAI gpt-live-1
  └─ same-origin POST /api/v1/live/handsfree
        → Sites Worker proxy, machine token added server-side
        → protected Cloudflare tunnel
        → laptop relay 127.0.0.1:3002
        → local Next app localhost:3000
             ├─ GPT Live sideband controller (ws)
             ├─ exact quote speech: gpt-4o-mini-tts / marin
             ├─ completed confirmation audio: gpt-4o-transcribe
             └─ staging Supabase: review → nonce → unpaid ticket
```

The stateful voice controller currently runs in the **supervised local Next development runtime**, not inside the stateless Sites Worker. The production route deliberately proxies; directly invoking `handsfreeHandler` in production returns `NOT_CONFIGURED`. Copying the page alone is insufficient. Keep Elsen's laptop awake and its three processes alive; coordinate before restarting them because active in-memory sessions are lost.

Current relay origin: **`https://incentives-sunday-pumps-int.trycloudflare.com`**. The old `surely-hello-foam-channels` tunnel was deleted and caused HTTP 530 / non-JSON errors. Quick Tunnel addresses are temporary; check the current endpoint before deployment.

Current health at handoff: authenticated **local** relay status lookup for a nonexistent session returned `404 VOICE_SESSION_NOT_FOUND`; unauthenticated tunnel returned `401 UNAUTHORIZED`. An authenticated external recheck was blocked by automatic approval review, so these checks do not establish a fresh authenticated end-to-end connection from Kimberley's Site. Earlier full hosted checks succeeded as described below.

## Runtime configuration

Use staging Supabase only: `mikpepfrumtglwweolzq`.

Kimberley's Site needs:

- `DEMO_MODE=true` for the scoped public dummy demo.
- `NEXT_PUBLIC_SITE_URL` and `APP_ORIGIN` set to **Kimberley's exact HTTPS Site origin**, not Elsen's or localhost.
- `NEXT_PUBLIC_SUPABASE_URL` and publishable key for the staging project.
- Server-only `VOICE_BACKEND_URL` set to the current relay origin and `VOICE_BACKEND_TOKEN` matching the laptop relay.
- Existing server-side Supabase credentials for the web backend; never put privileged keys in browser code.

The approved secrets are in Elsen's ignored `/Users/elsenyong/Documents/ChatGPT/Hackathon/.env.local`. No credential values are included here. Configure secrets through an authorized local environment or the Site's secret settings; do not paste them into chat, commit them, or prefix them with `NEXT_PUBLIC_`. A different machine must obtain them through an authorized secure route.

The laptop app keeps `APP_ORIGIN=http://localhost:3000`, `DEMO_MODE=true`, its existing dummy staff configuration, OpenAI key and staging Supabase server credentials. The relay sets the local Origin and public dummy identity; it does not forward a browser's arbitrary destination or staff token.

Existing launcher components, for recovery only (do not launch duplicates):

```sh
npm run dev -- --webpack
node --env-file=.env.local --conditions=react-server --import tsx scripts/run-voice-relay.ts
caffeinate -i cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3002 --protocol http2
```

The last command creates a NEW address. Prefer the already-running tunnel. If replacing it, update the Site's server configuration and redeploy. Configure staging Supabase Site URL and `/auth/confirm` allow-list for Kimberley's origin as part of her Auth deployment.

## Files and contracts to keep together

| Responsibility | Source |
| --- | --- |
| Browser UI, immediate returned ticket | `src/app/voice-test/handsfree-voice-test.tsx` |
| WebRTC, finite playback, PCM WAV confirmation capture | `src/shared/live-client.ts` |
| Production/local routing | `src/app/api/v1/live/handsfree/route.ts` |
| Worker-safe relay and diagnostics | `src/server/ai/live-relay-proxy.ts` |
| Strict action schemas, body limits, tunnel URL restriction | `src/server/ai/live-handsfree-contract.ts` |
| Local authentication, fresh menu/quote, DB operations | `src/server/ai/live-handsfree.ts` |
| Server-owned phases, matching microphone ACK, confirmation | `src/server/ai/live-butler.ts` |
| Exact GPT Live session API and compact menu context | `src/server/ai/live-session.ts` |
| Matching `marin` voice and Singaporean style | `src/server/ai/live-voice-style.ts` |
| Canonical readback, TTS, completed-audio transcription | `src/server/ai/live-confirmation-audio.ts` |
| Five-minute audio-only cache, 32 entries / 8 MB | `src/server/ai/live-speech-cache.ts` |
| Whole menu questions stay conversational | `src/shared/live-conversation.ts` |
| Protected laptop relay | `scripts/run-voice-relay.ts` |

Also retain their shared contracts, API client, quote/parser, public-demo and Supabase helpers. **Keep `serverExternalPackages: ["ws"]` in `next.config.ts`**: bundling optional `bufferutil` handling previously broke sideband sends. Use the existing `npm run build:sites` Worker build and pinned dependencies. Do not substitute Realtime API event names for GPT Live's API.

All device commands are JSON POSTs to the same-origin `/api/v1/live/handsfree`. In public dummy mode the browser sends `Authorization: Bearer jiak-public-dummy-demo` (a deliberately public sentinel, NOT the machine credential). The server independently restricts the restaurant.

1. `start`: `{ action, restaurantId, sdp }`; use `connectLiveAudio` for the SDP exchange. Preserve the opaque provider `sessionId`; use the distinct database `voiceSessionId` for subsequent app commands.
2. `status`: `{ action, voiceSessionId }`; render the canonical `quote` when supplied, and the real `ticket` on submission.
3. `draft`: `{ action, voiceSessionId, text }`; reversible transcript fallback only, never confirmation.
4. `audio`: `{ action, voiceSessionId, readbackId }`; returns base64 finite WAV. Play the entire audio using the existing helper.
5. `playback`: `{ action, voiceSessionId, readbackId }`; acknowledge only after playback ends, then record the customer's fresh answer after the beep.
6. `confirm`: `{ action, voiceSessionId, readbackId, audio }`; audio is the helper's complete PCM16 WAV encoded as base64, not WebM/Opus from a generic MediaRecorder. Consume its returned status/ticket immediately.
7. `close`: `{ action, voiceSessionId }`; releases the session.

On an uncertain confirmation transport response, resend the **same readbackId and identical recording**. Never create a new order/key as a retry. The controller requires the matching mute/unmute acknowledgment, complete playback and a new completed recording with a quiet tail. Do not submit from Live transcript deltas, a partial “yes”, or model-generated claims of success.

Spoken confirmations include “confirm”, “yes”, “can confirm” and “confirm lah”. Negation, edits and bare “can” are not consent. Defaults are **voice-only**: dine-in and chilli unless the customer says otherwise. Dabao / da bao / tapao / bungkus mean takeaway. Web orders still require an explicit dining choice. All persisted tickets remain **unpaid**.

## Demo data and acceptance test

Restaurant: `ba2ad996-da84-4653-89a9-c028d77c050d`.
Known menu at last successful voice check: Char Siew Rice S$4.50, Braised Pork Knuckle Rice S$5, Braised Pork Knuckle Noodles S$5, with shared extras. Read the current published menu; never hardcode an assumed menu version or regenerate its IDs.

At 12:38–12:39 UTC, the actual hosted WebRTC + relay + provider + staging DB flow passed with synthetic speech and a simulated playback acknowledgment that waited the entire audio. It created ticket `9521e3c9-371d-4cd0-b0d4-003e5adcf8af`: one Char Siew Rice, chilli, dine-in, S$4.50, source `voice`, unpaid. Same-recording replay returned the same ticket; kitchen query found exactly one copy. Readback lasted 7.94 seconds. This did not establish a human's perceived accent or browser microphone/autoplay behavior.

45 focused voice tests, TypeScript, scoped lint and Worker build passed for `5b945ab`. The preceding release passed all 242 tests. Re-run the full suite after integration; do not report the older full-suite count as validation of new Kim changes.

First test on **Kimberley's deployed origin**:

1. Allow the microphone and speaker, start a fresh device session, say “One Char Siew Rice”.
2. Confirm that S$4.50, dine-in and chilli appear in the page's draft.
3. Hear the complete summary, then say “Confirm” after the beep.
4. Verify the actual ticket appears both on the page and in Cook Mode, unpaid; exact-key replay must not duplicate it.
5. Test “One Char Siew Rice, add egg, no chilli, dabao” and verify S$5.50 / takeaway / correct extras before confirming.
6. Test a correction or “no” after readback: no new ticket. Stop/start after deployment; an existing Live session cannot change its startup voice.

## Fast diagnosis

- Site 401 on the old Elsen URL is now intentional: owner-only. Do not use it as Kimberley's backend or restore public access.
- New Site 503 `VOICE_RELAY_UNAVAILABLE`: check demo flag, exact HTTPS tunnel origin and server token configuration.
- Relay 401: machine token missing/mismatched. Never send it from browser code.
- HTTP 530 / `VOICE_RELAY_CONTENT_TYPE_ERROR`: tunnel has disappeared or upstream is not JSON. Check tunnel logs and local app before changing model prompts.
- `VOICE_SESSION_NOT_FOUND` after a laptop restart: start a new session; check kitchen for an earlier ticket before repeating a real order.
- `VOICE_CONTROL_TIMEOUT`: check sideband socket and matching event IDs; retain external `ws` handling. Do not bypass the acknowledgment.
- Generic “could not confirm this step”: inspect structured Worker diagnostics (`stage`, `upstreamStatus`, `upstreamType`) and local `voice_butler` codes. Do not log credentials or customer recordings.
- Accent changes at readback: ensure both session audio output and TTS use `HAWKER_VOICE`, and both include `HAWKER_VOICE_STYLE`. The two models may still sound somewhat different; test with human listening.

## Boundaries

The staging core/channel/web/photo migrations were already applied. No new migration is needed for these voice fixes. A separate **uncommitted Telegram conversation draft extension** exists in Elsen's working tree and still awaits explicit migration approval; do not copy the dirty tree or restart the Telegram runner with that draft code. Integrate the committed branch. Preserve Kim's UI, her Site identity, existing RLS and dummy-stall scope. Real payments remain out of scope.

Related: `docs/GPT-LIVE-STYLE-AND-LATENCY.md`, `docs/GPT-LIVE-PROTOCOL-AUDIT.md` (historical chronology; later evidence supersedes earlier open questions), and the focused `tests/live-*.test.ts` / `tests/voice-*.test.ts` suites.
