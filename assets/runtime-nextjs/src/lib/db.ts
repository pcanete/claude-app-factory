import { Pool, type PoolClient, type QueryResultRow } from "pg";

const globalForDb = globalThis as unknown as { rielPool?: Pool };

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Falta DATABASE_URL. Copiá .env.example a .env.local y configurá PostgreSQL.");
  }
  const configuredMax = Number(process.env.DATABASE_POOL_MAX);
  const max = Number.isInteger(configuredMax) && configuredMax > 0
    ? configuredMax
    : process.env.VERCEL
      ? 3
      : 10;
  return new Pool({ connectionString, max });
}

export function getPool() {
  globalForDb.rielPool ??= createPool();
  return globalForDb.rielPool;
}

export async function sql<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  const result = await getPool().query<T>(text, values);
  return result.rows;
}

export async function transactionSql<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient,
  text: string,
  values: unknown[] = [],
) {
  const result = await client.query<T>(text, values);
  return result.rows;
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
