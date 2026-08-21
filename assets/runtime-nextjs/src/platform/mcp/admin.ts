import type { PoolClient } from "pg";
import { sql, transactionSql } from "@/lib/db";

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
};

export type ManagedAgentForUpdate = {
  id: string;
  name: string;
  active: boolean;
};

export function isManagedAgentId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function createManagedAgent(client: PoolClient, input: ManagedAgentInput) {
  const rows = await transactionSql<{ id: string }>(
    client,
    `INSERT INTO app_agent (name, token_hash, role_key, scopes, expires_at)
     VALUES ($1, $2, $3, $4::text[], $5)
     RETURNING id`,
    [input.name, input.tokenHash, input.roleKey, input.scopes, input.expiresAt],
  );
  return rows[0].id;
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
            COUNT(event.id)::text AS event_count
       FROM app_agent AS agent
       JOIN app_role AS role ON role.key = agent.role_key
       LEFT JOIN app_agent_event AS event ON event.agent_id = agent.id
      GROUP BY agent.id, role.label
      ORDER BY agent.active DESC, agent.name ASC`,
  );
}

export async function listAgentEvents(limit = 200) {
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
      LIMIT $1`,
    [Math.min(500, Math.max(1, limit))],
  );
}
