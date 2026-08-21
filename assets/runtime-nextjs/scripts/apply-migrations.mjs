import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Falta DATABASE_URL.");
}

const migrationDirectories = [
  { key: "generated", directory: resolve("database/generated") },
  { key: "custom", directory: resolve("database/custom") },
];
const migrations = (
  await Promise.all(
    migrationDirectories.map(async ({ key, directory }) =>
      (await readdir(directory))
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
const client = new Client({ connectionString });
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
    const checksum = createHash("sha256").update(source).digest("hex");
    const existing = await client.query("SELECT checksum FROM app_migration WHERE name = $1", [name]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`La migración aplicada ${name} fue modificada.`);
      }
      console.log(`skip ${name}`);
      continue;
    }
    try {
      await client.query(source);
      await client.query("INSERT INTO app_migration (name, checksum) VALUES ($1, $2)", [name, checksum]);
      console.log(`apply ${name}`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
} finally {
  await client.end();
}
