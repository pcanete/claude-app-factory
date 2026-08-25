#!/usr/bin/env python3
"""Verify observable invariants of a generated application foundation."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scaffold_app import validate_spec


EXPECTED_FILES = {
    "app-spec.json",
    "BUILD_REPORT.md",
    "platform-manifest.json",
    "database/generated/001_initial.sql",
    "database/custom/EXTENSIONS.md",
    "database/platform/OWNERSHIP.md",
    "database/platform/110_user_management.sql",
    "database/platform/120_clerk_authentication.sql",
    "database/platform/130_application_settings.sql",
    "src/generated/app-spec.ts",
    "src/generated/navigation.ts",
    "src/generated/permissions.ts",
    "src/features/EXTENSIONS.md",
    "src/platform/OWNERSHIP.md",
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
    "src/app/settings/actions.ts",
    "src/app/settings/page.tsx",
    "src/components/settings-editor.tsx",
    "database/platform/160_retirar_asistente.sql",
    "database/platform/170_actor_de_configuracion.sql",
    "database/platform/180_responsable_humano.sql",
    "src/app/views/[view]/page.tsx",
    "src/app/attachments/actions.ts",
    "src/app/attachments/[id]/route.ts",
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
    "src/platform/auth/adapter.ts",
    "src/platform/auth/config.ts",
    "src/platform/auth/invitations.ts",
    "src/platform/settings/store.ts",
    "src/platform/users/store.ts",
    "src/lib/auth-types.ts",
    "src/lib/connection.ts",
    "src/lib/auth.ts",
    "src/lib/audit.ts",
    "src/lib/attachments.ts",
    "src/lib/data-transfer.ts",
    "src/lib/import-batches.ts",
    "src/lib/repository.ts",
    "src/lib/runtime-access.ts",
    "src/lib/rules.ts",
    "src/lib/view-query.ts",
    ".github/workflows/backup.yml",
    "database/platform/140_mcp_agents.sql",
    "database/platform/150_mcp_write.sql",
    "src/app/agents/actions.ts",
    "src/app/agents/page.tsx",
    "src/components/agent-create-form.tsx",
    "src/app/api/mcp/route.ts",
    "src/app/.well-known/oauth-authorization-server/route.ts",
    "src/app/.well-known/oauth-protected-resource/api/mcp/route.ts",
    "src/platform/mcp/oauth.ts",
    "src/platform/mcp/access.ts",
    "src/platform/mcp/admin.ts",
    "src/platform/mcp/mutations.ts",
    "src/platform/mcp/server.ts",
    "src/platform/mcp/store.ts",
    "scripts/create-agent-token.mjs",
    "scripts/smoke-mcp-write.mjs",
    "scripts/db-connection.mjs",
    "scripts/apply-migrations.mjs",
    "scripts/destructive-guard.mjs",
    "scripts/prune-audit.mjs",
    "scripts/test-record-access.mjs",
    "src/lib/record-access.ts",
    "scripts/test-destructive-guard.mjs",
    "scripts/bootstrap-admin.mjs",
    "scripts/smoke-crud.mjs",
    "scripts/vercel-build.mjs",
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
    if "requireAuditAccess" not in audit_page or "listActivityEvents" not in audit_page:
        failures.append("Audit history page is missing its server-side access or data check.")

    # Un solo registro. Lo que hace una persona y lo que hace un agente son la misma
    # historia: separarlos obliga a reconstruirla a mano y esconde de quien depende cada
    # agente.
    audit_lib_path = project / "src/lib/audit.ts"
    audit_lib = audit_lib_path.read_text(encoding="utf-8") if audit_lib_path.is_file() else ""
    if "UNION ALL" not in audit_lib or "app_agent_event" not in audit_lib:
        failures.append("Activity is not unified: the audit log and agent tool events are read separately.")
    if "responsible_user_id" not in audit_lib:
        failures.append("Activity entries do not carry the responsible person.")

    # Un agente es la extension de alguien: no se emite una credencial sin responsable.
    agent_admin_path = project / "src/platform/mcp/admin.ts"
    agent_admin = agent_admin_path.read_text(encoding="utf-8") if agent_admin_path.is_file() else ""
    if "ownerUserId" not in agent_admin or "owner_user_id" not in agent_admin:
        failures.append("Managed agents can be created without a human owner.")
    agent_cli_path = project / "scripts/create-agent-token.mjs"
    agent_cli = agent_cli_path.read_text(encoding="utf-8") if agent_cli_path.is_file() else ""
    if "owner_user_id" not in agent_cli:
        failures.append("The agent CLI issues credentials without a responsible person.")

    # El calendario mantiene sus eventos en estado del cliente para poder moverlos sin
    # recargar. Sin una `key` atada al mes, React reutiliza la instancia al navegar y
    # muestra los eventos del mes anterior hasta que alguien recarga a mano.
    views_page_path = project / "src/app/views/[view]/page.tsx"
    views_page = views_page_path.read_text(encoding="utf-8") if views_page_path.is_file() else ""
    if "key={`${view.key}-${monthKey(selected.year, selected.month)}`}" not in views_page:
        failures.append("The calendar does not remount when the month changes: it will show stale events.")

    # El alcance por registro se resuelve en SQL. Filtrar despues de traer las filas deja
    # el conteo y la paginacion contando lo que la persona no puede ver.
    repository_path = project / "src/lib/repository.ts"
    repository = repository_path.read_text(encoding="utf-8") if repository_path.is_file() else ""
    if "recordAccessCondition" not in repository:
        failures.append("Record-level access is not applied inside the SQL queries.")
    access_path = project / "src/lib/record-access.ts"
    access_source = access_path.read_text(encoding="utf-8") if access_path.is_file() else ""
    if "throw new Error" not in access_source or "recordAccessForAgent" not in access_source:
        failures.append("Record-level access does not fail closed for missing identities or agent owners.")
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
    repository_filters = (project / "src/lib/repository.ts").read_text(encoding="utf-8")
    # Sin filtro por relacion no hay forma de pedir los registros que cuelgan de otro,
    # ni desde la interfaz ni desde el MCP.
    if "relationColumns" not in repository_filters:
        failures.append("Records cannot be filtered by the record they belong to.")

    repository_path = project / "src/lib/repository.ts"
    repository_source = repository_path.read_text(encoding="utf-8") if repository_path.is_file() else ""
    if "countFilteredRecords" not in repository_source or "OFFSET" not in repository_source:
        failures.append("Record lists are missing database-backed pagination.")
    settings_actions_path = project / "src/app/settings/actions.ts"
    settings_actions = settings_actions_path.read_text(encoding="utf-8") if settings_actions_path.is_file() else ""
    for invariant in ("setSetting", "deleteSetting", "requireUserManagementAccess", "recordAuditEvent", "withTransaction"):
        if invariant not in settings_actions:
            failures.append(f"System configuration actions are missing: {invariant}.")
    settings_migration_path = project / "database/platform/130_application_settings.sql"
    settings_migration = settings_migration_path.read_text(encoding="utf-8") if settings_migration_path.is_file() else ""
    for invariant in ("app_setting", "app_user_setting"):
        if invariant not in settings_migration:
            failures.append(f"System configuration migration is missing: {invariant}.")
    # La 130 conserva su forma publicada: una migracion aplicada no se edita, ni
    # siquiera para retirar lo que dejo de usarse. Eso lo hace la siguiente.
    retiro_path = project / "database/platform/160_retirar_asistente.sql"
    retiro = retiro_path.read_text(encoding="utf-8") if retiro_path.is_file() else ""
    for invariant in ("DROP TABLE IF EXISTS app_user_secret", "DROP TABLE IF EXISTS ai_conversation"):
        if invariant not in retiro:
            failures.append(f"Assistant retirement migration is missing: {invariant}.")
    migration_runner_path = project / "scripts/apply-migrations.mjs"
    migration_runner = migration_runner_path.read_text(encoding="utf-8") if migration_runner_path.is_file() else ""
    if 'resolve("database/custom")' not in migration_runner:
        failures.append("Migration runner does not include custom feature migrations.")
    production_adapter_path = project / "src/platform/auth/adapter.ts"
    production_adapter = production_adapter_path.read_text(encoding="utf-8") if production_adapter_path.is_file() else ""
    for invariant in ("auth()", "currentUser()", "emailVerified"):
        if invariant not in production_adapter:
            failures.append(f"Production authentication adapter is missing: {invariant}.")
    for script_name in ("apply-migrations.mjs", "bootstrap-admin.mjs", "smoke-crud.mjs",
                        "create-agent-token.mjs", "smoke-mcp-write.mjs"):
        script_path = project / "scripts" / script_name
        script_source = script_path.read_text(encoding="utf-8") if script_path.is_file() else ""
        # Un script que arma la conexion por su cuenta se saltea el TLS y la convencion
        # POSTGRES_URL, y falla contra cualquier PostgreSQL gestionado.
        if "db-connection.mjs" not in script_source:
            failures.append(f"{script_name} does not use the shared connection resolver.")

    bootstrap_path = project / "scripts/bootstrap-admin.mjs"
    bootstrap = bootstrap_path.read_text(encoding="utf-8") if bootstrap_path.is_file() else ""
    if "manage_users" not in bootstrap or "app-spec.json" not in bootstrap:
        failures.append(
            "First administrator does not derive its role from the AppSpec; a neutral application "
            "must not require a role named 'admin'."
        )
    if "'admin'" in bootstrap or '"admin"' in bootstrap:
        failures.append("First administrator hard-codes an 'admin' role name.")

    production_auth_path = project / "src/platform/auth/invitations.ts"
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
        if "zod" not in package.get("dependencies", {}):
            failures.append("Schema validation dependency is missing.")
        for retirada in ("ai", "@ai-sdk/react", "@ai-sdk/openai", "@ai-sdk/anthropic"):
            if retirada in package.get("dependencies", {}):
                failures.append(f"The runtime no longer runs models: {retirada} should not be a dependency.")
        if "@clerk/nextjs" not in package.get("dependencies", {}):
            failures.append("Clerk authentication dependency is missing.")
        if "auth:bootstrap" not in package.get("scripts", {}):
            failures.append("Production administrator bootstrap command is missing.")
        if "vercel-build" not in package.get("scripts", {}):
            failures.append("Production migration build command is missing.")
    except (OSError, json.JSONDecodeError) as error:
        failures.append(f"Cannot read package.json: {error}")

    mcp_migration_path = project / "database/platform/140_mcp_agents.sql"
    mcp_migration = mcp_migration_path.read_text(encoding="utf-8") if mcp_migration_path.is_file() else ""
    for invariant in ("app_agent", "token_hash", "app_agent_event", "records:read"):
        if invariant not in mcp_migration:
            failures.append(f"MCP agent migration is missing: {invariant}.")
    mcp_write_migration_path = project / "database/platform/150_mcp_write.sql"
    mcp_write_migration = mcp_write_migration_path.read_text(encoding="utf-8") if mcp_write_migration_path.is_file() else ""
    for invariant in ("records:write", "records:delete", "app_agent_mutation", "agent_event_id"):
        if invariant not in mcp_write_migration:
            failures.append(f"MCP write migration is missing: {invariant}.")
    mcp_route_path = project / "src/app/api/mcp/route.ts"
    mcp_route = mcp_route_path.read_text(encoding="utf-8") if mcp_route_path.is_file() else ""
    for invariant in ("authenticateAgentToken", "createMcpHandler", "authorization", "factoryAgent"):
        if invariant not in mcp_route:
            failures.append(f"MCP endpoint is missing: {invariant}.")
    mcp_server_path = project / "src/platform/mcp/server.ts"
    mcp_server = mcp_server_path.read_text(encoding="utf-8") if mcp_server_path.is_file() else ""
    for invariant in ("list_entities", "describe_entity", "query_records", "get_record", "export_snapshot", "startAgentToolEvent"):
        if invariant not in mcp_server:
            failures.append(f"MCP read tool surface is missing: {invariant}.")
    # Descubrir el esquema y escribir tienen que hablar el mismo idioma: si
    # describe_entity dice `client` y create_record exige `client_id`, un agente que
    # lee la estructura y despues escribe segun lo que leyo falla.
    # Un cliente remoto no puede recibir un token pegado a mano: necesita descubrir
    # donde autenticarse, y el middleware no debe interceptar ese descubrimiento.
    if "resource_metadata" not in mcp_route:
        failures.append("MCP 401 does not point to its resource metadata, so remote clients cannot start OAuth.")
    if '/.well-known/' not in proxy_source:
        failures.append("The proxy intercepts OAuth discovery, which must be served without credentials.")
    oauth_source = (project / "src/platform/mcp/oauth.ts").read_text(encoding="utf-8")
    # Probar la identidad no es autorizarla: el rol y el estado salen de la aplicacion.
    if "app_user" not in oauth_source:
        failures.append("OAuth identity is not mapped to an application user, so Clerk identity alone would grant access.")
    if "inactivo" not in oauth_source and "active" not in oauth_source:
        failures.append("OAuth identity does not check whether the application user is active.")
    if "USER_SCOPES" not in oauth_source:
        failures.append("OAuth identity does not declare its scopes.")

    if "filterableFields" not in mcp_server:
        failures.append("MCP query_records discards relationship filters, so agents cannot scope by owner record.")
    if "writeAs" not in mcp_server:
        failures.append(
            "MCP describe_entity does not declare how a relationship is written, so discovery and writing disagree."
        )
    repository_path = project / "src/lib/repository.ts"
    repository_source = repository_path.read_text(encoding="utf-8") if repository_path.is_file() else ""
    if "relationship.key, `${relationship.key}_id`" not in repository_source:
        failures.append("Record input does not accept both the relationship key and its column name.")

    for invariant in ("list_attachments", "read_attachment"):
        if invariant not in mcp_server:
            failures.append(f"MCP does not expose record files to agents: {invariant}.")
    if "requireAgentPermission(agent, file.entity_key" not in mcp_server:
        failures.append(
            "MCP file reads must resolve permission on the owning entity, so a known id cannot bypass the matrix."
        )
    for invariant in ("create_record", "update_record", "delete_record", "executeIdempotentMutation", "recordAuditEvent", "applyRules"):
        if invariant not in mcp_server:
            failures.append(f"MCP write tool surface is missing: {invariant}.")
    agent_page_path = project / "src/app/agents/page.tsx"
    agent_page = agent_page_path.read_text(encoding="utf-8") if agent_page_path.is_file() else ""
    actions_path = project / "src/app/agents/actions.ts"
    agent_actions = actions_path.read_text(encoding="utf-8") if actions_path.is_file() else ""
    # Crear un agente con un rol es delegarle ese rol: si bastara con leer la auditoria,
    # un rol de solo lectura podria fabricarse una credencial de administrador.
    if "requireUserManagementAccess" not in agent_actions:
        failures.append(
            "Agent credentials can be issued without the user-management capability, which allows privilege escalation."
        )
    if "randomBytes" not in agent_actions or "createHash" not in agent_actions:
        failures.append("Agent tokens must be generated randomly and stored only as a hash.")
    for invariant in ("requireUserManagementAccess", "listManagedAgents", "listAgentEvents"):
        if invariant not in agent_page:
            failures.append(f"Agent activity page is missing: {invariant}.")
    migration_runner_path = project / "scripts/apply-migrations.mjs"
    migration_runner = migration_runner_path.read_text(encoding="utf-8") if migration_runner_path.is_file() else ""
    if 'resolve("database/custom")' not in migration_runner:
        failures.append("Migration runner does not include custom feature migrations.")
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
        if "zod" not in package.get("dependencies", {}):
            failures.append("Schema validation dependency is missing.")
        for retirada in ("ai", "@ai-sdk/react", "@ai-sdk/openai", "@ai-sdk/anthropic"):
            if retirada in package.get("dependencies", {}):
                failures.append(f"The runtime no longer runs models: {retirada} should not be a dependency.")
        if "@clerk/nextjs" not in package.get("dependencies", {}):
            failures.append("Clerk authentication dependency is missing.")
        if "@modelcontextprotocol/server" not in package.get("dependencies", {}):
            failures.append("MCP server dependency is missing.")
        if "@modelcontextprotocol/client" not in package.get("devDependencies", {}):
            failures.append("MCP interoperability test client is missing.")
        if "auth:bootstrap" not in package.get("scripts", {}):
            failures.append("Production administrator bootstrap command is missing.")
        if "mcp:agent:create" not in package.get("scripts", {}):
            failures.append("MCP agent bootstrap command is missing.")
        if "mcp:smoke:write" not in package.get("scripts", {}):
            failures.append("MCP write interoperability smoke command is missing.")
        if "vercel-build" not in package.get("scripts", {}):
            failures.append("Production migration build command is missing.")
    except (OSError, json.JSONDecodeError) as error:
        failures.append(f"Cannot read package.json: {error}")

    settings_store = (project / "src/platform/settings/store.ts").read_text(encoding="utf-8")
    # La configuracion es una primitiva del sistema: si deja de validar nombres o
    # tamano, se convierte en almacenamiento sin control.
    for invariant in ("listSettings", "setSetting", "deleteSetting", "MAXIMO_BYTES"):
        if invariant not in settings_store:
            failures.append(f"Settings primitive is missing: {invariant}.")
    for invariant in ("list_settings", "get_setting", "set_setting", "delete_setting"):
        if invariant not in mcp_server:
            failures.append(f"MCP does not expose system configuration: {invariant}.")
    if "manage_users" not in mcp_server:
        failures.append("MCP settings writes are not gated by an administrative capability.")
    # La navegacion no puede depender de la hoja de estilos para EXISTIR. Con un
    # `details` cerrado el navegador esconde los enlaces por su cuenta y solo el CSS
    # los devuelve; si esa hoja tarda o llega vieja -- un despliegue a mitad de camino
    # alcanza -- el menu entero desaparece. Paso en produccion. Con una casilla, lo que
    # esconde vive en el CSS: si el CSS falta, no esconde nada.
    sidebar_path = project / "src/components/sidebar.tsx"
    sidebar = sidebar_path.read_text(encoding="utf-8") if sidebar_path.is_file() else ""
    if "<details" in sidebar:
        failures.append("Sidebar navigation must not rely on <details>: without CSS the menu disappears.")
    if 'className="nav-switch"' not in sidebar:
        failures.append("Sidebar navigation is missing the nav-switch collapse control.")

    # Los desplegables de contenido llevan `white-space: nowrap`. Sin acotar a `.main`
    # esa regla tambien alcanzaba al encabezado del menu y le impedia cortar linea: la
    # descripcion se salia de la barra y pisaba la pagina.
    estilos_path = project / "src/app/globals.css"
    estilos = estilos_path.read_text(encoding="utf-8") if estilos_path.is_file() else ""
    for linea in estilos.splitlines():
        despojada = linea.strip()
        if despojada.startswith("details summary") or despojada.startswith("details > summary"):
            failures.append("The `details summary` rule must be scoped to `.main` so it cannot reach the sidebar.")

    # El asistente interno se retiro: el sistema no ejecuta modelos ni custodia
    # credenciales de proveedores ajenos.
    for retirado in ("src/platform/ai", "src/app/assistant", "src/app/api/assistant"):
        if (project / retirado).exists():
            failures.append(f"The internal assistant was removed but {retirado} is still generated.")

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
