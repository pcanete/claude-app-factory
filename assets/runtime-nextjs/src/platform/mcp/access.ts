import { generatedPermissions } from "@/generated/permissions";
import type { PermissionAction } from "@/lib/auth-types";
import { type EntitySpec, requireEntity, runtimeSpec } from "@/lib/spec";
import type { AgentPrincipal } from "@/platform/mcp/store";

const permissionMatrix = generatedPermissions as unknown as Record<
  string,
  Record<string, readonly PermissionAction[]>
>;

export function agentHasPermission(
  agent: AgentPrincipal,
  entityKey: string,
  action: PermissionAction,
) {
  const requiredScope = action === "delete"
    ? "records:delete"
    : action === "create" || action === "update"
      ? "records:write"
      : "records:read";
  return agent.scopes.includes(requiredScope)
    && (permissionMatrix[entityKey]?.[agent.roleKey]?.includes(action) ?? false);
}

export function requireAgentPermission(
  agent: AgentPrincipal,
  entityKey: string,
  action: PermissionAction,
): EntitySpec {
  const entity = requireEntity(entityKey);
  if (!agentHasPermission(agent, entity.key, action)) {
    throw new Error(`El agente no tiene permiso para ${action} en ${entity.key}.`);
  }
  return entity;
}

export function agentEntities(agent: AgentPrincipal) {
  if (!agent.scopes.includes("schema:read")) return [];
  return runtimeSpec.entities.filter((entity) => agentHasPermission(agent, entity.key, "list"));
}
