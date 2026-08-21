import type { PoolClient } from "pg";
import { sql, transactionSql } from "@/lib/db";
import type { ValidatedImportRow } from "@/lib/data-transfer";

export type ImportBatch = {
  id: string;
  actor_id: string;
  entity_key: string;
  file_name: string;
  rows: ValidatedImportRow[];
  row_count: number;
  status: "ready" | "completed";
  created_at: Date;
  expires_at: Date;
  completed_at: Date | null;
};

export async function createImportBatch(input: {
  actorId: string;
  entityKey: string;
  fileName: string;
  rows: ValidatedImportRow[];
}) {
  const batches = await sql<{ id: string }>(
    `INSERT INTO app_import_batch (actor_id, entity_key, file_name, rows, row_count)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id`,
    [input.actorId, input.entityKey, input.fileName, JSON.stringify(input.rows), input.rows.length],
  );
  return batches[0].id;
}

export async function getImportBatch(id: string, actorId: string, entityKey: string) {
  const batches = await sql<ImportBatch>(
    `SELECT id, actor_id, entity_key, file_name, rows, row_count, status, created_at, expires_at, completed_at
       FROM app_import_batch
      WHERE id = $1 AND actor_id = $2 AND entity_key = $3 AND expires_at > now()
      LIMIT 1`,
    [id, actorId, entityKey],
  );
  return batches[0] ?? null;
}

export async function lockImportBatch(client: PoolClient, id: string, actorId: string, entityKey: string) {
  const batches = await transactionSql<ImportBatch>(
    client,
    `SELECT id, actor_id, entity_key, file_name, rows, row_count, status, created_at, expires_at, completed_at
       FROM app_import_batch
      WHERE id = $1 AND actor_id = $2 AND entity_key = $3 AND expires_at > now()
      FOR UPDATE`,
    [id, actorId, entityKey],
  );
  return batches[0] ?? null;
}

export async function completeImportBatch(client: PoolClient, id: string) {
  await transactionSql(
    client,
    `UPDATE app_import_batch
        SET status = 'completed', completed_at = now()
      WHERE id = $1`,
    [id],
  );
}
