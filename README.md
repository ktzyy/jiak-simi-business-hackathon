# Jiak Simi for Business

A separate restaurant-facing web portal for the Jiak Simi business hackathon. It is intentionally independent from the B2C Expo mobile application while being designed to share a safe hackathon/staging data model.

## Local development

Requirements are already installed on Kimberley's MacBook Air: Node.js 22 through Volta, npm, Git and GitHub CLI.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The page works in demo mode without Supabase. The Singapore hackathon project is configured locally on Kimberley's MacBook through the Git-ignored `.env.local` file. On another machine, obtain only the project URL and publishable key from the project's Connect dialog; never copy `.env.local` through Git or chat.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
```

## Supabase boundary

- Use a separate hackathon/staging Supabase project, never the Jiak Simi production project.
- Browser and authenticated SSR clients use only the project URL and publishable key.
- Never put a secret key, legacy service-role key, database password, or access token in this repository.
- Every exposed table must have least-privilege grants and Row Level Security scoped to restaurant membership.
- No schema or migration has been created yet.

Read these agreements before beginning feature work:

- [Product contract](docs/PRODUCT_CONTRACT.md)
- [Team workflow](docs/TEAM_WORKFLOW.md)
- [Supabase setup](docs/SUPABASE_SETUP.md)
