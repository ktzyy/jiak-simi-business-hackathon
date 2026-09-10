# Hackathon team workflow

## Ownership

### Kimberley — `kim/front-of-house`

- Photograph-menu onboarding and generated-menu review
- Brand colours and storefront customization
- Customer QR menu and ordering screens
- Synthetic demo restaurant content
- End-to-end testing and the judging/pitch flow

### Husband — `husband/ai-butler`

- Menu-photo extraction and voice-order interpretation
- Order validation, totals, modifiers and state changes
- Demo payment confirmation and kitchen display
- Supabase migrations, database tests and deployment
- Shared types, dependency changes and configuration

Kimberley's husband is the designated merge, database and deployment owner. This is an ownership convention, not permission to change production.

## Shared-file rule

Only the designated owner edits migrations, shared types, dependencies, lockfiles and configuration. If the other branch needs one of these changed, request it in a small pull request or issue instead of editing it independently.

Both branches use the shapes and state machine in [PRODUCT_CONTRACT.md](PRODUCT_CONTRACT.md). Update the contract first when a shared assumption changes.

## Everyday Git rhythm

1. Work only on your named branch.
2. Make small working commits and push regularly.
3. Open a focused pull request when one coherent piece works.
4. The designated integrator reviews and merges into `main`.
5. Update from `main` before starting the next piece; Git is configured to refuse accidental merge-style pulls.

Never commit `.env.local`, credentials, production data or generated build output. Never deploy, migrate, publish or modify production as part of the hackathon workflow.
