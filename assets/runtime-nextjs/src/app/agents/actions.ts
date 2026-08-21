"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createManagedAgent,
  getManagedAgentForUpdate,
  isManagedAgentId,
  setManagedAgentActive,
} from "@/platform/mcp/admin";
import { recordAuditEvent } from "@/lib/audit";
import { requireUserManagementAccess } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { runtimeSpec } from "@/lib/spec";

export type AgentCreateState = {
  status: "idle" | "success" | "error";
  message?: string;
  token?: string;
  agentName?: string;
};

const accessScopes = {
  read: ["schema:read", "records:read"],
  write: ["schema:read", "records:read", "records:write"],
  full: ["schema:read", "records:read", "records:write", "records:delete"],
} as const;

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function refreshAgents() {
  revalidatePath("/agents");
  revalidatePath("/audit");
}

export async function createAgentAction(
  _previous: AgentCreateState,
  formData: FormData,
): Promise<AgentCreateState> {
  const actor = await requireUserManagementAccess();
  const name = String(formData.get("name") ?? "").trim();
  const roleKey = String(formData.get("role_key") ?? "");
  const access = String(formData.get("access") ?? "write") as keyof typeof accessScopes;
  const expiresDays = Number(formData.get("expires_days") ?? 90);
  if (!name || name.length > 120) return { status: "error", message: "Ingresá un nombre de hasta 120 caracteres." };
  if (!runtimeSpec.roles.some((role) => role.key === roleKey)) return { status: "error", message: "El rol elegido no es válido." };
  if (!(access in accessScopes)) return { status: "error", message: "El nivel de acceso no es válido." };
  if (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 3650) {
    return { status: "error", message: "Elegí un vencimiento válido." };
  }

  const token = `factory_mcp_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1_000).toISOString();
  try {
    await withTransaction(async (client) => {
      const id = await createManagedAgent(client, {
        name,
        roleKey,
        scopes: [...accessScopes[access]],
        tokenHash,
        expiresAt,
      });
      await recordAuditEvent(client, {
        actorId: actor.id,
        entityKey: "app_agent",
        recordId: id,
        action: "agent_create",
        changes: { name, roleKey, access, expiresDays },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "error", message: "Ya existe una conexión con ese nombre." };
    throw error;
  }
  refreshAgents();
  return {
    status: "success",
    message: "La conexión fue creada. Copiá la credencial ahora: no volverá a mostrarse.",
    token,
    agentName: name,
  };
}

export async function setAgentStatusAction(formData: FormData) {
  const actor = await requireUserManagementAccess();
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!isManagedAgentId(id)) redirect("/agents?error=not_found");
  const changed = await withTransaction(async (client) => {
    const before = await getManagedAgentForUpdate(client, id);
    if (!before) return false;
    await setManagedAgentActive(client, id, active);
    await recordAuditEvent(client, {
      actorId: actor.id,
      entityKey: "app_agent",
      recordId: id,
      action: "agent_status",
      changes: { name: before.name, before: before.active, after: active },
    });
    return true;
  });
  if (!changed) redirect("/agents?error=not_found");
  refreshAgents();
  redirect(`/agents?saved=${active ? "reactivated" : "revoked"}`);
}
