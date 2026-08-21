import type { PoolClient } from "pg";
import { sql, transactionSql } from "@/lib/db";

export type AuditAction =
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
  | "application_settings_update";

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
    recordId: string;
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

export async function listAuditEvents(filters: { entityKey?: string; action?: AuditAction }) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.entityKey) {
    values.push(filters.entityKey);
    conditions.push(`log.entity_key = $${values.length}`);
  }
  if (filters.action) {
    values.push(filters.action);
    conditions.push(`log.action = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
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
      LIMIT 200`,
    values,
  );
}
