# Extension contract

The factory owns structure; client code owns behavior that is not safely expressible as neutral metadata.

## Ownership zones

Generated and replaceable:

- `src/generated/`
- `database/generated/`
- `BUILD_REPORT.md`

Human- and agent-owned:

- `src/features/`
- `src/components/custom/`
- `database/custom/`
- deployment configuration containing client decisions

Never edit generated files to add client behavior. Add a feature module and register it through an explicit extension point. A later compiler may replace generated output without reading or rewriting feature implementations.

## What belongs in AppSpec

- entities, fields, relationships;
- standard validation and permissions;
- standard views and navigation;
- stable, declarative business intent.
- deterministic before-mutation conditions using the reviewed `set` and `block` actions.
- bounded record-attachment policies using the built-in PostgreSQL adapter.
- deterministic table, kanban, calendar, and dashboard view definitions.
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
- the Clerk identity adapter and invitation policy in `src/features/auth/`.

## Database evolution

- Generated migrations are immutable after deployment.
- Changes to AppSpec create a new migration; they do not rewrite an applied migration.
- Custom migrations use a separate sequence and must declare dependencies.
- Destructive schema changes require explicit review and a rollback or data-migration plan.

## Independence

Each generated project must be runnable from its own repository and documented environment variables. It may use ordinary open-source packages or chosen infrastructure, but it must not call Riel App Factory at runtime.
