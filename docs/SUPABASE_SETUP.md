# Supabase setup

The approved Singapore hackathon project is `mikpepfrumtglwweolzq`. The local ignored `.env.local` is connected to this project with its URL and modern publishable key. The Supabase project is active and healthy; its public Auth settings confirm that email/password login and signup are enabled and email confirmation is required. The server-only backend key remains a separate optional configuration and is never used by browser Auth.

## Connecting another development machine

1. Open the Singapore hackathon project in the Supabase Dashboard. Do not select the Jiak Simi production project.
2. In the project's Connect dialog, obtain only:
   - Project URL
   - Publishable key
3. Add those two values to the existing ignored `.env.local` without overwriting its OpenAI key. `.env.example` supplies the approved project URL. Auth requires the modern `sb_publishable_` key and rejects another project or a server secret.
4. Set `NEXT_PUBLIC_SITE_URL` to `http://localhost:3000` locally and to the staging deployment origin when deployed.

Never put a secret key, legacy service-role key, database password, or personal access token in a `NEXT_PUBLIC_` variable. Anything prefixed with `NEXT_PUBLIC_` is included in browser code.

## Auth configuration

The portal uses Supabase email/password Auth. In the hackathon project's **Authentication → URL Configuration** settings:

1. Keep this shared hackathon project’s Site URL on the staging deployment origin. Local development uses its explicit localhost callback and local `NEXT_PUBLIC_SITE_URL`.
2. Add both `http://localhost:3000/auth/confirm` and the staging deployment's `/auth/confirm` URL to Redirect URLs.
3. Keep email confirmation enabled; the URL update does not modify confirmation behavior.

The user-approved staging Auth URLs were configured and read back on 13 September 2026 at 06:24 UTC for `mikpepfrumtglwweolzq`: Site URL `https://jiak-simi-business-demo.elsenyong.chatgpt.site`; exact redirect URLs `https://jiak-simi-business-demo.elsenyong.chatgpt.site/auth/confirm` and `http://localhost:3000/auth/confirm`. The canonical origin above was returned by successful Sites deployment `appgdep_6aa640aebfac81919eeb26593431c32f`. The former reserved origin `https://jiak-simi-business-demo.zesty-crown-3337.chatgpt.site` is not canonical; its `/auth/confirm` allow-list entry was preserved along with localhost. The latest update retained both existing entries and added the canonical callback. The updater preserves existing entries on future runs. Only `site_url` and `uri_allow_list` were patched. Email-confirmation settings were unchanged and no email was sent. Evidence: `artifacts/deployment/staging-auth-urls.json`; guarded updater: `scripts/configure-staging-auth.mjs --apply`. See [SITES-READINESS.md](SITES-READINESS.md) for deployment status; URL configuration alone does not establish a successful browser login or email callback.

The root restaurant workspace is protected twice: the Next.js request proxy performs an early redirect, and the page validates signed JWT claims before returning restaurant content. The proxy is not the authorization boundary for restaurant data; database access must still use restaurant-membership RLS policies.

## Agreed hackathon data boundary

The product-level contract is in [PRODUCT_CONTRACT.md](PRODUCT_CONTRACT.md). The user has explicitly approved the core migration creation/application to this hackathon project. New photo storage/import additions remain proposals for separate review.

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

## Staff API integration and live verification

The existing shared API client takes the signed-in user's access token for `publishMenu` and `kitchen`. Obtain that token from the browser Supabase client's session immediately before calling the API; never use its unverified user object to decide restaurant membership. The backend verifies the token with `getUser`, then the service-only database RPC verifies active membership. Newly registered users have no restaurant permissions until explicitly assigned a membership. Do not add a signup trigger granting blanket access.

All restaurant portal pages are protected by default. `/login` supports entry, `/auth/confirm` is the public callback, and API routes retain their purpose-specific authorization (including restaurant-scoped guest sessions for customer ordering). Each staff page and data boundary must still verify identity and restaurant membership; the proxy is only an early redirect and is not sufficient for data authorization.

The public Auth settings were verified remotely: email/password is enabled, signup is enabled, and email confirmation is required. Site URL and exact local/staging redirect allow-list entries were verified through the Management API as recorded above. The confirmation email template remains unchanged and has not been verified by sending an email. No real signup or email was sent during automated verification. Verify sign-in, sign-out, expired-session refresh, anonymous redirect, forged JWT denial and cross-restaurant API denial against staging before claiming the full end-to-end deployment flow is complete.

Implementation references: [Supabase SSR client and verified claims](https://supabase.com/docs/guides/auth/server-side/creating-a-client) and the installed Next.js authentication guide in `node_modules/next/dist/docs/01-app/02-guides/authentication.md`.

## Confirmation email template

For a token-hash confirmation flow, set **Authentication → Email Templates → Confirm signup** to link to:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm your email</a>
```

This lands at the protected workspace after verification. The callback also supports the default PKCE `code` flow using the server cookie verifier when Auth redirects to the configured `/auth/confirm` URL. It rejects mixed/repeated credentials and OTP types outside email/signup. Password reset and magic-link login are not implemented. Confirmation redirects carry no-store/no-referrer headers; post-login paths are restricted to local URLs.

This template is documented for deployment; it has not been saved in the remote project by this task.

## Core ordering backend now applied

The approved core migration is applied and recorded as version `20260913042355` in project `mikpepfrumtglwweolzq`. All nine tables have RLS; eight server-only RPCs passed permission verification; all 53 hosted rollback assertions passed. The existing project secret key is now configured only in ignored `.env.local` as `SUPABASE_SECRET_KEY` for backend RPCs. This credential is required for ordering API operation, although browser Auth does not use it. No real menu/staff membership/order was seeded by the verification. See `FIRST-BACKEND-SYNC.md` for the first UI integration run.
