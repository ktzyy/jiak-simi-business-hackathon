# Jiak Simi Business — start here

This pack executes the independent preparation work approved by Kimberley. It is not the application repository. The existing repository has been cloned and inspected at https://github.com/ktzyy/jiak-simi-business-hackathon, base commit `fbc7c52de4638732deff65c9c24ba6422f7bb751`. This task has not created a Site, backend or database.

## Send to Elsen

1. Send `ELSEN-HANDOFF.md`, `docs/build-plan.md` and the original menu photograph together. The handoff prompt is self-contained and references the rest of the pack.
2. Give Elsen access to the Figma source: https://www.figma.com/design/ItlJWuBatnVMXGkrIjocfw/Jiak-Simi-Beta?node-id=0-1
3. Ask him to return the frozen shared contract/API client and fixture responses listed in `docs/integration-handoff.md`. Read `docs/repository-alignment.md` for the concrete differences between the starter and the approved build plan.
4. This pack's documentation is copied into the existing repository on Kimberley's lane for review. Elsen should reconcile the shared contract before merging. Do not initialize a second Site from Kimberley's session.

## Kimberley's work

- **K1 Product/UI:** `docs/ui-spec.md` and `design-tokens.json` are ready for frontend implementation after Elsen's handoff. `design-tokens.json` is a reference data file, not installed application configuration.
- **K2 Pitch/video:** `docs/demo-video.md` contains the recording script and export checklist. It is not a recorded or published video.
- **K3 QA:** `docs/qa-checklist.md` contains the acceptance matrix. Tests remain unrun until an app exists.
- **Session prompts:** Use `docs/session-prompts.md`; run only one frontend writer.

## Current dependencies

- Elsen's Next.js starter is available. All three remote branches currently share the initial scaffold commit. The repository has a product-shape document but no API handlers, shared typed client or response fixtures.
- The original menu photographs have not been attached to this task. No dish, price or modifier is claimed to be verified.
- The existing Supabase setup is confirmed by Kimberley. Runtime API/model access, public Sites hosting, Vercel fallback and live database permissions have not been verified by this task.
- The user supplied the GitHub repository. No live deployment, recorded video or submission has been produced or verified by this task.

## Confirmed decisions

- Sites first; Elsen is the only setup/integration/deployment owner.
- Reuse the verified Jiak Simi design tokens; enlarge operational typography and controls.
- Custom illustrations are excluded. Typed ordering is protected; speech is optional.

## Next concrete action

Send the handoff pack to Elsen and attach one legible menu photograph. Continue pitch rehearsal and product review while he reconciles the shared contract and supplies the API client/fixtures. Frontend coding begins from that agreed engineering handoff.
