# Engineering handoff — 13 September 2026

The current integration status and exact database/demo identifiers are in [FIRST-BACKEND-SYNC.md](FIRST-BACKEND-SYNC.md). This replaces earlier connection-blocker and conversation-only implementation notes.

Kimberley owns the frontend screens; Elsen owns API/server, shared contracts/client, OCR, Telegram, voice, Supabase and integration. Voice ownership stays with Elsen. See [KIMBERLEY-UI-CONTRACTS.md](KIMBERLEY-UI-CONTRACTS.md) for assigned UI files and the distinction between supported endpoints and proposed Done/Next, service type and opening-hours extensions.

The OCR guide is [OCR-FRONTEND-INTEGRATION.md](OCR-FRONTEND-INTEGRATION.md). Telegram uses [MESSAGING-INTEGRATION.md](MESSAGING-INTEGRATION.md); laptop voice uses [butler-channels.md](butler-channels.md). Photo enhancement and external-page import are deferred.

All local environment credentials and raw photo/chat artifacts stay ignored. Use the shared HTTP client, verified staff JWTs and restaurant-bound guest sessions. Never infer successful placement from model speech: display only persisted unpaid tickets and preserve confirmation identities across uncertain responses.
