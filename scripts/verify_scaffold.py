#!/usr/bin/env python3
"""Verify observable invariants of a generated Riel application foundation."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scaffold_app import validate_spec


EXPECTED_FILES = {
    "app-spec.json",
    "BUILD_REPORT.md",
    "database/generated/001_initial.sql",
    "database/custom/EXTENSIONS.md",
    "database/custom/100_ai_foundation.sql",
    "database/custom/110_user_management.sql",
    "database/custom/120_clerk_authentication.sql",
    "src/generated/app-spec.ts",
    "src/generated/navigation.ts",
    "src/generated/permissions.ts",
    "src/features/EXTENSIONS.md",
    "src/components/custom/EXTENSIONS.md",
    "package.json",
    "pnpm-workspace.yaml",
    "next.config.ts",
    "compose.yaml",
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/app/actions.ts",
    "src/app/audit/page.tsx",
    "src/app/users/actions.ts",
    "src/app/users/page.tsx",
    "src/app/users/[id]/page.tsx",
    "src/app/sign-in/[[...sign-in]]/page.tsx",
    "src/app/sign-up/[[...sign-up]]/page.tsx",
    "src/app/access-pending/page.tsx",
    "src/app/dev-access/actions.ts",
    "src/app/dev-access/page.tsx",
    "src/app/forbidden/page.tsx",
    "src/app/rules/page.tsx",
    "src/app/views/[view]/page.tsx",
    "src/app/attachments/actions.ts",
    "src/app/attachments/[id]/route.ts",
    "src/app/assistant/actions.ts",
    "src/app/assistant/page.tsx",
    "src/app/assistant/[id]/page.tsx",
    "src/app/api/assistant/route.ts",
    "src/app/record-operations/actions.ts",
    "src/app/records/[entity]/page.tsx",
    "src/app/records/[entity]/new/page.tsx",
    "src/app/records/[entity]/import/actions.ts",
    "src/app/records/[entity]/import/page.tsx",
    "src/app/records/[entity]/export/route.ts",
    "src/app/records/[entity]/[id]/page.tsx",
    "src/components/import-upload-form.tsx",
    "src/components/record-form.tsx",
    "src/components/attachment-panel.tsx",
    "src/components/record-filters.tsx",
    "src/components/record-table.tsx",
    "src/components/bulk-record-table.tsx",
    "src/components/operational-kanban.tsx",
    "src/components/operational-calendar.tsx",
    "src/components/pagination.tsx",
    "src/components/session-sign-out.tsx",
    "src/features/auth/adapter.ts",
    "src/features/auth/config.ts",
    "src/features/auth/invitations.ts",
    "src/features/ai/access.ts",
    "src/features/ai/agent.ts",
    "src/features/ai/config.ts",
    "src/features/ai/model-adapter.ts",
    "src/features/ai/store.ts",
    "src/features/ai/tools.ts",
    "src/features/ai/components/application-assistant-chat.tsx",
    "src/features/users/store.ts",
    "src/lib/auth-types.ts",
    "src/lib/auth.ts",
    "src/lib/audit.ts",
    "src/lib/attachments.ts",
    "src/lib/data-transfer.ts",
    "src/lib/import-batches.ts",
    "src/lib/repository.ts",
    "src/lib/runtime-access.ts",
    "src/lib/rules.ts",
    "src/lib/view-query.ts",
    "scripts/apply-migrations.mjs",
    "scripts/bootstrap-admin.mjs",
    "scripts/smoke-crud.mjs",
    "src/proxy.ts",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path, help="Generated project directory")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project = args.project.resolve()
    failures: list[str] = []

    if not project.is_dir():
        print(f"Project directory not found: {project}", file=sys.stderr)
        return 2

    for relative_path in sorted(EXPECTED_FILES):
        path = project / relative_path
        if not path.is_file() or path.stat().st_size == 0:
            failures.append(f"Missing or empty file: {relative_path}")

    spec_path = project / "app-spec.json"
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        failures.append(f"Cannot read app-spec.json: {error}")
        spec = None

    if spec is not None:
        failures.extend(f"Invalid AppSpec: {error}" for error in validate_spec(spec))
        sql_path = project / "database/generated/001_initial.sql"
        sql = sql_path.read_text(encoding="utf-8") if sql_path.is_file() else ""
        registry_path = project / "src/generated/app-spec.ts"
        registry = registry_path.read_text(encoding="utf-8") if registry_path.is_file() else ""
        permissions_path = project / "src/generated/permissions.ts"
        permissions = permissions_path.read_text(encoding="utf-8") if permissions_path.is_file() else ""
        for entity in spec.get("entities", []):
            if f'CREATE TABLE "{entity["key"]}"' not in sql:
                failures.append(f"SQL table missing for entity: {entity['key']}")
            if f'"key": "{entity["key"]}"' not in registry:
                failures.append(f"Registry missing entity: {entity['key']}")
            if f'"{entity["key"]}"' not in permissions:
                failures.append(f"Permission matrix missing entity: {entity['key']}")
        for entity in spec.get("entities", []):
            for relationship in entity.get("relationships", []):
                if relationship.get("type") == "belongs_to":
                    expected = f'FOREIGN KEY ("{relationship["key"]}_id")'
                    if expected not in sql:
                        failures.append(
                            f"Foreign key missing: {entity['key']}.{relationship['key']}"
                        )
        if "app_audit_log_created_at_idx" not in sql:
            failures.append("Audit-log indexes are missing from generated SQL.")
        if "CREATE TABLE IF NOT EXISTS app_import_batch" not in sql:
            failures.append("Import preview staging table is missing from generated SQL.")
        if "app_import_batch_expiry_idx" not in sql:
            failures.append("Import preview expiry index is missing from generated SQL.")
        if "CREATE TABLE IF NOT EXISTS app_attachment" not in sql:
            failures.append("Universal attachment table is missing from generated SQL.")
        if "app_attachment_record_idx" not in sql:
            failures.append("Attachment record index is missing from generated SQL.")

    report_path = project / "BUILD_REPORT.md"
    report = report_path.read_text(encoding="utf-8") if report_path.is_file() else ""
    if "not production-ready" not in report:
        failures.append("Build report does not preserve the production-readiness gate.")
    if "Clerk" not in report:
        failures.append("Build report does not identify the production identity integration.")
    if "permission matrix is enforced server-side" not in report:
        failures.append("Build report does not describe server-side authorization.")
    runtime_access_path = project / "src/lib/runtime-access.ts"
    runtime_access = runtime_access_path.read_text(encoding="utf-8") if runtime_access_path.is_file() else ""
    if 'process.env.NODE_ENV !== "production"' not in runtime_access:
        failures.append("Runtime does not fail closed in production.")
    auth_path = project / "src/lib/auth.ts"
    auth_source = auth_path.read_text(encoding="utf-8") if auth_path.is_file() else ""
    if "generatedPermissions" not in auth_source or "requirePermission" not in auth_source:
        failures.append("Runtime authentication does not enforce the generated permission matrix.")
    action_path = project / "src/app/actions.ts"
    action_source = action_path.read_text(encoding="utf-8") if action_path.is_file() else ""
    for action in ("create", "update", "delete"):
        if f'requirePermission(entityKey, "{action}")' not in action_source:
            failures.append(f"Server action is missing the {action} permission check.")
    if "withTransaction" not in action_source or "recordAuditEvent" not in action_source:
        failures.append("Server mutations do not record audit events transactionally.")
    if "applyRules" not in action_source or "RuleBlockedError" not in action_source:
        failures.append("Server mutations do not enforce deterministic AppSpec rules.")
    audit_page_path = project / "src/app/audit/page.tsx"
    audit_page = audit_page_path.read_text(encoding="utf-8") if audit_page_path.is_file() else ""
    if "requireAuditAccess" not in audit_page or "listAuditEvents" not in audit_page:
        failures.append("Audit history page is missing its server-side access or data check.")
    user_actions_path = project / "src/app/users/actions.ts"
    user_actions = user_actions_path.read_text(encoding="utf-8") if user_actions_path.is_file() else ""
    for invariant in ("requireUserManagementAccess", "withTransaction", "recordAuditEvent", "SELF_PROTECTION", "LOCAL_IDENTITY"):
        if invariant not in user_actions:
            failures.append(f"User management actions are missing: {invariant}.")
    user_page_path = project / "src/app/users/page.tsx"
    user_page = user_page_path.read_text(encoding="utf-8") if user_page_path.is_file() else ""
    if "requireUserManagementAccess" not in user_page or "listManagedUsers" not in user_page:
        failures.append("User management page is missing server-side access or data checks.")
    rules_page_path = project / "src/app/rules/page.tsx"
    rules_page = rules_page_path.read_text(encoding="utf-8") if rules_page_path.is_file() else ""
    if "requireRulesAccess" not in rules_page or "runtimeSpec.rules" not in rules_page:
        failures.append("Rules page is missing its server-side access or AppSpec data source.")
    rules_runtime_path = project / "src/lib/rules.ts"
    rules_runtime = rules_runtime_path.read_text(encoding="utf-8") if rules_runtime_path.is_file() else ""
    if "RuleBlockedError" not in rules_runtime or "applyRules" not in rules_runtime:
        failures.append("Deterministic rules runtime is incomplete.")
    attachment_actions_path = project / "src/app/attachments/actions.ts"
    attachment_actions = attachment_actions_path.read_text(encoding="utf-8") if attachment_actions_path.is_file() else ""
    if 'requirePermission(entityKey, "update")' not in attachment_actions or "recordAuditEvent" not in attachment_actions:
        failures.append("Attachment mutations are missing authorization or audit enforcement.")
    attachment_route_path = project / "src/app/attachments/[id]/route.ts"
    attachment_route = attachment_route_path.read_text(encoding="utf-8") if attachment_route_path.is_file() else ""
    if "hasPermission" not in attachment_route or '"X-Content-Type-Options": "nosniff"' not in attachment_route:
        failures.append("Attachment downloads are missing authorization or safe download headers.")
    views_path = project / "src/app/views/[view]/page.tsx"
    views_source = views_path.read_text(encoding="utf-8") if views_path.is_file() else ""
    for invariant in ("requireViewAccess", "TableView", "KanbanView", "CalendarView", "DashboardView"):
        if invariant not in views_source:
            failures.append(f"Named view runtime is missing: {invariant}.")
    operations_path = project / "src/app/record-operations/actions.ts"
    operations_source = operations_path.read_text(encoding="utf-8") if operations_path.is_file() else ""
    for invariant in ("bulkSetRecordsAction", "moveRecordAction", "rescheduleRecordAction", "requirePermission", "applyRules", "recordAuditEvent", "withTransaction"):
        if invariant not in operations_source:
            failures.append(f"Operational view runtime is missing: {invariant}.")
    repository_path = project / "src/lib/repository.ts"
    repository_source = repository_path.read_text(encoding="utf-8") if repository_path.is_file() else ""
    if "countFilteredRecords" not in repository_source or "OFFSET" not in repository_source:
        failures.append("Record lists are missing database-backed pagination.")
    assistant_route_path = project / "src/app/api/assistant/route.ts"
    assistant_route = assistant_route_path.read_text(encoding="utf-8") if assistant_route_path.is_file() else ""
    for invariant in ("getCurrentUser", "canUseApplicationAssistant", "validateUIMessages", "createAgentUIStreamResponse", "saveAiMessages"):
        if invariant not in assistant_route:
            failures.append(f"Application assistant route is missing: {invariant}.")
    assistant_tools_path = project / "src/features/ai/tools.ts"
    assistant_tools = assistant_tools_path.read_text(encoding="utf-8") if assistant_tools_path.is_file() else ""
    for invariant in ("hasPermission", "countFilteredRecords", "listRecords", "getRecord"):
        if invariant not in assistant_tools:
            failures.append(f"Application assistant tools are missing: {invariant}.")
    migration_runner_path = project / "scripts/apply-migrations.mjs"
    migration_runner = migration_runner_path.read_text(encoding="utf-8") if migration_runner_path.is_file() else ""
    if 'resolve("database/custom")' not in migration_runner:
        failures.append("Migration runner does not include custom feature migrations.")
    production_adapter_path = project / "src/features/auth/adapter.ts"
    production_adapter = production_adapter_path.read_text(encoding="utf-8") if production_adapter_path.is_file() else ""
    for invariant in ("auth()", "currentUser()", "emailVerified"):
        if invariant not in production_adapter:
            failures.append(f"Production authentication adapter is missing: {invariant}.")
    production_auth_path = project / "src/features/auth/invitations.ts"
    production_auth = production_auth_path.read_text(encoding="utf-8") if production_auth_path.is_file() else ""
    if "createInvitation" not in production_auth or "ignoreExisting" not in production_auth:
        failures.append("Production invitation delivery is incomplete.")
    proxy_path = project / "src/proxy.ts"
    proxy_source = proxy_path.read_text(encoding="utf-8") if proxy_path.is_file() else ""
    if "clerkMiddleware" not in proxy_source:
        failures.append("Clerk middleware is missing from the Next.js proxy.")
    package_path = project / "package.json"
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
        if "next" not in package.get("dependencies", {}):
            failures.append("Next.js runtime dependency is missing.")
        if "db:smoke" not in package.get("scripts", {}):
            failures.append("Generic database smoke command is missing.")
        if "exceljs" not in package.get("dependencies", {}):
            failures.append("Excel import/export dependency is missing.")
        for dependency in ("ai", "@ai-sdk/react", "@ai-sdk/openai", "zod"):
            if dependency not in package.get("dependencies", {}):
                failures.append(f"Application assistant dependency is missing: {dependency}.")
        if "@clerk/nextjs" not in package.get("dependencies", {}):
            failures.append("Clerk authentication dependency is missing.")
        if "auth:bootstrap" not in package.get("scripts", {}):
            failures.append("Production administrator bootstrap command is missing.")
    except (OSError, json.JSONDecodeError) as error:
        failures.append(f"Cannot read package.json: {error}")

    if failures:
        print("Scaffold verification failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print(f"Scaffold verified: {project}")
    print(f"Checks: {len(EXPECTED_FILES)} required files, schema, SQL, runtime, permissions, relationships, gates")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
