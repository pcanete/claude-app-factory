# Riel App Factory

Riel App Factory turns a business request into an independent, single-tenant application foundation. It models the request as an **AppSpec** and generates ordinary Next.js and PostgreSQL source code that can be extended, deployed, and maintained without depending on the factory at runtime.

> En español: convierte un pedido de negocio en una base web neutral e independiente por cliente. No presupone que la aplicación sea un CRM, ERP ni otro vertical.

## What it generates

- neutral entities, fields, relationships, roles, and server-side permissions;
- PostgreSQL migrations, audited CRUD, imports/exports, and attachments;
- table, kanban, calendar, and dashboard views;
- deterministic validation and mutation rules;
- Clerk authentication and application-level user management;
- a read-only AI assistant with per-user encrypted OpenAI or Anthropic keys;
- explicit extension zones for client-specific behavior.

Every client application gets its own repository, database, deployment, credentials, and lifecycle. The generated application does not call Riel App Factory in production.

## Quick start

Requirements: Python 3.11+ for the factory, and Node.js 20+ plus PostgreSQL for the generated application.

```bash
python scripts/test_scaffold.py
python scripts/scaffold_app.py \
  --spec references/example-maintenance.app-spec.json \
  --output ../maintenance-demo
python scripts/verify_scaffold.py ../maintenance-demo
```

Then enter the generated directory:

```bash
cp .env.example .env.local
pnpm install
pnpm db:apply
pnpm db:smoke
pnpm dev
```

Set `ALLOW_UNSAFE_LOCAL_PREVIEW=true` only for local development. It enables the role selector at `/dev-access`; production always ignores it.

## From local validation to production

The supported production path uses Vercel, Neon PostgreSQL, and Clerk, but the generated code remains portable. A deployment is not complete until migrations, the first administrator, invitation-only authentication, permissions, health, and an authenticated browser flow have all been verified.

Read the complete [Vercel production runbook](references/deployment-vercel.md) before deploying. The generated app also includes its own `RUNTIME.md` and `.env.example` so it remains operable after leaving this repository.

## Architecture boundary

- `app-spec.json` is the source of truth for generated structure.
- `src/generated/` and `database/generated/` are replaceable output.
- `src/features/`, `src/components/custom/`, and `database/custom/` belong to the application.
- Regeneration must never overwrite client-specific behavior.
- Integrations, approvals, external writes, and domain calculations require reviewed feature adapters.

See [AppSpec v0](references/app-spec-v0.md) and the [extension contract](references/extension-contract.md).

## Repository structure

```text
SKILL.md                     Codex skill instructions
agents/openai.yaml           Skill UI metadata
references/                  AppSpec, extension, and deployment contracts
scripts/                     Deterministic compiler and verification
assets/runtime-nextjs/       Portable generated-application runtime
```

## Security and data ownership

Never commit `.env.local`, provider credentials, database URLs, Clerk secrets, or `SETTINGS_ENCRYPTION_KEY`. Use a unique encryption key per deployed application and keep a recoverable copy in an approved secret manager: losing it makes stored user credentials unreadable.

Code backup does not replace database backup. Source lives in GitHub, application data in PostgreSQL, deployment configuration in the hosting provider, and identity configuration in Clerk. Each layer needs its own recovery plan.

See [SECURITY.md](SECURITY.md) before reporting a vulnerability.

## Project status

Riel App Factory is an early public foundation, not a hosted no-code product and not a blanket production-readiness guarantee. The safest contributions improve neutrality, determinism, portability, security, or verification without introducing shared multi-tenancy.

Contributions are welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md).
