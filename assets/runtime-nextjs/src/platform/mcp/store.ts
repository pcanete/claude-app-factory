import { createHash } from "node:crypto";
import { sql } from "@/lib/db";

/**
 * Quién está operando por MCP.
 *
 * `agent` es una credencial emitida para un proceso sin humano detrás. `user` es una
 * persona que conectó un cliente remoto y se autenticó con su propia identidad: opera
 * con su rol, no con el de una credencial compartida.
 *
 * Los permisos se resuelven igual en ambos casos --rol más alcances-- así que el
 * servidor de herramientas no necesita distinguirlos; la auditoría sí.
 */
export type AgentPrincipal = {
  id: string;
  name: string;
  roleKey: string;
  scopes: string[];
  kind: "agent" | "user";
  /** Quién responde por esta credencial. Ausente sólo cuando `kind` es "user". */
  ownerUserId?: string | null;
  /** El rol de esa persona: acota el alcance del agente al de su responsable. */
  ownerRoleKey?: string | null;
};

type AgentRow = {
  id: string;
  name: string;
  role_key: string;
  scopes: string[];
  owner_user_id: string | null;
  owner_role_key: string | null;
  owner_active: boolean | null;
};

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function authenticateAgentToken(token: string): Promise<AgentPrincipal | null> {
  if (!token.startsWith("factory_mcp_") || token.length < 48 || token.length > 160) return null;
  // El responsable viaja con la credencial: de él sale el alcance por registro, y su
  // estado importa tanto como el del agente. Una persona desactivada no sigue operando
  // a través de una credencial que dejó viva.
  const rows = await sql<AgentRow>(
    `UPDATE app_agent AS a
        SET last_used_at = now()
       FROM (SELECT id, owner_user_id FROM app_agent WHERE token_hash = $1) AS actual
      WHERE a.id = actual.id
        AND a.token_hash = $1
        AND a.active = TRUE
        AND (a.expires_at IS NULL OR a.expires_at > now())
      RETURNING a.id, a.name, a.role_key, a.scopes,
                a.owner_user_id,
                (SELECT role_key FROM app_user WHERE id = a.owner_user_id) AS owner_role_key,
                (SELECT active   FROM app_user WHERE id = a.owner_user_id) AS owner_active`,
    [tokenHash(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.owner_user_id && row.owner_active === false) return null;
  return {
    id: row.id,
    name: row.name,
    roleKey: row.role_key,
    scopes: row.scopes,
    kind: "agent" as const,
    ownerUserId: row.owner_user_id,
    ownerRoleKey: row.owner_role_key,
  };
}

/** Sólo se registra actividad de credenciales de agente; las personas se auditan por sus acciones. */
export async function startAgentToolEvent(input: {
  agentId: string;
  toolName: string;
  entityKey?: string;
  inputSummary: Record<string, unknown>;
}) {
  const rows = await sql<{ id: string }>(
    `INSERT INTO app_agent_event (agent_id, tool_name, entity_key, input_summary, status)
     SELECT $1, $2, $3, $4::jsonb, 'running'
      WHERE (SELECT COUNT(*) FROM app_agent_event WHERE agent_id = $1 AND started_at > now() - interval '1 minute') < 120
     RETURNING id`,
    [input.agentId, input.toolName, input.entityKey ?? null, JSON.stringify(input.inputSummary)],
  );
  if (!rows[0]) throw new Error("El agente superó el límite de 120 herramientas por minuto.");
  return { id: rows[0].id, startedAt: Date.now() };
}

export async function finishAgentToolEvent(input: {
  id: string;
  startedAt: number;
  status: "completed" | "failed";
  resultCount?: number;
  errorMessage?: string;
}) {
  await sql(
    `UPDATE app_agent_event
        SET status = $2,
            result_count = $3,
            duration_ms = $4,
            error_message = $5,
            finished_at = now()
      WHERE id = $1`,
    [
      input.id,
      input.status,
      input.resultCount ?? null,
      Math.max(0, Date.now() - input.startedAt),
      input.errorMessage?.slice(0, 1_000) ?? null,
    ],
  );
}


/** Alcances de una persona operando por MCP: el techo lo pone su rol, no la credencial. */
// Una persona que entra por OAuth no elige alcances: los trae todos, y lo que
// efectivamente puede hacer lo decide su rol, igual que sentada frente al panel.
export const USER_SCOPES = [
  "schema:read",
  "records:read",
  "records:write",
  "records:delete",
  "settings:read",
  "settings:write",
];
