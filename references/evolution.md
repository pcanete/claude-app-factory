# Safe AppSpec evolution

Use this procedure when changing an application that has already been generated. The current `app-spec.json` is the database contract baseline; never replace it before producing the evolution plan.

## Workflow

1. Commit or otherwise snapshot the application source.
2. Create a separate proposed AppSpec and validate it.
3. Generate a read-only plan:

   ```bash
   python /path/to/riel-app-factory/scripts/evolve_app.py \
     --project /path/to/application \
     --spec /path/to/proposed.app-spec.json
   ```

4. Review every change, warning, blocked operation, and proposed SQL statement.
5. Apply only a safe plan:

   ```bash
   python /path/to/riel-app-factory/scripts/evolve_app.py \
     --project /path/to/application \
     --spec /path/to/proposed.app-spec.json \
     --migration-name add_priorities \
     --apply
   ```

6. Review the Git diff and the new `database/generated/NNN_*.sql` migration before connecting a database.
7. Back up or confirm recovery for the target database, then run `pnpm db:apply`, `pnpm db:smoke`, and `pnpm typecheck` or `pnpm build`.
8. Verify affected permissions, rules, views, and a complete browser flow. Use preview before production where available.

The apply step updates only factory-owned artifacts:

- `app-spec.json`;
- `src/generated/app-spec.ts`;
- `src/generated/navigation.ts`;
- `src/generated/permissions.ts`;
- `database/generated/NNN_*.sql` when the schema changes;
- `BUILD_REPORT.md` and `EVOLUTION_REPORT.md`.

It does not overwrite `src/features/`, `src/components/custom/`, `database/custom/`, deployment configuration, or other client-owned files.

## Automatically supported changes

- add an entity, including its fields, enum constraints, indexes, and `belongs_to` foreign keys;
- add an optional field;
- add a required field when it has a safe default;
- add an optional `belongs_to` relationship;
- add or relabel roles;
- add enum values without removing existing values;
- add a search index or relax `NOT NULL`;
- change field defaults;
- change labels, help, permissions, attachments, views, rules, and decisions as runtime metadata.

`has_many` relationships are inverse metadata and do not create database columns.

## Changes that stop automatically

- remove or rename an entity, field, or stored relationship;
- change a field type;
- remove an enum value;
- make an existing field or relationship required without an explicit backfill;
- add uniqueness where existing duplicates may exist or remove a unique constraint;
- change a foreign-key target, type, or delete behavior;
- remove a role that may still own users;
- change the application key or AppSpec version.

These operations are not forbidden. They require a custom reviewed migration, data analysis, backup, and rollback plan. After the database and AppSpec have been reconciled deliberately, the normal generated metadata can continue from the new baseline.

## Migration invariants

- Applied migrations are immutable; evolution always creates the next numbered migration.
- Migration checksums are enforced by the generated runtime.
- A source rollback does not roll back PostgreSQL.
- An evolution plan is not evidence that the migration succeeded against real data.
- Never use a production database as the first migration test.
