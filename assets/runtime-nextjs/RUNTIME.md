# Generated runtime

This project is a local application foundation generated from `app-spec.json`.

## Local preview

1. Start PostgreSQL with `docker compose up -d db`, or provide any PostgreSQL connection.
2. Copy `.env.example` to `.env.local` and set `DATABASE_URL`.
3. Install dependencies with `pnpm install` or `npm install`.
4. Apply the generated migration with `pnpm db:apply`.
5. Verify real CRUD with `pnpm db:smoke`.
6. Run `pnpm dev` and choose a role at `/dev-access`.

`ALLOW_UNSAFE_LOCAL_PREVIEW=true` enables a passwordless role selector only outside production. Every page and mutation still enforces the generated permission matrix on the server. Production ignores this local path. Clerk proves identity; PostgreSQL remains authoritative for account status, role, and permissions. Without both Clerk keys the production login stays closed.

Every create, update, and delete operation writes `app_audit_log` in the same database transaction. Roles with full list/read/delete access across every entity can review and filter the history at `/audit`.

## User management

Users with full administrative access can manage application users at `/users`: create pending identities, send Clerk invitations, assign one AppSpec role, and activate or deactivate access. User mutations are validated on the server and written to the audit log. Accounts are deactivated instead of deleted so their history remains attributable.

Local-preview identities are read-only and the current administrator cannot deactivate their own account or remove their own role. The module intentionally does not edit role permissions at runtime: roles and their permission matrices remain versioned in AppSpec. On first production login, a verified Clerk email is atomically matched to an active `pending:` user, replaced with the stable Clerk subject, and audited.

For a new deployment, connect Neon and Clerk to the Vercel project. Production deployments run the idempotent database migrations before `next build`; preview deployments never mutate the production database. Define `BOOTSTRAP_ADMIN_EMAIL` and optionally `BOOTSTRAP_ADMIN_NAME` in the Production environment before the first deployment to create the pending PostgreSQL administrator automatically. Configure Clerk for invitation-only access and invite that same email from Clerk or create the first identity there. Its first verified login links the Clerk identity to the pending PostgreSQL user. Subsequent invitations can be sent from `/users`.

Outside Vercel, set `DATABASE_URL_DIRECT`, run `pnpm db:apply`, define `BOOTSTRAP_ADMIN_EMAIL` and optionally `BOOTSTRAP_ADMIN_NAME`, then run `pnpm auth:bootstrap`.

## Production verification and recovery

Treat a successful Vercel build as the beginning of production verification, not its end. Confirm the deployed source commit, migration logs, `GET /api/health`, unauthenticated redirect, invited administrator login, one permission-checked CRUD path, audit events, `/users`, `/settings`, and one AI conversation when AI is enabled. Review runtime logs for the verified flow.

Keep one independent Vercel project, Neon database, Clerk application, and credential set for this application. Store production secrets only in the deployment environment and an approved recovery system; never commit them. Back up `SETTINGS_ENCRYPTION_KEY` before users connect providers. Losing it makes encrypted credentials unreadable.

A code rollback does not roll back PostgreSQL. Prefer additive, backward-compatible migrations and require an explicit data backup, migration, and rollback plan for destructive changes. Configure database backup or point-in-time recovery appropriate to the application and test restoration. Record who owns recovery for source, data, identity, environment variables, and encryption keys.

Every entity also exposes generic CSV/XLSX transfer tools:

- export and template downloads require the entity's server-side permissions;
- imports accept at most 5 MB and 1,000 create-only rows;
- every file is prevalidated before a user-owned preview batch is staged for one hour;
- confirmation inserts the complete batch and its audit events in one database transaction;
- relationship cells accept an existing UUID or an exact title-field value.

Production operations must schedule cleanup of expired `app_import_batch` rows and review import/export limits for the client.

## Attachments

Entities that enable `attachments` in AppSpec expose a protected attachment panel on each record. Upload and deletion require the entity's `update` permission; listing and download require `read`. File metadata, bytes, checksum, actor, and audit event are committed through PostgreSQL, with a hard limit of 4 MB per file.

The PostgreSQL adapter keeps local and small deployments portable. Large files, direct browser uploads, antivirus scanning, OCR, or external object storage belong behind a reviewed client adapter.

## Named views

Navigation-enabled table, kanban, calendar, and dashboard definitions are rendered at `/views/[view]`:

- table views support combined field filters, searchable text, and validated ordering;
- kanban columns come from a validated enum field;
- calendar events use a validated date/datetime field and the AppSpec timezone;
- dashboards provide count/sum/average metrics, enum/boolean breakdowns, and recent-record tables without arbitrary SQL.

These views are read-oriented. Drag-and-drop mutations, scheduling side effects, and specialized charting remain client features.

## Deterministic rules

AppSpec rules execute before create, update, delete, or both create/update (`before_save`). The evaluator accepts only validated condition trees and deterministic `set` or `block` actions. Successful assignments and their rule keys are included in the same audit event as the mutation; blocked operations write nothing.

Administrators can inspect the active definitions at `/rules`. The kernel deliberately rejects arbitrary expressions and does not provide approvals, schedules, email, webhooks, external writes, or AI actions.

## Application assistant

The runtime includes a persistent, read-only application assistant at `/assistant`. Its tools are derived from `app-spec.json` and call the same bounded repository functions used by the application. Every tool call checks the current user's generated entity permissions; the model never receives SQL or database credentials.

Each authenticated user can open `/settings` and connect a personal OpenAI or Anthropic API key. Keys are encrypted with AES-256-GCM before PostgreSQL storage, never rendered back to the browser, and are isolated by user. Define `SETTINGS_ENCRYPTION_KEY` as exactly 32 random bytes encoded as base64 (or 64 hexadecimal characters); preserve and back it up because losing it makes stored credentials unreadable.

The application may also provide `OPENAI_API_KEY` for shared direct OpenAI access or `AI_GATEWAY_API_KEY` for multi-provider routing. Personal provider credentials take precedence for their provider. Optionally restrict selectable models with `AI_ALLOWED_MODELS`. Conversations, UI messages, runs, token usage, and bounded tool-call metadata are stored in PostgreSQL. This first layer cannot create, update, delete, export, or call external systems. Those capabilities require explicit approval policies and reviewed feature adapters.

## Application settings

`/settings` is the extensible administration surface. Every user owns personal preferences and encrypted connections; administrators additionally manage application-wide locale and timezone. New connectors and module settings belong in the same namespaced `app_setting`, `app_user_setting`, and `app_user_secret` primitives instead of ad hoc environment variables or domain-specific tables.

## Ownership

Do not add client behavior to `src/generated/` or `database/generated/`. Use `src/features/`, `src/components/custom/`, and `database/custom/`.
