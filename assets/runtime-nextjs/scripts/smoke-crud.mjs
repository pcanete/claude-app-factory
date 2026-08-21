import { readFile } from "node:fs/promises";
import pg from "pg";

const { Client } = pg;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,47}$/;
const keep = process.argv.includes("--keep");
const spec = JSON.parse(await readFile(new URL("../app-spec.json", import.meta.url), "utf8"));
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Falta DATABASE_URL.");

function identifier(value) {
  if (!IDENTIFIER.test(value)) throw new Error(`Identificador inseguro: ${value}`);
  return `"${value}"`;
}

function sampleValue(entity, field, suffix = "") {
  const token = `${entity.key}-${Date.now()}${suffix}`;
  switch (field.type) {
    case "boolean": return suffix ? false : true;
    case "integer": return suffix ? "2" : "1";
    case "decimal": return suffix ? "2.5" : "1.0";
    case "date": return suffix ? "2026-02-02" : "2026-01-01";
    case "datetime": return suffix ? "2026-02-02T12:00:00Z" : "2026-01-01T12:00:00Z";
    case "email": return `smoke-${token}@example.test`;
    case "url": return `https://example.test/${token}`;
    case "enum": return field.options?.[suffix ? field.options.length - 1 : 0]?.key;
    case "file":
    case "json": return { smoke: true, token };
    case "long_text":
    case "text":
    default: return `Smoke ${entity.label}${suffix}`;
  }
}

function belongsTo(entity) {
  return (entity.relationships ?? []).filter((relationship) => relationship.type === "belongs_to");
}

async function insertEntity(client, entity, inserted) {
  const unresolved = belongsTo(entity).filter((relationship) => relationship.required && !inserted.has(relationship.target));
  if (unresolved.length) return false;
  const entries = [];
  for (const field of entity.fields) {
    if (field.required || field.key === entity.title_field) {
      entries.push([field.key, sampleValue(entity, field)]);
    }
  }
  for (const relationship of belongsTo(entity)) {
    const target = inserted.get(relationship.target);
    if (target) entries.push([`${relationship.key}_id`, target.id]);
  }
  const columns = entries.map(([key]) => identifier(key)).join(", ");
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
  const result = await client.query(
    `INSERT INTO ${identifier(entity.key)} (${columns}) VALUES (${placeholders}) RETURNING id`,
    entries.map(([, value]) => value),
  );
  inserted.set(entity.key, { id: result.rows[0].id, entity });
  return true;
}

const client = new Client({ connectionString });
await client.connect();
const inserted = new Map();

try {
  await client.query("BEGIN");
  const pending = [...spec.entities];
  while (pending.length) {
    let progressed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (await insertEntity(client, pending[index], inserted)) {
        pending.splice(index, 1);
        progressed = true;
      }
    }
    if (!progressed) throw new Error(`Relaciones requeridas cíclicas o no resueltas: ${pending.map((entity) => entity.key).join(", ")}`);
  }

  for (const { id, entity } of inserted.values()) {
    const selected = await client.query(`SELECT * FROM ${identifier(entity.key)} WHERE id = $1`, [id]);
    if (selected.rowCount !== 1) throw new Error(`No se pudo leer ${entity.key}.`);
    const updateField = entity.fields.find((field) => !field.unique) ?? entity.fields[0];
    const updateValue = sampleValue(entity, updateField, " updated");
    await client.query(
      `UPDATE ${identifier(entity.key)} SET ${identifier(updateField.key)} = $1 WHERE id = $2`,
      [updateValue, id],
    );
  }

  if (!keep) {
    for (const { id, entity } of [...inserted.values()].reverse()) {
      await client.query(`DELETE FROM ${identifier(entity.key)} WHERE id = $1`, [id]);
    }
  }

  await client.query(keep ? "COMMIT" : "ROLLBACK");
  console.log(`CRUD smoke passed for ${inserted.size} entities${keep ? " (committed)" : " (rolled back)"}.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
