import type { PoolClient, QueryResultRow } from "pg";
import { sql, transactionSql } from "@/lib/db";
import { type EntitySpec, type FieldSpec, relationFields, requireEntity } from "@/lib/spec";

const IDENTIFIER = /^[a-z][a-z0-9_]{0,47}$/;

function queryRows<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient | undefined,
  text: string,
  values: unknown[] = [],
) {
  return client ? transactionSql<T>(client, text, values) : sql<T>(text, values);
}

function identifier(value: string) {
  if (!IDENTIFIER.test(value)) throw new Error(`Identificador inseguro: ${value}`);
  return `"${value}"`;
}

function columnsFor(entity: EntitySpec) {
  return [
    "id",
    ...entity.fields.map((field) => field.key),
    ...relationFields(entity).map((relationship) => `${relationship.key}_id`),
    "created_at",
    "updated_at",
  ];
}

function mutableColumnsFor(entity: EntitySpec) {
  return [
    ...entity.fields.map((field) => field.key),
    ...relationFields(entity).map((relationship) => `${relationship.key}_id`),
  ];
}

export async function countRecords(entityKey: string) {
  const entity = requireEntity(entityKey);
  const rows = await sql<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${identifier(entity.key)}`);
  return Number(rows[0]?.count ?? 0);
}

export type ListRecordOptions = {
  search?: string;
  filters?: Record<string, string>;
  sort?: string;
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

function listWhere(entity: EntitySpec, options: ListRecordOptions) {
  const searchable = entity.fields.filter((field) => field.searchable);
  const fieldMap = new Map(entity.fields.map((field) => [field.key, field]));
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (options.search?.trim() && searchable.length) {
    values.push(`%${options.search.trim()}%`);
    conditions.push(`(${searchable.map((field) => `CAST(${identifier(field.key)} AS text) ILIKE $${values.length}`).join(" OR ")})`);
  }
  for (const [fieldKey, rawValue] of Object.entries(options.filters ?? {})) {
    const field = fieldMap.get(fieldKey);
    const filter = rawValue.trim();
    if (!field || !filter) continue;
    if (field.type === "boolean") {
      if (!new Set(["true", "false"]).has(filter)) continue;
      values.push(filter === "true");
      conditions.push(`${identifier(field.key)} = $${values.length}`);
    } else if (field.type === "enum" || field.type === "date" || field.type === "integer" || field.type === "decimal") {
      values.push(filter);
      conditions.push(`CAST(${identifier(field.key)} AS text) = $${values.length}`);
    } else if (field.type === "datetime") {
      values.push(`${filter}%`);
      conditions.push(`CAST(${identifier(field.key)} AS text) ILIKE $${values.length}`);
    } else {
      values.push(`%${filter}%`);
      conditions.push(`CAST(${identifier(field.key)} AS text) ILIKE $${values.length}`);
    }
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  return { values, where };
}

export async function countFilteredRecords(entityKey: string, options: ListRecordOptions = {}) {
  const entity = requireEntity(entityKey);
  const { values, where } = listWhere(entity, options);
  const rows = await sql<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${identifier(entity.key)}${where}`,
    values,
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listRecords(entityKey: string, options: ListRecordOptions = {}) {
  const entity = requireEntity(entityKey);
  const columns = columnsFor(entity).map(identifier).join(", ");
  const { values, where } = listWhere(entity, options);
  const sortable = new Set(["id", ...entity.fields.map((field) => field.key), "created_at", "updated_at"]);
  const sort = options.sort && sortable.has(options.sort) ? options.sort : "updated_at";
  const direction = options.direction === "asc" ? "ASC" : "DESC";
  const limit = Math.min(500, Math.max(1, options.limit ?? 100));
  const offset = Math.min(1_000_000, Math.max(0, options.offset ?? 0));
  return sql<Record<string, unknown>>(
    `SELECT ${columns} FROM ${identifier(entity.key)}${where} ORDER BY ${identifier(sort)} ${direction} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );
}

export async function aggregateRecords(entityKey: string, aggregate: "count" | "sum" | "avg", fieldKey?: string) {
  const entity = requireEntity(entityKey);
  if (aggregate === "count") {
    const rows = await sql<{ value: string }>(`SELECT COUNT(*)::text AS value FROM ${identifier(entity.key)}`);
    return Number(rows[0]?.value ?? 0);
  }
  const field = entity.fields.find((candidate) => candidate.key === fieldKey && ["integer", "decimal"].includes(candidate.type));
  if (!field) throw new Error(`Agregación inválida para ${entityKey}.${fieldKey ?? ""}`);
  const rows = await sql<{ value: string | null }>(
    `SELECT ${aggregate.toUpperCase()}(${identifier(field.key)})::text AS value FROM ${identifier(entity.key)}`,
  );
  return Number(rows[0]?.value ?? 0);
}

export async function breakdownRecords(entityKey: string, fieldKey: string) {
  const entity = requireEntity(entityKey);
  const field = entity.fields.find((candidate) => candidate.key === fieldKey && ["enum", "boolean"].includes(candidate.type));
  if (!field) throw new Error(`Desglose inválido para ${entityKey}.${fieldKey}`);
  return sql<{ key: string | boolean | null; count: string }>(
    `SELECT ${identifier(field.key)} AS key, COUNT(*)::text AS count
       FROM ${identifier(entity.key)}
      GROUP BY ${identifier(field.key)}
      ORDER BY COUNT(*) DESC, ${identifier(field.key)} ASC`,
  );
}

export async function calendarRecords(
  entityKey: string,
  dateFieldKey: string,
  startDate: string,
  endDate: string,
  timezone: string,
) {
  const entity = requireEntity(entityKey);
  const field = entity.fields.find((candidate) => candidate.key === dateFieldKey && ["date", "datetime"].includes(candidate.type));
  if (!field) throw new Error(`Campo de calendario inválido: ${entityKey}.${dateFieldKey}`);
  const columns = columnsFor(entity).map(identifier).join(", ");
  const dateExpression = field.type === "datetime"
    ? `(${identifier(field.key)} AT TIME ZONE $3)::date`
    : `${identifier(field.key)}::date`;
  const values: unknown[] = field.type === "datetime" ? [startDate, endDate, timezone] : [startDate, endDate];
  return sql<Record<string, unknown>>(
    `SELECT ${columns}
       FROM ${identifier(entity.key)}
      WHERE ${dateExpression} >= $1::date AND ${dateExpression} < $2::date
      ORDER BY ${identifier(field.key)} ASC
      LIMIT 500`,
    values,
  );
}

export async function listRecordsForExport(entityKey: string, limit: number) {
  const entity = requireEntity(entityKey);
  const columns = columnsFor(entity).map(identifier).join(", ");
  return sql<Record<string, unknown>>(
    `SELECT ${columns} FROM ${identifier(entity.key)} ORDER BY "updated_at" DESC LIMIT $1`,
    [limit],
  );
}

export async function getRecord(entityKey: string, id: string, client?: PoolClient, forUpdate = false) {
  const entity = requireEntity(entityKey);
  const columns = columnsFor(entity).map(identifier).join(", ");
  const rows = await queryRows<Record<string, unknown>>(
    client,
    `SELECT ${columns} FROM ${identifier(entity.key)} WHERE "id" = $1 LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function relationshipOptions(entity: EntitySpec) {
  const entries = await Promise.all(
    relationFields(entity).map(async (relationship) => {
      const target = requireEntity(relationship.target);
      const rows = await sql<{ id: string; label: unknown }>(
        `SELECT "id", ${identifier(target.title_field)} AS label FROM ${identifier(target.key)} ORDER BY ${identifier(target.title_field)} ASC LIMIT 500`,
      );
      return [relationship.key, rows.map((row) => ({ id: row.id, label: String(row.label ?? row.id) }))] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<string, Array<{ id: string; label: string }>>;
}

function parseScalar(field: FieldSpec, raw: FormDataEntryValue | null, mode: "create" | "update") {
  if (field.type === "boolean") return raw !== null;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    if (field.required && !(mode === "create" && "default" in field)) {
      throw new Error(`El campo ${field.label} es obligatorio.`);
    }
    if (mode === "create" && "default" in field) return undefined;
    return null;
  }
  if (field.type === "integer" && !/^-?\d+$/.test(value)) {
    throw new Error(`${field.label} debe ser un número entero.`);
  }
  if (field.type === "decimal" && !/^-?\d+(\.\d+)?$/.test(value)) {
    throw new Error(`${field.label} debe ser un número decimal.`);
  }
  if (field.type === "json" || field.type === "file") {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`${field.label} debe contener JSON válido.`);
    }
  }
  return value;
}

function parseObjectScalar(field: FieldSpec, raw: unknown, mode: "create" | "update") {
  if (raw === undefined) {
    if (mode === "create" && field.required && !("default" in field)) {
      throw new Error(`El campo ${field.label} es obligatorio.`);
    }
    return undefined;
  }
  if (raw === null || raw === "") {
    if (field.required) throw new Error(`El campo ${field.label} es obligatorio.`);
    return null;
  }
  if (field.type === "boolean") {
    if (typeof raw !== "boolean") throw new Error(`${field.label} debe ser verdadero o falso.`);
    return raw;
  }
  if (field.type === "integer") {
    if (typeof raw !== "number" || !Number.isSafeInteger(raw)) throw new Error(`${field.label} debe ser un número entero.`);
    return raw;
  }
  if (field.type === "decimal") {
    if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error(`${field.label} debe ser un número decimal.`);
    return raw;
  }
  if (field.type === "json" || field.type === "file") {
    if (typeof raw !== "object") throw new Error(`${field.label} debe contener JSON válido.`);
    return raw;
  }
  if (typeof raw !== "string") throw new Error(`${field.label} debe ser texto.`);
  const value = raw.trim();
  if (!value) {
    if (field.required) throw new Error(`El campo ${field.label} es obligatorio.`);
    return null;
  }
  if (field.type === "enum" && !field.options?.some((option) => option.key === value)) {
    throw new Error(`${field.label} contiene una opción inválida.`);
  }
  if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field.label} debe usar el formato AAAA-MM-DD.`);
  }
  if (field.type === "datetime" && Number.isNaN(Date.parse(value))) {
    throw new Error(`${field.label} debe contener una fecha y hora ISO válida.`);
  }
  if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`${field.label} debe contener un correo válido.`);
  }
  if (field.type === "url") {
    try {
      new URL(value);
    } catch {
      throw new Error(`${field.label} debe contener una URL válida.`);
    }
  }
  return value;
}

export function recordInputFromObject(
  entity: EntitySpec,
  input: Record<string, unknown>,
  mode: "create" | "update",
) {
  const fieldKeys = new Set(entity.fields.map((field) => field.key));
  const relationshipKeys = new Set(relationFields(entity).map((relationship) => `${relationship.key}_id`));
  const unknown = Object.keys(input).filter((key) => !fieldKeys.has(key) && !relationshipKeys.has(key));
  if (unknown.length) throw new Error(`Campos desconocidos: ${unknown.join(", ")}.`);

  const result: Record<string, unknown> = {};
  for (const field of entity.fields) {
    const value = parseObjectScalar(field, input[field.key], mode);
    if (value !== undefined) result[field.key] = value;
  }
  for (const relationship of relationFields(entity)) {
    const key = `${relationship.key}_id`;
    const raw = input[key];
    if (raw === undefined) {
      if (mode === "create" && relationship.required) throw new Error(`${relationship.label} es obligatorio.`);
      continue;
    }
    if (raw === null || raw === "") {
      if (relationship.required) throw new Error(`${relationship.label} es obligatorio.`);
      result[key] = null;
      continue;
    }
    if (typeof raw !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
      throw new Error(`${relationship.label} debe ser un UUID válido.`);
    }
    result[key] = raw;
  }
  if (mode === "update" && !Object.keys(result).length) throw new Error("La actualización no contiene campos válidos.");
  return result;
}

export function recordInputFromForm(entity: EntitySpec, formData: FormData, mode: "create" | "update") {
  const result: Record<string, unknown> = {};
  for (const field of entity.fields) {
    const value = parseScalar(field, formData.get(field.key), mode);
    if (value !== undefined) result[field.key] = value;
  }
  for (const relationship of relationFields(entity)) {
    const raw = formData.get(relationship.key);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value && relationship.required) throw new Error(`${relationship.label} es obligatorio.`);
    if (value || mode === "update") result[`${relationship.key}_id`] = value || null;
  }
  return result;
}

export async function insertRecord(entityKey: string, values: Record<string, unknown>, client?: PoolClient) {
  const entity = requireEntity(entityKey);
  const allowed = new Set(mutableColumnsFor(entity));
  const entries = Object.entries(values).filter(([key]) => allowed.has(key));
  if (!entries.length) {
    const rows = await queryRows<{ id: string }>(client, `INSERT INTO ${identifier(entity.key)} DEFAULT VALUES RETURNING "id"`);
    return rows[0].id;
  }
  const columns = entries.map(([key]) => identifier(key)).join(", ");
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await queryRows<{ id: string }>(
    client,
    `INSERT INTO ${identifier(entity.key)} (${columns}) VALUES (${placeholders}) RETURNING "id"`,
    entries.map(([, value]) => value),
  );
  return rows[0].id;
}

export async function updateRecord(entityKey: string, id: string, values: Record<string, unknown>, client?: PoolClient) {
  const entity = requireEntity(entityKey);
  const allowed = new Set(mutableColumnsFor(entity));
  const entries = Object.entries(values).filter(([key]) => allowed.has(key));
  if (!entries.length) return;
  const assignments = entries.map(([key], index) => `${identifier(key)} = $${index + 1}`).join(", ");
  await queryRows(
    client,
    `UPDATE ${identifier(entity.key)} SET ${assignments} WHERE "id" = $${entries.length + 1}`,
    [...entries.map(([, value]) => value), id],
  );
}

export async function deleteRecord(entityKey: string, id: string, client?: PoolClient) {
  const entity = requireEntity(entityKey);
  await queryRows(client, `DELETE FROM ${identifier(entity.key)} WHERE "id" = $1`, [id]);
}
