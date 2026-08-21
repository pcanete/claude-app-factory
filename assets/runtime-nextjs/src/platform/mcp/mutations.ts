import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { transactionSql, withTransaction } from "@/lib/db";
import type { AgentPrincipal } from "@/platform/mcp/store";

type MutationResult = Record<string, unknown>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export async function executeIdempotentMutation(input: {
  agent: AgentPrincipal;
  toolName: string;
  entityKey: string;
  idempotencyKey: string;
  request: Record<string, unknown>;
  execute: (client: PoolClient) => Promise<{ recordId?: string; result: MutationResult }>;
}) {
  return withTransaction(async (client) => {
    const hash = requestHash(input.request);
    const inserted = await transactionSql<{ agent_id: string }>(
      client,
      `INSERT INTO app_agent_mutation (agent_id, idempotency_key, tool_name, entity_key, request_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (agent_id, idempotency_key) DO NOTHING
       RETURNING agent_id`,
      [input.agent.id, input.idempotencyKey, input.toolName, input.entityKey, hash],
    );

    if (!inserted.length) {
      const existing = await transactionSql<{
        tool_name: string;
        entity_key: string;
        request_hash: string;
        result: MutationResult;
      }>(
        client,
        `SELECT tool_name, entity_key, request_hash, result
           FROM app_agent_mutation
          WHERE agent_id = $1 AND idempotency_key = $2
          FOR UPDATE`,
        [input.agent.id, input.idempotencyKey],
      );
      const previous = existing[0];
      if (!previous || previous.tool_name !== input.toolName || previous.entity_key !== input.entityKey || previous.request_hash !== hash) {
        throw new Error("La clave de idempotencia ya fue usada con otra mutación.");
      }
      return { ...previous.result, idempotent_replay: true };
    }

    const completed = await input.execute(client);
    await transactionSql(
      client,
      `UPDATE app_agent_mutation
          SET record_id = $3, result = $4::jsonb
        WHERE agent_id = $1 AND idempotency_key = $2`,
      [
        input.agent.id,
        input.idempotencyKey,
        completed.recordId ?? null,
        JSON.stringify(completed.result),
      ],
    );
    return { ...completed.result, idempotent_replay: false };
  });
}
