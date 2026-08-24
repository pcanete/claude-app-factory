"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createManagedAgent,
  deleteManagedAgent,
  setManagedAgentOwner,
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

// La configuración del sistema no es "un poco más de datos": es la superficie que
// cambia cómo se comporta la aplicación. Por eso no viene incluida en el nivel más
// alto de acceso a registros -- se elige aparte y a propósito. Aun elegida, sólo
// sirve si además el rol tiene la capacidad administrativa.
const accessScopes = {
  read: ["schema:read", "records:read"],
  write: ["schema:read", "records:read", "records:write"],
  full: ["schema:read", "records:read", "records:write", "records:delete"],
  admin: [
    "schema:read",
    "records:read",
    "records:write",
    "records:delete",
    "settings:read",
    "settings:write",
  ],
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
  // Por defecto responde quien lo crea. Se puede designar a otra persona, pero nunca
  // puede quedar sin responsable: un agente es la extensión de alguien, no un sujeto.
  const ownerUserId = String(formData.get("owner_user_id") ?? "").trim() || actor.id;
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
        ownerUserId,
        createdByUserId: actor.id,
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

export async function deleteAgentAction(formData: FormData) {
  const actor = await requireUserManagementAccess();
  const id = String(formData.get("id") ?? "");
  if (!isManagedAgentId(id)) redirect("/agents?error=not_found");
  const resultado = await withTransaction(async (client) => {
    const before = await getManagedAgentForUpdate(client, id);
    if (!before) return { estado: "not_found" as const };
    const borrado = await deleteManagedAgent(client, id);
    if (!borrado.eliminado) return { estado: "con_historial" as const };
    // La eliminación queda registrada aunque la conexión ya no exista: el `record_id`
    // apunta a algo que se fue, y eso es exactamente lo que hay que poder ver.
    await recordAuditEvent(client, {
      actorId: actor.id,
      entityKey: "app_agent",
      recordId: id,
      action: "agent_status",
      changes: { name: before.name, eliminada: true },
    });
    return { estado: "ok" as const };
  });
  if (resultado.estado === "not_found") redirect("/agents?error=not_found");
  if (resultado.estado === "con_historial") redirect("/agents?error=con_historial");
  refreshAgents();
  redirect("/agents?saved=deleted");
}

export async function setAgentOwnerAction(formData: FormData) {
  const actor = await requireUserManagementAccess();
  const id = String(formData.get("id") ?? "");
  const ownerUserId = String(formData.get("owner_user_id") ?? "");
  if (!isManagedAgentId(id) || !isManagedAgentId(ownerUserId)) redirect("/agents?error=not_found");
  const nombre = await withTransaction(async (client) => {
    const before = await getManagedAgentForUpdate(client, id);
    if (!before) return null;
    const asignado = await setManagedAgentOwner(client, id, ownerUserId);
    if (!asignado) return null;
    await recordAuditEvent(client, {
      actorId: actor.id,
      entityKey: "app_agent",
      recordId: id,
      action: "agent_owner",
      changes: { name: before.name, responsable: asignado },
    });
    return asignado;
  });
  if (!nombre) redirect("/agents?error=not_found");
  refreshAgents();
  redirect("/agents?saved=owner");
}
