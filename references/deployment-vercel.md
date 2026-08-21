# Vercel production runbook

Use this runbook for the supported Vercel + Neon PostgreSQL + Clerk path. The generated application is portable; these services are deployment adapters, not runtime dependencies of the factory.

## 1. Freeze a verified source revision

Before creating cloud resources:

- validate the AppSpec and run `python scripts/test_scaffold.py`;
- generate into a new or empty directory and run `python scripts/verify_scaffold.py <directory>`;
- install locked dependencies and run `pnpm typecheck` or `pnpm build`;
- apply migrations to a disposable PostgreSQL database with `pnpm db:apply`;
- run `pnpm db:smoke` and verify one complete CRUD path in a real browser;
- commit the source, lockfile, generated migrations, and documentation, but never environment files or secrets.

Do not deploy directly from an uncommitted working tree.

## 2. Provision one independent application

Create one Vercel project, one Neon database, one Clerk application, and one credential set for the generated application. Do not share these resources across unrelated clients.

Connect the GitHub repository to Vercel and set the framework to Next.js. Preserve the generated `vercel-build` command: in production it applies idempotent migrations, bootstraps the pending administrator when configured, and then executes `next build`. Preview builds do not mutate the production database.

## 3. Configure environment variables

Keep values scoped to the smallest required Vercel environments.

| Variable | Scope | Purpose |
|---|---|---|
| `DATABASE_URL` | Production, runtime | Pooled Neon connection used by the application |
| `DATABASE_URL_DIRECT` | Production, build | Direct/unpooled connection preferred for migrations |
| `NEXT_PUBLIC_APP_URL` | Production | Canonical application origin used in links |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Production | Public Clerk application identifier |
| `CLERK_SECRET_KEY` | Production, sensitive | Server-side Clerk operations |
| `BOOTSTRAP_ADMIN_EMAIL` | Production | Email for the first pending administrator |
| `BOOTSTRAP_ADMIN_NAME` | Production | Optional display name for that administrator |
| `SETTINGS_ENCRYPTION_KEY` | Production, sensitive | Unique 32-byte key for encrypted personal connections |
| `OPENAI_API_KEY` or `AI_GATEWAY_API_KEY` | Optional, sensitive | Shared AI access when users do not provide personal keys |
| `AI_ALLOWED_MODELS` | Optional | Comma-separated model allowlist |

Never configure `ALLOW_UNSAFE_LOCAL_PREVIEW=true` in Vercel. Production ignores it, but its presence creates misleading operational state.

Generate `SETTINGS_ENCRYPTION_KEY` from a cryptographically secure random source. Save a recoverable copy in the client's approved secret manager before users store provider keys. Do not rotate it without a data re-encryption plan.

## 4. Close identity before opening access

- Configure Clerk for invitation-only access.
- Set the same verified email in `BOOTSTRAP_ADMIN_EMAIL` and in the first Clerk invitation or identity.
- Deploy while the application remains private or otherwise inaccessible to uninvited users.
- Sign in as the first administrator and confirm that the pending PostgreSQL identity links to the stable Clerk subject.
- Create later users from `/users`; PostgreSQL remains authoritative for active status and role.

Clerk proves identity. It does not replace server-side permission checks or the `app_user` record.

## 5. Deploy and verify the complete story

A green build is necessary but insufficient. Verify all of the following against the production URL:

1. Vercel reports the deployment as ready and build logs show the expected migrations.
2. `GET /api/health` returns `200` and confirms database access without exposing secrets.
3. An unauthenticated visitor is redirected to sign-in and cannot read application data.
4. The invited administrator can sign in and reaches the application with the expected role.
5. One representative create, read, update, and delete flow enforces permissions and writes audit events.
6. `/users` can invite or stage a user without allowing self-deactivation or unauthorized role changes.
7. `/settings` stores a personal provider key without rendering it back to the browser.
8. When AI is enabled, one conversation succeeds with the intended personal or shared credential.
9. Runtime logs contain no unhandled error for the verified flow.

Record the source commit, production deployment URL, migration result, and verification date in the delivery handoff.

## 6. Recovery and portability

- A Vercel rollback rolls back code, not PostgreSQL. Prefer additive, backward-compatible migrations; destructive changes require an explicit data migration, backup, and rollback plan.
- Configure Neon backups or point-in-time recovery appropriate to the client's data and test restoration before claiming recoverability.
- Export or document Clerk configuration and recovery ownership.
- Keep deployment environment variables inventoried without copying their secret values into GitHub.
- Back up `SETTINGS_ENCRYPTION_KEY` separately. If it is lost, encrypted user credentials cannot be recovered and each user must reconnect them.

If Vercel disappears, the committed Next.js application can run on another Node-compatible host. If the factory disappears, every generated application still contains its ordinary source, migrations, AppSpec, and runtime documentation.

## Stop conditions

Do not declare the deployment production-ready when any of these remain unresolved:

- the default branch does not contain the deployed source;
- a secret or customer record is present in Git history;
- authentication permits public sign-up unintentionally;
- server-side permissions or the first-admin link have not been tested;
- migrations are destructive or have no recovery plan;
- database or encryption-key recovery ownership is unknown;
- health, logs, and an authenticated browser flow have not been checked.
