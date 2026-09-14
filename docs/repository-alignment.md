# Repository alignment — engineering handoff required

Inspected repository: https://github.com/ktzyy/jiak-simi-business-hackathon . Base commit: `fbc7c52de4638732deff65c9c24ba6422f7bb751`. All fetched branches (`main`, `kim/front-of-house`, `husband/ai-butler`) point to that scaffold commit.

The approved build brief and the existing repository documents differ. This file records the decisions needed by the shared-contract owner; it does not modify PRODUCT_CONTRACT.md, TEAM_WORKFLOW.md, shared types, dependencies or configuration.

| Area | Repository today | Approved build brief / proposed reconciliation |
|---|---|---|
| Framework | Next.js 16.3.4 with src/app/; initial marketing/demand placeholder | Preserve starter. Kimberley's route boundary is src/app/ excluding src/app/api/; components may live under src/components/. Replace placeholder when API handoff is ready |
| Database | Supabase dependencies/helpers; separate hackathon project documented | Kimberley confirmed Supabase is already set up. Reuse the existing hackathon Supabase project; do not provision a second database. Elsen owns schema, permissions and integration. |
| Hosting | Conventional Next.js; no registered Site manifest in fetched tree | Sites first remains confirmed; Elsen owns compatibility/provisioning and Vercel fallback |
| Branches | kim/front-of-house and husband/ai-butler already exist | Use existing named lanes instead of creating duplicate kim/ui and elsen/backend branches |
| Kitchen UI | TEAM_WORKFLOW assigns kitchen display to husband | Approved plan assigns UI to Kimberley, backend to Elsen. Confirm transfer in shared workflow before either edits kitchen UI |
| Payment | Contract includes received → paid → preparing → ready and demo payment confirmation | Approved MVP remains received/unpaid and pay at stall. No paid control or state transition is implemented by Kimberley; Elsen must reconcile the state model |
| Modifiers | Flat Modifier permits approved free-text with null ID | Approved plan requires validated options and conflicts/cardinality. Define the approval boundary; never pass an unsupported free-text request directly to kitchen as approved |
| Version/idempotency | Missing from object tables | Supply versioned-menu, quote and idempotent submission semantics and exact wire fields before integration |
| Shared API | Product document exists; no handlers, typed client, Zod schemas or response fixtures | Elsen returns the concrete contract/client/fixtures; Kimberley does not invent endpoints or duplicate types |
| Existing feature scope | Demand dashboard/offers/discovery placeholder | Photo → approved menu → order → kitchen is the protected workflow; no offer/demand/ratings feature work |

## Copy-paste update for Elsen

“Kimberley's task cloned the starter at fbc7c52 and prepared the UI spec, verified Figma tokens, 90-second script and QA checklist. Before frontend coding, please return the typed API client and success/error fixtures, and reconcile PRODUCT_CONTRACT/TEAM_WORKFLOW with the approved unpaid-order flow, versioning/idempotency and kitchen UI ownership. Supabase is confirmed by Kimberley; use the existing hackathon setup. There is no database-provider decision pending. Sites first remains confirmed. Existing kim/front-of-house and husband/ai-butler lanes are preserved. No backend, dependency, payment or database changes were made by this task.”

## Readiness gate

Documentation and brand reference are ready. Application implementation/integration is waiting on the concrete engineering contract described above and a real menu photograph. The handoff documentation does not establish that live AI, database, public hosting or payment behavior works.
