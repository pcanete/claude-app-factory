# Contributing

Thank you for helping improve Riel App Factory.

## Before changing code

1. Open or reference an issue that describes the business capability and why it belongs in the neutral foundation.
2. Confirm that the change does not hard-code a CRM, ERP, or previous client domain.
3. Decide whether it belongs in generated structure or in a client extension boundary.

## Development checks

Run from the repository root:

```bash
python scripts/test_scaffold.py
python scripts/scaffold_app.py \
  --spec references/example-maintenance.app-spec.json \
  --output ../maintenance-demo
python scripts/verify_scaffold.py ../maintenance-demo
```

For runtime changes, also install the generated application's dependencies, run `pnpm typecheck` or `pnpm build`, apply migrations to a disposable PostgreSQL database, run `pnpm db:smoke`, and verify one complete CRUD path in a real browser.

## Pull requests

- Keep generated and client-owned code boundaries intact.
- Add or update tests for compiler behavior.
- Document new environment variables and production gates.
- Never include credentials, customer data, deployment secrets, or local `.env` files.
- Call out migrations, security effects, and backward-compatibility risks explicitly.

Small, focused pull requests are easier to review and reuse.
