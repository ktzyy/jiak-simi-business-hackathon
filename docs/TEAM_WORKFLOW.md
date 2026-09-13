# Hackathon team workflow

## Ownership and branches

| Owner | Lane |
| --- | --- |
| Kimberley | All four UI surfaces: photograph upload/review, branded storefront/QR, customer cart and kitchen display; design, synthetic demo content, pitch/video and frontend QA. |
| Elsen | API/server code, AI extraction and interpretation, deterministic validation, shared contracts/client/fixtures, dependencies/configuration, integration and deployment; database design and separately approved migrations. |

PR #1's original ownership assigned kitchen display and demo payment to the backend lane. The approved handoff places kitchen UI with Kimberley and removes payment confirmation; this candidate workflow follows that handoff. PR #1 has been reviewed, not approved or merged by this work.

The local engineering branch is `elsen/backend`; earlier repository instructions used `husband/ai-butler`. Kimberley's existing PR uses `kim/front-of-house`. Coordinate the branch names at handoff; do not rename, overwrite or assume another session moved branches. This repository is the business portal; do not copy the B2C mobile application into it.

## Shared-file and integration rules


Kimberley is the sole UI writer for application screens, components and public assets. Elsen owns API routes, server logic, shared types, tests, root configuration and dependency/lockfile changes. Use npm and commit `package-lock.json`; pin security-sensitive dependencies exactly. Read the installed Next.js guides required by [AGENTS.md](../AGENTS.md) before implementation.

Use [PRODUCT_CONTRACT.md](PRODUCT_CONTRACT.md) and [engineering-handoff.md](engineering-handoff.md) to distinguish candidate shapes from implemented behavior. Review contract changes together before integrating; never present fixtures as persisted orders or an aspirational client method as a working endpoint. Integrate small, reviewable changes and preserve the full photograph-to-kitchen path.

Elsen is the designated integrator and database/deployment owner. Ownership is not approval to migrate or change production. [AGENTS.md](../AGENTS.md) explicitly requires approval before adding or running migrations. After that approval, keep schema, grants, RLS and isolation tests together; apply only to the confirmed hackathon project through the reviewed workflow in [SUPABASE_SETUP.md](SUPABASE_SETUP.md).

Never commit `.env.local`, credentials, customer chats or production data. Do not deploy, publish, merge or send messages merely because a design document describes those actions. Runtime verification and external setup status belong in the engineering handoff.
