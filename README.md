# Claude App Factory

Claude App Factory turns a business request into an independent, single-tenant application foundation. It models the request as an **AppSpec** and generates ordinary Next.js and PostgreSQL source code that can be extended, deployed, and maintained without depending on the factory at runtime.

> En español: convierte un pedido de negocio en una base web neutral e independiente por cliente. No presupone que la aplicación sea un CRM, ERP ni otro vertical.

## Origin

This project began as [riel-app-factory](https://github.com/pcanete/riel-app-factory), authored with
OpenAI Codex, and continues here as the Claude line: same MIT license and same author, developed and
maintained independently. Both are engines for the same idea, and neither reads or writes the other.
The history before the ownership-zones commit belongs to the original repository.

## What it generates

- neutral entities, fields, relationships, roles, and server-side permissions;
- PostgreSQL migrations, audited CRUD, imports/exports, and attachments;
- table, kanban, calendar, and dashboard views;
- deterministic validation and mutation rules;
- Clerk authentication and application-level user management;
- a read-only AI assistant with per-user encrypted OpenAI or Anthropic keys;
- explicit extension zones for client-specific behavior;
- an MCP endpoint where agents authenticate with their own hashed, expiring, scoped tokens, read and write under the AppSpec permissions of a role, and leave a per-tool trail;
- incremental schema evolution that writes the next migration instead of rewriting an applied one.

Every client application gets its own repository, database, deployment, credentials, and lifecycle. The generated application does not call Claude App Factory in production.

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

Three ownership zones:

| Zone | Directories | Owner |
|---|---|---|
| Generated | `src/generated/`, `database/generated/` | Compiled from `app-spec.json`; replaced on every build |
| Platform | `src/platform/`, `database/platform/` | Ships and updates with the factory; never edited per client |
| Client | `src/features/`, `src/components/custom/`, `database/custom/` | The application; never written by the factory |

- `app-spec.json` is the source of truth for generated structure.
- Regeneration must never overwrite client-specific behavior.
- To change platform behavior for one client, wrap it from a feature — do not edit it.
- Integrations, approvals, external writes, and domain calculations require reviewed feature adapters.

Regeneration is implemented: `scripts/evolve_app.py` plans a change, reports what is blocked, and on
`--apply` writes the next migration and refreshes only factory-owned artifacts. See
[AppSpec evolution](references/evolution.md).

See [AppSpec v0](references/app-spec-v0.md) and the [extension contract](references/extension-contract.md).

## Repository structure

```text
SKILL.md                     Agent skill instructions
references/                  AppSpec, extension, and deployment contracts
scripts/                     Deterministic compiler and verification
assets/runtime-nextjs/       Portable generated-application runtime
```

CI validates three things on every push: the compiler tests, a typecheck and production build of the
generated application, and the generated migrations applied to a real PostgreSQL with a CRUD smoke test
over every entity.

## Security and data ownership

Never commit `.env.local`, provider credentials, database URLs, Clerk secrets, or `SETTINGS_ENCRYPTION_KEY`. Use a unique encryption key per deployed application and keep a recoverable copy in an approved secret manager: losing it makes stored user credentials unreadable.

Code backup does not replace database backup. Source lives in GitHub, application data in PostgreSQL, deployment configuration in the hosting provider, and identity configuration in Clerk. Each layer needs its own recovery plan.

See [SECURITY.md](SECURITY.md) before reporting a vulnerability.

## Project status

Claude App Factory is an early foundation, not a hosted no-code product and not a blanket
production-readiness guarantee.

What is proven today: the compiler is deterministic and tested, the generated application typechecks
and builds, the generated migrations apply to a real PostgreSQL, and every generated entity survives
a CRUD smoke test — all of it enforced on every push by CI.

What is not built yet: regeneration over an existing project, row-level permissions, and
`many_to_many` relationships. Each is documented where it matters rather than implied to work.

The safest contributions improve neutrality, determinism, portability, security, or verification
without introducing shared multi-tenancy.

Contributions are welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) — use, modify, and distribute the project with attribution and without warranty.
