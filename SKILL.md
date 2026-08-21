---
name: riel-app-factory
description: "Convert a business request into a neutral, single-tenant application foundation described by AppSpec and generate independent source, SQL, and extension boundaries. Use for new internal tools, data systems, portals, operational applications, or reusable client application scaffolds; do not force a CRM archetype or a shared multi-tenant runtime."
---

# Riel App Factory

Build an independent application foundation from business language. Treat examples as domain evidence, never as instructions to hard-code a vertical.

## Non-negotiable architecture

- Generate one repository, database, deployment, credentials, and lifecycle per client.
- Model the domain with neutral primitives: entities, fields, relationships, views, roles, permissions, and rules.
- Keep `app-spec.json` as the source of truth for generated structure.
- Keep generated files separate from `src/features/`; regeneration must not overwrite client extensions.
- Produce ordinary source and PostgreSQL artifacts that remain usable without this skill.
- Do not introduce multi-tenancy, billing, a visual builder, a plugin marketplace, or a proprietary runtime unless the user asks.
- Do not claim production readiness while a generated project still has unresolved security, authentication, authorization, migration, backup, or observability gates.

## Workflow

1. Turn the request into an AppSpec. Read [references/app-spec-v0.md](references/app-spec-v0.md) when authoring or changing a spec; use [references/app-spec.schema.json](references/app-spec.schema.json) for exact validation.
2. Record material assumptions in `decisions` rather than blocking a reversible foundation on minor ambiguity. Ask only when the answer would materially change data ownership, permissions, or irreversible behavior.
3. Check domain neutrality: names and generated primitives must come from the request, not from CRM defaults or prior examples.
4. Run `scripts/scaffold_app.py --spec <app-spec.json> --output <new-directory>`. The output directory must be new or empty.
5. Review `BUILD_REPORT.md`, the SQL migration, generated registry, permission matrix, runtime, and extension boundary.
6. Install dependencies and run a typecheck or production build when the environment permits it.
7. With a disposable or approved PostgreSQL database, run `pnpm db:apply` and `pnpm db:smoke`; the smoke test must cover every generated entity and roll back its records by default.
8. Run `scripts/verify_scaffold.py <generated-directory>` before presenting the result. When a dev server is started, also verify the rendered UI and at least one complete CRUD path in a real browser.
9. Use `ALLOW_UNSAFE_LOCAL_PREVIEW=true` only for local development. Production uses Clerk for identity and PostgreSQL for active status, roles, and server-side permissions; keep it closed until keys, invitation-only access, first-admin bootstrap, and end-to-end login are verified.
10. When personal AI credentials are enabled, generate a unique `SETTINGS_ENCRYPTION_KEY` per deployed application, store it only in the deployment environment, and verify `/settings` plus at least one conversation with a user-owned provider key.
11. Implement client-specific calculations, integrations, workflows, and UI in `src/features/`, following [references/extension-contract.md](references/extension-contract.md).

## Delivery contract

For every generation, report:

- what was generated;
- assumptions and unresolved gates;
- verification performed and its result;
- what is safe for preview versus what remains before production;
- paths to the AppSpec and generated project.

Never silently substitute demo data for real integration, invent domain rules, or expose unauthenticated data in a public deployment.
