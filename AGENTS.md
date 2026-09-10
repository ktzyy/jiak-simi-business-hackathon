<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Jiak Simi Business Hackathon

- This repository is the restaurant-facing web portal. Do not copy the B2C mobile app into it.
- Use npm and keep `package-lock.json` committed. Pin security-sensitive dependencies exactly.
- Use a separate hackathon or staging Supabase project. Never connect local experiments to production.
- Browser code may use only the Supabase project URL and publishable key.
- Never place a Supabase secret key, legacy service-role key, database password, or access token in source control or client code.
- Every exposed table must use least-privilege grants and Row Level Security scoped to restaurant membership.
- Do not add or run database migrations without explicit approval.
