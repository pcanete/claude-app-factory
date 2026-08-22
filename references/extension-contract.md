# Extension contract

The factory owns structure; client code owns behavior that is not safely expressible as neutral metadata.

## Ownership zones

Three zones, not two. Collapsing platform code into the client zone is what makes an application impossible to update later.

**Generated** — compiled from `app-spec.json`, replaceable on every build:

- `src/generated/`
- `database/generated/`
- `BUILD_REPORT.md`

**Platform** — ships with the factory, updated by the factory, never edited per client:

- `src/platform/` (identity adapter, application settings, user administration, read-only assistant, MCP server for agents)
- `database/platform/` (migrations `100`–`499` supporting those features, including agent identities and their activity log)

**Client** — owned by humans and agents working for this client, never written by the factory:

- `src/features/`
- `src/components/custom/`
- `database/custom/` (migrations from `500` up)
- deployment configuration containing client decisions

Never edit generated or platform files to add client behavior. Add a feature module and register it through an explicit extension point. A later compiler may replace generated and platform output without reading or rewriting feature implementations.

To change platform behavior, import it from a feature and wrap it. To change generated structure, change the AppSpec and recompile.

## What belongs in AppSpec

- entities, fields, relationships;
- standard validation and permissions;
- standard views and navigation;
- stable, declarative business intent.
- deterministic before-mutation conditions using the reviewed `set` and `block` actions.
- bounded record-attachment policies using the built-in PostgreSQL adapter.
- deterministic table, kanban, calendar, and dashboard view definitions.
- which roles hold administrative capabilities (`manage_users`, `view_audit`, `view_rules`).
- bounded, opt-in table bulk edits and kanban/calendar moves that reuse permissions, rules, transactions, and audit.

## What belongs in a feature

- domain calculations and scoring;
- third-party integrations;
- multi-step workflows and approvals;
- specialized reports;
- AI tools and prompts;
- bespoke interfaces;
- large-file, direct-upload, antivirus, OCR, or provider-specific storage adapters;
- side effects such as email, payments, or external writes.
- client-specific invitation policy that wraps the platform identity adapter.

## Database evolution

- Generated and platform migrations are immutable after deployment. **This includes the factory's own
  platform migrations**: once a version ships, editing `database/platform/1xx_*.sql` breaks every
  application that already applied it, because its checksum no longer matches the ledger. A change to
  platform behaviour goes in the next numbered platform migration, never in an existing one.
- Changes to AppSpec create a new migration; they do not rewrite an applied migration.
- Custom migrations start at `500` so they always apply after generated and platform migrations, and must declare their dependencies.
- **A migration that destroys data does not apply on its own during a deployment.** The migration
  runner executes inside the build, which is safe while migrations only add. `scripts/destructive-guard.mjs`
  inspects each pending migration for `DROP TABLE`, `TRUNCATE`, `DROP COLUMN`, `DELETE` without `WHERE`,
  and `DROP SCHEMA`/`DROP DATABASE` — then asks the database whether there is anything to lose. Dropping a
  table that does not exist, or one that exists and is empty, deploys normally; dropping a table that holds
  rows stops the deployment. Anything it cannot resolve — an unparseable name, a failed query — counts as
  risk, not as permission.
- To authorize destruction, name the migration explicitly: `ALLOW_DESTRUCTIVE_MIGRATIONS="custom/501_x.sql"`.
  Authorization is per migration, never a blanket switch, so it cannot stay on by accident. Retiring a
  feature is two deployments, not one: decouple the code and ship, then remove the data as a separate,
  backed-up step.
- Migration files must not open their own transaction. `scripts/apply-migrations.mjs` wraps each file together with its ledger entry in a single transaction, so a migration and the record that it ran commit or roll back together.
- Applied migrations are checksummed; editing one after it ran is refused, not silently reapplied.
- Destructive schema changes require explicit review and a rollback or data-migration plan.

## Independence

Each generated project must be runnable from its own repository and documented environment variables. It may use ordinary open-source packages or chosen infrastructure, but it must not call Claude App Factory at runtime.
