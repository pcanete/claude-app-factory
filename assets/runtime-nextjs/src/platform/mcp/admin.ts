import type { PoolClient } from "pg";
import { sql, transactionSql } from "@/lib/db";
import { connectionSlug } from "@/platform/mcp/connection";

export type ManagedAgent = {
  id: string;
  name: string;
  role_key: string;
  role_label: string;
  scopes: string[];
  active: boolean;
  expires_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
  event_count: string;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_active: boolean | null;
};

export type AgentEvent = {
  id: string;
  agent_name: string;
  tool_name: string;
  entity_key: string | null;
  input_summary: Record<string, unknown>;
  status: "running" | "completed" | "failed";
  result_count: number | null;
  duration_ms: number | null;
  error_message: string | null;
  started_at: Date;
};

export type ManagedAgentInput = {
  name: string;
  roleKey: string;
  scopes: string[];
  tokenHash: string;
  expiresAt: string;
  /** Quién responde por lo que haga esta credencial. Obligatorio. */
  ownerUserId: string;
  /** Quién la emitió. Puede diferir del responsable. */
  createdByUserId: string;
};

export type ManagedAgentForUpdate = {
  id: string;
  name: string;
  active: boolean;
};

export function isManagedAgentId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Un agente no se crea sin responsable.
 *
 * La credencial actúa con un rol, pero el rol no se hace cargo de nada: las personas sí.
 * Sin esta columna, una credencial que borra algo de madrugada deja un rastro que dice
 * qué agente fue y no a quién preguntarle.
 */
export async function createManagedAgent(client: PoolClient, input: ManagedAgentInput) {
  const responsable = await transactionSql<{ id: string; active: boolean }>(
    client,
    "SELECT id, active FROM app_user WHERE id = $1",
    [input.ownerUserId],
  );
  if (!responsable[0]) throw new Error("El responsable indicado no existe.");
  if (!responsable[0].active) {
    throw new Error("El responsable de un agente tiene que ser una persona activa.");
  }
  const rows = await transactionSql<{ id: string }>(
    client,
    `INSERT INTO app_agent (name, token_hash, role_key, scopes, expires_at, owner_user_id, created_by_user_id)
     VALUES ($1, $2, $3, $4::text[], $5, $6, $7)
     RETURNING id`,
    [
      input.name, input.tokenHash, input.roleKey, input.scopes, input.expiresAt,
      input.ownerUserId, input.createdByUserId,
    ],
  );
  return rows[0].id;
}

/** Cambia quién responde por un agente. Queda auditado como `agent_owner`. */
export async function setManagedAgentOwner(client: PoolClient, id: string, ownerUserId: string) {
  const responsable = await transactionSql<{ id: string; active: boolean; display_name: string }>(
    client,
    "SELECT id, active, display_name FROM app_user WHERE id = $1",
    [ownerUserId],
  );
  if (!responsable[0]) throw new Error("El responsable indicado no existe.");
  if (!responsable[0].active) {
    throw new Error("El responsable de un agente tiene que ser una persona activa.");
  }
  const filas = await transactionSql<{ id: string }>(
    client,
    "UPDATE app_agent SET owner_user_id = $2, updated_at = now() WHERE id = $1 RETURNING id",
    [id, ownerUserId],
  );
  return filas[0] ? responsable[0].display_name : null;
}

export async function getManagedAgentForUpdate(client: PoolClient, id: string) {
  const rows = await transactionSql<ManagedAgentForUpdate>(
    client,
    `SELECT id, name, active
       FROM app_agent
      WHERE id = $1
      FOR UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

export async function setManagedAgentActive(client: PoolClient, id: string, active: boolean) {
  await transactionSql(
    client,
    `UPDATE app_agent
        SET active = $2,
            updated_at = now()
      WHERE id = $1`,
    [id, active],
  );
}

/**
 * Elimina una conexión que nunca se usó.
 *
 * Revocar y eliminar no son lo mismo, y la diferencia la marca el historial. Una
 * credencial que ya operó tiene actividad y auditoría colgando: borrarla dejaría
 * huérfano el registro de lo que hizo, que es justo lo que la auditoría existe para
 * conservar -- por eso `app_agent_event` la retiene con `ON DELETE RESTRICT`. Esa
 * credencial se revoca, y queda inactiva con su historia a la vista.
 *
 * Una credencial que nunca se usó no tiene nada que conservar: es un nombre y un
 * hash. Ésa sí se puede sacar de la lista, y tenerla ahí para siempre sólo hace más
 * difícil leer las que importan.
 */
export async function deleteManagedAgent(client: PoolClient, id: string) {
  const usos = await transactionSql<{ eventos: number; auditoria: number; mutaciones: number }>(
    client,
    `SELECT
       (SELECT count(*)::int FROM app_agent_event WHERE agent_id = $1) AS eventos,
       (SELECT count(*)::int FROM app_audit_log WHERE agent_id = $1) AS auditoria,
       (SELECT count(*)::int FROM app_agent_mutation WHERE agent_id = $1) AS mutaciones`,
    [id],
  );
  const historial = (usos[0]?.eventos ?? 0) + (usos[0]?.auditoria ?? 0) + (usos[0]?.mutaciones ?? 0);
  if (historial > 0) return { eliminado: false as const, historial };

  const filas = await transactionSql<{ id: string; name: string }>(
    client,
    "DELETE FROM app_agent WHERE id = $1 RETURNING id, name",
    [id],
  );
  return { eliminado: Boolean(filas[0]), historial: 0, nombre: filas[0]?.name };
}

export async function listManagedAgents() {
  return sql<ManagedAgent>(
    `SELECT agent.id,
            agent.name,
            agent.role_key,
            role.label AS role_label,
            agent.scopes,
            agent.active,
            agent.expires_at,
            agent.last_used_at,
            agent.created_at,
            COUNT(event.id)::text AS event_count,
            agent.owner_user_id,
            responsable.display_name AS owner_name,
            responsable.active AS owner_active
       FROM app_agent AS agent
       JOIN app_role AS role ON role.key = agent.role_key
       LEFT JOIN app_agent_event AS event ON event.agent_id = agent.id
       LEFT JOIN app_user AS responsable ON responsable.id = agent.owner_user_id
      GROUP BY agent.id, role.label, responsable.display_name, responsable.active
      ORDER BY agent.active DESC, agent.name ASC`,
  );
}

export async function countAgentEvents() {
  const filas = await sql<{ total: number }>("SELECT count(*)::int AS total FROM app_agent_event");
  return filas[0]?.total ?? 0;
}

/**
 * La actividad de agentes es el listado que más rápido crece de la aplicación: una
 * fila por cada llamada MCP. Sin paginar, la pantalla se vuelve un rollo infinito y
 * la consulta trae cientos de filas para mostrar las primeras diez.
 */
export async function listAgentEvents({ limit = 25, offset = 0 } = {}) {
  return sql<AgentEvent>(
    `SELECT event.id,
            agent.name AS agent_name,
            event.tool_name,
            event.entity_key,
            event.input_summary,
            event.status,
            event.result_count,
            event.duration_ms,
            event.error_message,
            event.started_at
       FROM app_agent_event AS event
       JOIN app_agent AS agent ON agent.id = event.agent_id
      ORDER BY event.started_at DESC
      LIMIT $1 OFFSET $2`,
    [Math.min(200, Math.max(1, limit)), Math.max(0, offset)],
  );
}
