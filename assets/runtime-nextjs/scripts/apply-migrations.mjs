import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { databaseConfig } from "./db-connection.mjs";

const { Client } = pg;

// Git, Windows y las APIs de despliegue pueden representar el mismo SQL con
// distintos fines de linea. Normalizarlos hace que la verificacion de integridad
// detecte ediciones reales y no diferencias de transporte.
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
function migrationChecksum(source) {
  const normalized = source.split(CR + LF).join(LF).split(CR).join(LF);
  return createHash("sha256").update(normalized).digest("hex");
}


// Orden por zona de propiedad: estructura de la AppSpec, luego plataforma del
// kernel, luego extensiones del cliente. Nunca al reves.
const migrationDirectories = [
  { key: "generated", directory: resolve("database/generated") },
  { key: "platform", directory: resolve("database/platform") },
  { key: "custom", directory: resolve("database/custom") },
];
const migrations = (
  await Promise.all(
    migrationDirectories.map(async ({ key, directory }) =>
      (await readdir(directory).catch(() => []))
        .filter((file) => file.endsWith(".sql"))
        .sort()
        .map((file) => ({
          directory,
          file,
          name: key === "generated" ? file : `${key}/${file}`,
        })),
    ),
  )
).flat();
const client = new Client(databaseConfig({ direct: true }));
await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_migration (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const migration of migrations) {
    const { file, name, directory } = migration;
    const source = await readFile(resolve(directory, file), "utf8");
    const checksum = migrationChecksum(source);
    const existing = await client.query("SELECT checksum FROM app_migration WHERE name = $1", [name]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`La migración aplicada ${name} fue modificada.`);
      }
      console.log(`skip ${name}`);
      continue;
    }
    // El archivo no abre su propia transaccion: la abre el runner para que el
    // efecto de la migracion y su registro se confirmen o se descarten juntos.
    try {
      await client.query("BEGIN");
      await client.query(source);
      await client.query("INSERT INTO app_migration (name, checksum) VALUES ($1, $2)", [name, checksum]);
      await client.query("COMMIT");
      console.log(`apply ${name}`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
} finally {
  await client.end();
}
