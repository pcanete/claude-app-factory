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
  | "agent_create"
  | "agent_status"
  | "agent_owner";

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
    responsibleUserId?: string;
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
    // `responsible_user_id` puede ir vacío: un disparador lo deriva de quien actuó o
    // del responsable del agente. Se acepta explícito para los casos donde el contexto
    // conoce mejor a quién corresponde, pero no depende de que alguien se acuerde.
    `INSERT INTO app_audit_log (actor_id, agent_id, agent_event_id, responsible_user_id, entity_key, record_id, action, changes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      // `||` y no `??`: una cadena vacía tampoco es un identificador. Llegaba una desde
      // el MCP y PostgreSQL la rechazaba al convertirla a uuid, con un error que hablaba
      // de sintaxis y no de lo que realmente faltaba.
      event.actorId || null,
      event.agentId || null,
      event.agentEventId || null,
      event.responsibleUserId || null,
      event.entityKey,
      event.recordId,
      event.action,
      JSON.stringify(event.changes),
    ],
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

/**
 * Una sola línea de tiempo.
 *
 * Había dos registros que contaban mitades de la misma historia: `app_audit_log`
 * guardaba los cambios de datos y `app_agent_event` las llamadas de herramienta de los
 * agentes. Para reconstruir qué pasó había que mirar dos pantallas y ordenarlas a ojo.
 *
 * Siguen siendo dos tablas --escriben en momentos distintos y una referencia a la otra--
 * pero se leen como una. Cada entrada declara si la originó una persona o un agente, y
 * en los dos casos lleva a la persona que responde.
 */
export type ActivitySource = "human" | "agent";

export type ActivityEvent = {
  event_key: string;
  source: ActivitySource;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  agent_id: string | null;
  agent_name: string | null;
  responsible_id: string | null;
  responsible_name: string | null;
  entity_key: string | null;
  record_id: string | null;
  action: string;
  status: "completed" | "failed" | "running";
  details: unknown;
  result_count: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: Date;
};

// `event_key` lleva prefijo porque los identificadores de las dos tablas son
// independientes y podrían coincidir.
const CONSULTA_ACTIVIDAD = `
  SELECT 'cambio:' || log.id::text AS event_key,
         CASE WHEN log.agent_id IS NULL THEN 'human' ELSE 'agent' END::text AS source,
         log.actor_id, actor.display_name AS actor_name, actor.email AS actor_email,
         log.agent_id, agent.name AS agent_name,
         log.responsible_user_id AS responsible_id,
         responsable.display_name AS responsible_name,
         log.entity_key, log.record_id::text AS record_id, log.action,
         'completed'::text AS status, log.changes AS details,
         NULL::integer AS result_count, NULL::integer AS duration_ms,
         NULL::text AS error_message, log.created_at
    FROM app_audit_log AS log
    LEFT JOIN app_user  AS actor       ON actor.id = log.actor_id
    LEFT JOIN app_agent AS agent       ON agent.id = log.agent_id
    LEFT JOIN app_user  AS responsable ON responsable.id = log.responsible_user_id
  UNION ALL
  SELECT 'herramienta:' || evento.id::text AS event_key, 'agent'::text AS source,
         NULL::uuid AS actor_id, NULL::text AS actor_name, NULL::text AS actor_email,
         evento.agent_id, agent.name AS agent_name,
         evento.responsible_user_id AS responsible_id,
         responsable.display_name AS responsible_name,
         evento.entity_key, NULL::text AS record_id, evento.tool_name AS action,
         evento.status, evento.input_summary AS details,
         evento.result_count, evento.duration_ms, evento.error_message,
         evento.started_at AS created_at
    FROM app_agent_event AS evento
    JOIN app_agent AS agent ON agent.id = evento.agent_id
    LEFT JOIN app_user AS responsable ON responsable.id = evento.responsible_user_id`;

export type ActivityFilters = {
  source?: ActivitySource;
  entityKey?: string;
  action?: string;
  agentId?: string;
  responsibleId?: string;
};

function activityWhere(filters: ActivityFilters, values: unknown[]) {
  const conditions: string[] = [];
  for (const [columna, valor] of [
    ["source", filters.source],
    ["entity_key", filters.entityKey],
    ["action", filters.action],
  ] as const) {
    if (!valor) continue;
    values.push(valor);
    conditions.push(`actividad.${columna} = $${values.length}`);
  }
  for (const [columna, valor] of [
    ["agent_id", filters.agentId],
    ["responsible_id", filters.responsibleId],
  ] as const) {
    if (!valor) continue;
    values.push(valor);
    conditions.push(`actividad.${columna} = $${values.length}::uuid`);
  }
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

export async function countActivityEvents(filters: ActivityFilters = {}) {
  const values: unknown[] = [];
  const where = activityWhere(filters, values);
  const filas = await sql<{ total: number }>(
    `SELECT count(*)::int AS total FROM (${CONSULTA_ACTIVIDAD}) AS actividad ${where}`,
    values,
  );
  return filas[0]?.total ?? 0;
}

export async function listActivityEvents(
  filters: ActivityFilters & { limit?: number; offset?: number } = {},
) {
  const values: unknown[] = [];
  const where = activityWhere(filters, values);
  values.push(Math.min(200, Math.max(1, filters.limit ?? 50)));
  const limite = `$${values.length}`;
  values.push(Math.max(0, filters.offset ?? 0));
  const desplazamiento = `$${values.length}`;
  return sql<ActivityEvent>(
    `SELECT * FROM (${CONSULTA_ACTIVIDAD}) AS actividad ${where}
      ORDER BY actividad.created_at DESC
      LIMIT ${limite} OFFSET ${desplazamiento}`,
    values,
  );
}

/** Los agentes que aparecen en la actividad, para poder filtrar por uno. */
export async function listActivityAgents() {
  return sql<{ id: string; name: string }>(
    "SELECT id, name FROM app_agent ORDER BY active DESC, name ASC",
  );
}
