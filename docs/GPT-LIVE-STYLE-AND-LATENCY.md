# GPT Live voice refinement — 13 September 2026

The hands-free flow continues to use `gpt-live-1`. Its prompt now asks for brisk Singaporean English with light Singlish, short turns and no repeated upselling. The separate exact quote voice uses `gpt-4o-mini-tts`, coral, Singaporean English instructions and speed 1.12. Accent is a style request, not a guaranteed native accent.

Voice-only dining aliases include dabao, da bao, tapao and bungkus (takeaway), and having here / makan here (dine-in). Negations and conflicting modes remain unresolved. Bare “packet” is not treated as dining mode. Web orders still require an explicit choice.

Canonical readback retains all quantities, dishes, selected options, dining mode, total, payment due and one confirmation prompt. It accepts completed “can confirm” and “confirm lah” recordings as well as existing explicit confirmations; edits, negations and bare “can” remain rejected. Microphone acknowledgment, completed audio, fresh database reviews and nonce replay protection remain required.

Identical finite readback audio is cached locally for five minutes, at most 32 entries / 8 MB, keyed by exact text, voice settings and credential hash. Cache entries contain audio only; every caller still authorizes, saves a current quote and consumes its voice budget. Changed text or credentials cannot reuse the wrong audio. The page consumes the confirmation response immediately instead of polling for the ticket again. Simple menu questions remain conversational rather than unnecessarily muting the microphone and starting a quote.

## Verification

44 focused voice tests, TypeScript and scoped lint passed before publishing. The public Site protocol probe at 12:23 UTC used synthetic speech and waited the full finite readback, then submitted and replayed the same synthetic confirmation. One Char Siew Rice with chilli, dine-in, S$4.50 produced ticket 041ebc95-676f-433c-b20d-55c1fc3859fb exactly once, unpaid, visible in the kitchen. Readback was 9.10 seconds versus 11.6 seconds in the previous probe; the confirmation request took 1.39 seconds. Whole probe including connection, synthetic pauses, replay and close took 33.78 seconds, so this does not establish a large overall latency reduction. Browser microphone permissions, autoplay and perceived accent still need human listening.

The Site continues to use the approved protected laptop relay. Keep the laptop, Next runtime, relay and replacement tunnel running. Telegram draft work is separate and requires its pending database migration approval.

## Provider guidance

- [GPT Live prompting](https://developers.openai.com/api/docs/guides/live-prompting): concise personality, backchannel and delegation policies; voice choice cannot guarantee regional accent.
- [Speech generation API](https://developers.openai.com/api/reference/cli/resources/audio/subresources/speech/methods/create): instructions, voice and speed controls.
