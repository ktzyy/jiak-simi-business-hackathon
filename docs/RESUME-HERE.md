# Current checkpoint — 13 September 2026

Read [FIRST-BACKEND-SYNC.md](FIRST-BACKEND-SYNC.md) for current verified status. Earlier access blockers are resolved. Do not reapply the core migration or create replacement credentials.

- Work on `elsen/backend` in the existing workspace. User explicitly authorized committing and pushing this branch for Kimberley. Public customer proxy fix is pushed as `d632190`. Do not merge Kimberley's UI. Sites registration is explicitly private and unpublished; reuse `.openai/hosting.json` for eventual deployment.
- Supabase target is only `mikpepfrumtglwweolzq`. Core migration creation/application was approved earlier; the separate OCR/voice/Telegram extension was explicitly approved in this task on 13 September. Check migration history and the sync file before any dispatch. New migrations still require the repository's explicit approval.
- User requested a synthetic roast-meat demo stall and dummy staff account based on the tray-menu mockup. No actual merchant identity or complete photo extraction approval is implied.
- User chose Telegram and supplied the bot credential, now saved only in ignored `.env.local`; bot identity was verified. User sent `/start` to bind their private chat. Consult messaging runbook and local runner state before starting another polling process.
- Voice stays with Elsen. Laptop microphone/speaker is the selected hardware. Staff-reviewed ordering is implemented; real audio verification and production session lifetime enforcement remain separate gates.
- Kimberley owns frontend screens. Done/counts, explicit dine-in/takeaway and required versioned hours are implemented and the approved web migration `20260913053454` is applied. The real S$14.00 HTTP joint test passed with same-key order and Done replay. Follow `KIMBERLEY-UI-CONTRACTS.md`; product UI integration remains pending. Photo enhancement and page import can wait.
- User approved the demo menu extras: egg S$1, char siew S$2, shao rou S$2; free chilli/no chilli. User reviewed dummy hours of 09:00–18:00 every day in Singapore. Check publication state before applying the versioned demo update; do not overwrite subsequent menu edits or re-run the original seed script.
- OpenAI credential use was already authorized. Photos remain in the user's Downloads/Hawker Photos directory; verified results are under ignored `artifacts/ocr-review/`. Original images are unchanged.
- Stale temporary checkout `/private/tmp/jiak-simi-first-sync-20260913` must not be pushed. The user now requests the actual `elsen/backend` branch.
