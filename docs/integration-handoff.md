# Elsen → Kimberley integration handoff

Status: starter inspected at fbc7c52; awaiting the frozen API contract/client/fixtures. This is a checklist of required deliverables, not a second backend specification. See repository-alignment.md for differences between the initial product document and the approved build brief.

## Minimum return packet

1. Repository URL, base commit and kim/ui branch starting point; package manager and exact development/build commands.
2. Shared Zod exports and typed API client location. Include request, response and error fixtures for each endpoint, with no production credentials.
3. Workspace creation/resume behavior; merchant/kitchen capability handling; public customer URL shape; which routes require which access. Never put merchant capabilities in customer QR links.
4. Exact draft, published menu, intent, cart and ticket wire fields; identifier ownership; menu-version conflict behavior; modifier-group cardinality/conflict rules; allowed quantity range.
5. A real merchant-approved baseline menu or explicitly labelled development fixture. Document expected total and expected ticket independently from the implementation. Missing source information must remain unresolved until approved.
6. Upload constraints and accepted image formats; route/body size cap; extraction loading/error behavior. Clarify any device-camera file conversion without assuming HEIC works.
7. Quote/submission flow; idempotency-key lifetime; handling of a lost acknowledgement and duplicate/concurrent retry; stale-menu response and re-review requirement.
8. Kitchen polling response, ordering and refresh behavior; public deployment URL and health/smoke-test result once ready.

## Integration rules

- Kimberley imports shared contracts/client. Do not hand-copy JSON types into screens.
- Quotes are invalidated when quantities/options/menu version change. No order placement from an old quote.
- The server validates all constraints and recomputes prices on placement. Client checks improve UX only.
- Parsing returns actionable clarification issues. The frontend never guesses an omitted item or option.
- A network timeout after placement is an unknown outcome, not evidence that the order failed. Resolve using the same idempotency key.
- Every response fixture must identify whether it is mock/development or real approved source data.
- Freeze v1 before UI implementation. Announce and log any subsequent contract change in docs/build-plan.md; send a new fixture and commit reference together.

## Integration checkpoints

1. Shared client compiles and UI renders success/error fixtures.
2. UI reads published menu from deployed backend.
3. Server quote matches independently checked baseline.
4. Placement persists one ticket; second device displays it.
5. Real extraction/review publishes a menu used by the same order flow.
6. Both builders verify the public deployed revision and exact Git commit before recording.
