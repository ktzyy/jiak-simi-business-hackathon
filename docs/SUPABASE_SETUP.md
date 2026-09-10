# Supabase setup

The separate hackathon project exists in the Singapore region. Kimberley's local app has been connected using only the project URL and publishable key in `.env.local`. The connection has been verified, but no schema, data, Auth settings, Storage buckets, functions or migrations have been created or changed.

## Connecting another development machine

1. Open the Singapore hackathon project in the Supabase Dashboard. Do not select the Jiak Simi production project.
2. In the project's Connect dialog, obtain only:
   - Project URL
   - Publishable key
3. Copy `.env.example` to `.env.local` and add those two values locally. `.env.local` is ignored by Git.

Never put a secret key, legacy service-role key, database password, or personal access token in a `NEXT_PUBLIC_` variable. Anything prefixed with `NEXT_PUBLIC_` is included in browser code.

## Agreed hackathon data boundary

The product-level contract is in [PRODUCT_CONTRACT.md](PRODUCT_CONTRACT.md). The first database schema must be reviewed against it before any migration is created.

- Restaurant membership determines staff access. Never authorize from user-editable profile metadata.
- Public QR visitors may read only explicitly published restaurant and menu data.
- Guest orders go through a validated server endpoint; they do not receive broad anonymous database write access.
- The server recalculates authoritative prices and totals from available menu items.
- Hackathon content is synthetic and contains no production customer data.

Every table exposed through the Data API needs explicit least-privilege grants and Row Level Security. New Supabase projects may not expose new tables automatically, so required grants and RLS policies belong in the same reviewed migration.

## Integration with the B2C demo

For the hackathon, both interfaces may point to this same non-production Supabase project:

- The business portal writes restaurant-owned menu, availability and offer data.
- The B2C demo reads only the approved published restaurant data.
- Demand shared back to restaurants should be aggregated and non-identifying.

This produces the cross-product demo without risking production data.

## Database change workflow

The designated database owner is Kimberley's husband. After both owners approve the product contract:

1. Create every schema change as a migration in Git; do not make ad-hoc remote Table Editor changes.
2. Keep explicit grants, RLS enablement and policies together with the table migration.
3. Add allow-and-deny tests covering anonymous visitors, authenticated restaurant members and cross-restaurant isolation.
4. Run the database tests and Supabase security advisors.
5. Have one person review and apply migrations to the hackathon project.

Nothing from the hackathon project may be applied to production without a separate review, backup plan and explicit approval.
