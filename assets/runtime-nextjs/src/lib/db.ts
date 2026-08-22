import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { databaseConfig } from "@/lib/connection";

// Una columna `date` guarda una fecha civil: no tiene hora ni zona horaria.
// El parser por defecto de pg la convierte a Date usando la zona del proceso,
// así que el mismo valor cae en un día distinto según dónde corra el servidor
// (en Vercel corre en UTC). La devolvemos como texto YYYY-MM-DD para que una
// fecha sin hora no dependa del entorno.
types.setTypeParser(types.builtins.DATE, (value) => value);

const globalForDb = globalThis as unknown as { appPool?: Pool };

function createPool() {
  const configuredMax = Number(process.env.DATABASE_POOL_MAX);
  const max = Number.isInteger(configuredMax) && configuredMax > 0
    ? configuredMax
    : process.env.VERCEL
      ? 3
      : 10;
  return new Pool({ ...databaseConfig(), max });
}

export function getPool() {
  globalForDb.appPool ??= createPool();
  return globalForDb.appPool;
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
