import type { PoolClient } from "pg";
import { sql, transactionSql } from "@/lib/db";

export type AuditAction =
  | "setting_save"
  | "setting_delete"
  | "create"
  | "update"
  | "delete"
  | "attachment_create"
  | "attachment_delete"
  | "user_create"
  | "user_update"
  | "user_status"
  | "user_invite"
  | "user_link"
  | "ai_credential_save"
  | "ai_credential_remove"
  | "ai_preference_update"
  | "application_settings_update"
  | "agent_create"
  | "agent_status";

export type AuditEvent = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  agent_id: string | null;
  agent_name: string | null;
  entity_key: string;
  record_id: string | null;
  action: AuditAction;
  changes: unknown;
  created_at: Date;
};

export async function recordAuditEvent(
  client: PoolClient,
  event: {
    actorId?: string;
    agentId?: string;
    agentEventId?: string;
    entityKey: string;
    recordId: string | null;
    action: AuditAction;
    changes: unknown;
  },
) {
  if (Boolean(event.actorId) === Boolean(event.agentId)) {
    throw new Error("La auditoría requiere exactamente una identidad humana o de agente.");
  }
  await transactionSql(
    client,
    `INSERT INTO app_audit_log (actor_id, agent_id, agent_event_id, entity_key, record_id, action, changes)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      event.actorId ?? null,
      event.agentId ?? null,
      event.agentEventId ?? null,
      event.entityKey,
      event.recordId,
      event.action,
      JSON.stringify(event.changes),
    ],
  );
}

export type AuditFilters = { entityKey?: string; action?: AuditAction };

function auditWhere(filters: AuditFilters, values: unknown[]) {
  const conditions: string[] = [];
  if (filters.entityKey) {
    values.push(filters.entityKey);
    conditions.push(`log.entity_key = $${values.length}`);
  }
  if (filters.action) {
    values.push(filters.action);
    conditions.push(`log.action = $${values.length}`);
  }
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

export async function countAuditEvents(filters: AuditFilters) {
  const values: unknown[] = [];
  const where = auditWhere(filters, values);
  const filas = await sql<{ total: number }>(
    `SELECT count(*)::int AS total FROM app_audit_log AS log ${where}`,
    values,
  );
  return filas[0]?.total ?? 0;
}

export async function listAuditEvents(
  filters: AuditFilters & { limit?: number; offset?: number } = {},
) {
  const values: unknown[] = [];
  const where = auditWhere(filters, values);
  values.push(filters.limit ?? 50);
  const limitPlaceholder = `$${values.length}`;
  values.push(filters.offset ?? 0);
  const offsetPlaceholder = `$${values.length}`;
  return sql<AuditEvent>(
    `SELECT log.id,
            log.actor_id,
            actor.display_name AS actor_name,
            actor.email AS actor_email,
            log.agent_id,
            agent.name AS agent_name,
            log.entity_key,
            log.record_id,
            log.action,
            log.changes,
            log.created_at
       FROM app_audit_log AS log
       LEFT JOIN app_user AS actor ON actor.id = log.actor_id
       LEFT JOIN app_agent AS agent ON agent.id = log.agent_id
       ${where}
      ORDER BY log.created_at DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    values,
  );
}

/**
 * Retención: la auditoría no se borra a mano, se vence.
 *
 * Un registro que un administrador puede recortar registro por registro deja de ser
 * evidencia -- justo lo que un administrador querría borrar es lo que más importa que
 * quede. Pero crecer sin techo tampoco es una opción, así que la salida es una regla
 * pareja y declarada: todo lo más viejo que la ventana de retención se va, sin
 * elegir qué. La ventana vive en la configuración del sistema, así que cambiarla es
 * ella misma un cambio auditado.
 */
export const RETENCION_POR_DEFECTO_DIAS = 365;

export async function pruneAuditEvents(client: PoolClient, dias: number) {
  if (!Number.isInteger(dias) || dias < 30) {
    throw new Error("La retención de auditoría debe ser un número entero de al menos 30 días.");
  }
  const filas = await transactionSql<{ eliminados: number }>(
    client,
    `WITH borrados AS (
       DELETE FROM app_audit_log
        WHERE created_at < now() - ($1 || ' days')::interval
        RETURNING 1
     )
     SELECT count(*)::int AS eliminados FROM borrados`,
    [String(dias)],
  );
  return filas[0]?.eliminados ?? 0;
}
