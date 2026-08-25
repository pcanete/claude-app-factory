import type { PoolClient, QueryResultRow } from "pg";
import { sql, transactionSql } from "@/lib/db";
import {
  assertRecordOwnershipChange,
  effectiveRecordScope,
  prepareRecordCreate,
  RecordOutOfScopeError,
  type RecordAccessContext,
} from "@/lib/record-access";
import { type EntitySpec, type FieldSpec, relationFields, requireEntity } from "@/lib/spec";

const IDENTIFIER = /^[a-z][a-z0-9_]{0,47}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

/**
 * El alcance por registro se aplica en SQL, nunca filtrando en memoria: si no, el
 * conteo y la paginación siguen contando lo que la persona no puede ver, y eso ya es
 * una filtración aunque las filas no se muestren.
 */
function recordAccessCondition(
  entity: EntitySpec,
  access: RecordAccessContext | undefined,
  values: unknown[],
) {
  const alcance = effectiveRecordScope(entity, access);
  if (alcance === "all") return null;
  if (alcance === "none") return "FALSE";
  values.push(access!.userId);
  return `${identifier(entity.record_access!.owner_field)} = $${values.length}::uuid`;
}

export async function countRecords(entityKey: string, access?: RecordAccessContext) {
  const entity = requireEntity(entityKey);
  const values: unknown[] = [];
  const condition = recordAccessCondition(entity, access, values);
  const rows = await sql<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${identifier(entity.key)}${condition ? ` WHERE ${condition}` : ""}`,
    values,
  );
  return Number(rows[0]?.count ?? 0);
}

export type ListRecordOptions = {
  search?: string;
  filters?: Record<string, string>;
  sort?: string;
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
  access?: RecordAccessContext;
};

function listWhere(entity: EntitySpec, options: ListRecordOptions) {
  const searchable = entity.fields.filter((field) => field.searchable);
  const fieldMap = new Map(entity.fields.map((field) => [field.key, field]));
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (options.search?.trim() && searchable.length) {
    values.push(`%${options.search.trim()}%`);
    conditions.push(
      `(${searchable
        .map((field) =>
          field.type === "tags"
            ? `array_to_string(${identifier(field.key)}, ' ') ILIKE $${values.length}`
            : `CAST(${identifier(field.key)} AS text) ILIKE $${values.length}`,
        )
        .join(" OR ")})`,
    );
  }
  // Filtrar por la relación es lo que permite pedir "lo de este cliente". Se acepta
  // tanto `client` como `client_id`, igual que al escribir, y sólo por identificador
  // exacto: filtrar por texto sobre una relación seria adivinar a qué registro apunta.
  const relationColumns = new Map(
    relationFields(entity).flatMap((relationship) => {
      const column = `${relationship.key}_id`;
      return [
        [relationship.key, column] as const,
        [column, column] as const,
      ];
    }),
  );

  for (const [fieldKey, rawValue] of Object.entries(options.filters ?? {})) {
    const filterValue = rawValue.trim();
    const relationColumn = relationColumns.get(fieldKey);
    if (relationColumn) {
      if (!UUID.test(filterValue)) continue;
      values.push(filterValue);
      conditions.push(`${identifier(relationColumn)} = $${values.length}::uuid`);
      continue;
    }
    const field = fieldMap.get(fieldKey);
    const filter = filterValue;
    if (!field || !filter) continue;
    if (field.type === "tags") {
      // Varias etiquetas separadas por coma se piden juntas: el registro debe tenerlas
      // todas. Es lo que se espera al acumular filtros.
      const pedidas = filter.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (!pedidas.length) continue;
      values.push(pedidas);
      conditions.push(`${identifier(field.key)} @> $${values.length}::text[]`);
    } else if (field.type === "boolean") {
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
  const alcance = recordAccessCondition(entity, options.access, values);
  if (alcance) conditions.push(alcance);
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

export async function aggregateRecords(
  entityKey: string,
  aggregate: "count" | "sum" | "avg",
  fieldKey?: string,
  access?: RecordAccessContext,
) {
  const entity = requireEntity(entityKey);
  const values: unknown[] = [];
  const alcance = recordAccessCondition(entity, access, values);
  const where = alcance ? ` WHERE ${alcance}` : "";
  if (aggregate === "count") {
    const rows = await sql<{ value: string }>(
      `SELECT COUNT(*)::text AS value FROM ${identifier(entity.key)}${where}`, values);
    return Number(rows[0]?.value ?? 0);
  }
  const field = entity.fields.find((candidate) => candidate.key === fieldKey && ["integer", "decimal"].includes(candidate.type));
  if (!field) throw new Error(`Agregación inválida para ${entityKey}.${fieldKey ?? ""}`);
  const rows = await sql<{ value: string | null }>(
    `SELECT ${aggregate.toUpperCase()}(${identifier(field.key)})::text AS value FROM ${identifier(entity.key)}${where}`,
    values,
  );
  return Number(rows[0]?.value ?? 0);
}

export async function breakdownRecords(entityKey: string, fieldKey: string, access?: RecordAccessContext) {
  const entity = requireEntity(entityKey);
  const field = entity.fields.find((candidate) => candidate.key === fieldKey && ["enum", "boolean"].includes(candidate.type));
  if (!field) throw new Error(`Desglose inválido para ${entityKey}.${fieldKey}`);
  const values: unknown[] = [];
  const alcance = recordAccessCondition(entity, access, values);
  return sql<{ key: string | boolean | null; count: string }>(
    `SELECT ${identifier(field.key)} AS key, COUNT(*)::text AS count
       FROM ${identifier(entity.key)}${alcance ? ` WHERE ${alcance}` : ""}
      GROUP BY ${identifier(field.key)}
      ORDER BY COUNT(*) DESC, ${identifier(field.key)} ASC`,
    values,
  );
}

export async function calendarRecords(
  entityKey: string,
  dateFieldKey: string,
  startDate: string,
  endDate: string,
  timezone: string,
  access?: RecordAccessContext,
) {
  const entity = requireEntity(entityKey);
  const field = entity.fields.find((candidate) => candidate.key === dateFieldKey && ["date", "datetime"].includes(candidate.type));
  if (!field) throw new Error(`Campo de calendario inválido: ${entityKey}.${dateFieldKey}`);
  const columns = columnsFor(entity).map(identifier).join(", ");
  const dateExpression = field.type === "datetime"
    ? `(${identifier(field.key)} AT TIME ZONE $3)::date`
    : `${identifier(field.key)}::date`;
  const values: unknown[] = field.type === "datetime" ? [startDate, endDate, timezone] : [startDate, endDate];
  const alcance = recordAccessCondition(entity, access, values);
  return sql<Record<string, unknown>>(
    `SELECT ${columns}
       FROM ${identifier(entity.key)}
      WHERE ${dateExpression} >= $1::date AND ${dateExpression} < $2::date${alcance ? ` AND ${alcance}` : ""}
      ORDER BY ${identifier(field.key)} ASC
      LIMIT 500`,
    values,
  );
}

export async function listRecordsForExport(entityKey: string, limit: number, access?: RecordAccessContext) {
  const entity = requireEntity(entityKey);
  const columns = columnsFor(entity).map(identifier).join(", ");
  const values: unknown[] = [];
  const alcance = recordAccessCondition(entity, access, values);
  values.push(limit);
  return sql<Record<string, unknown>>(
    `SELECT ${columns} FROM ${identifier(entity.key)}${alcance ? ` WHERE ${alcance}` : ""}
      ORDER BY "updated_at" DESC LIMIT $${values.length}`,
    values,
  );
}

export async function getRecord(
  entityKey: string,
  id: string,
  client?: PoolClient,
  forUpdate = false,
  access?: RecordAccessContext,
) {
  const entity = requireEntity(entityKey);
  const columns = columnsFor(entity).map(identifier).join(", ");
  // El alcance viaja en la consulta: conocer un identificador no puede alcanzar para
  // leer un registro ajeno.
  const values: unknown[] = [id];
  const alcance = recordAccessCondition(entity, access, values);
  const rows = await queryRows<Record<string, unknown>>(
    client,
    `SELECT ${columns} FROM ${identifier(entity.key)} WHERE "id" = $1${alcance ? ` AND ${alcance}` : ""} LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    values,
  );
  return rows[0] ?? null;
}

/**
 * Las opciones que se ofrecen para relacionar un registro con otro.
 *
 * Esta consulta era la única fuga real del alcance por registro: armaba su propio SQL
 * --`SELECT id, título FROM destino LIMIT 500`-- sin pasar por el filtro, así que
 * devolvía el identificador y el nombre de registros que la persona no puede abrir. No
 * fallaba ni avisaba: los ofrecía en un desplegable.
 *
 * Es el argumento a favor de que el alcance viva en un solo lugar y todas las lecturas
 * pasen por ahí. Este camino se lo había salteado.
 */
export async function relationshipOptions(entity: EntitySpec, access?: RecordAccessContext) {
  const entries = await Promise.all(
    relationFields(entity).map(async (relationship) => {
      const target = requireEntity(relationship.target);
      const values: unknown[] = [];
      const alcance = recordAccessCondition(target, access, values);
      values.push(500);
      const rows = await sql<{ id: string; label: unknown }>(
        `SELECT "id", ${identifier(target.title_field)} AS label
           FROM ${identifier(target.key)}${alcance ? ` WHERE ${alcance}` : ""}
          ORDER BY ${identifier(target.title_field)} ASC
          LIMIT $${values.length}`,
        values,
      );
      return [relationship.key, rows.map((row) => ({ id: row.id, label: String(row.label ?? row.id) }))] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<string, Array<{ id: string; label: string }>>;
}

/**
 * Etiquetas normalizadas.
 *
 * Sin esto, "Urgente", "urgente" y " urgente " conviven como tres etiquetas y
 * cualquier consulta por una de ellas devuelve una parte de lo que debería. Se
 * normaliza a minúsculas, se recorta y se quitan repetidas conservando el orden.
 */
function parseTags(field: FieldSpec, raw: unknown): string[] {
  const bruto = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const item of bruto) {
    if (typeof item !== "string") throw new Error(`${field.label}: cada etiqueta debe ser texto.`);
    const valor = item.trim().toLowerCase();
    if (!valor) continue;
    if (valor.length > 48) throw new Error(`${field.label}: "${valor.slice(0, 20)}…" supera 48 caracteres.`);
    if (vistas.has(valor)) continue;
    vistas.add(valor);
    salida.push(valor);
  }
  if (salida.length > 50) throw new Error(`${field.label}: no más de 50 etiquetas por registro.`);
  const permitidas = field.options?.map((option) => option.key);
  if (permitidas) {
    const invalida = salida.find((valor) => !permitidas.includes(valor));
    if (invalida) throw new Error(`${field.label}: "${invalida}" no es una opción válida.`);
  }
  return salida;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseScalar(field: FieldSpec, raw: FormDataEntryValue | null, mode: "create" | "update") {
  if (field.type === "boolean") return raw !== null;
  if (field.type === "tags") return parseTags(field, typeof raw === "string" ? raw : "");
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
  if (field.type === "person" && !UUID_PATTERN.test(value)) {
    throw new Error(`${field.label} debe referenciar a una persona de la aplicación.`);
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
  if (field.type === "tags") return parseTags(field, raw);
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
  if (field.type === "person") {
    if (typeof raw !== "string" || !UUID_PATTERN.test(raw)) {
      throw new Error(`${field.label} debe referenciar a una persona de la aplicación.`);
    }
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
  // Una relación se declara en la AppSpec como `client` y se almacena como `client_id`.
  // Quien descubre el esquema lee el primer nombre, así que se aceptan los dos: de lo
  // contrario un agente que lee la estructura y después escribe según lo que leyó falla.
  const relationshipKeys = new Set(
    relationFields(entity).flatMap((relationship) => [relationship.key, `${relationship.key}_id`]),
  );
  const unknown = Object.keys(input).filter((key) => !fieldKeys.has(key) && !relationshipKeys.has(key));
  if (unknown.length) throw new Error(`Campos desconocidos: ${unknown.join(", ")}.`);

  for (const relationship of relationFields(entity)) {
    if (relationship.key in input && `${relationship.key}_id` in input) {
      throw new Error(
        `${relationship.label} llegó dos veces: usá ${relationship.key} o ${relationship.key}_id, no ambos.`,
      );
    }
  }

  const result: Record<string, unknown> = {};
  for (const field of entity.fields) {
    const value = parseObjectScalar(field, input[field.key], mode);
    if (value !== undefined) result[field.key] = value;
  }
  for (const relationship of relationFields(entity)) {
    const key = `${relationship.key}_id`;
    const raw = key in input ? input[key] : input[relationship.key];
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

/**
 * El alta aplica sus propios invariantes.
 *
 * Antes, forzar el propietario al usuario actual dependía de que cada llamador se
 * acordara de envolver los valores con `prepareRecordCreate`. La pantalla lo hacía, el
 * servidor MCP también, y la importación no: la misma operación tenía distinta seguridad
 * según por qué puerta entrara. Es la clase de olvido que no se ve hasta que alguien
 * activa `record_access` y descubre que un camino escribía a nombre de cualquiera.
 *
 * Ahora el repositorio lo hace siempre. Un camino nuevo --una feature, un importador,
 * una automatización-- nace protegido sin tener que enterarse de que esto existe.
 */
export async function insertRecord(
  entityKey: string,
  values: Record<string, unknown>,
  client?: PoolClient,
  access?: RecordAccessContext,
) {
  const entity = requireEntity(entityKey);
  const conDueno = prepareRecordCreate(entity, values, access);
  const allowed = new Set(mutableColumnsFor(entity));
  const entries = Object.entries(conDueno).filter(([key]) => allowed.has(key));
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

export async function updateRecord(
  entityKey: string,
  id: string,
  values: Record<string, unknown>,
  client?: PoolClient,
  access?: RecordAccessContext,
) {
  const entity = requireEntity(entityKey);
  // La modificación tampoco confía en que el llamador lo haya comprobado: nadie con
  // alcance propio puede pasarle un registro a otra persona.
  assertRecordOwnershipChange(entity, values, access);
  const allowed = new Set(mutableColumnsFor(entity));
  const entries = Object.entries(values).filter(([key]) => allowed.has(key));
  if (!entries.length) return;
  const assignments = entries.map(([key], index) => `${identifier(key)} = $${index + 1}`).join(", ");
  const parametros: unknown[] = [...entries.map(([, value]) => value), id];
  const alcance = recordAccessCondition(entity, access, parametros);
  // `RETURNING` convierte el silencio en respuesta: sin fila, el registro no existe o
  // está fuera de alcance. Antes las dos cosas se veían como un éxito.
  const filas = await queryRows<{ id: string }>(
    client,
    `UPDATE ${identifier(entity.key)} SET ${assignments} WHERE "id" = $${entries.length + 1}${alcance ? ` AND ${alcance}` : ""} RETURNING "id"`,
    parametros,
  );
  if (!filas.length) {
    throw new RecordOutOfScopeError(`No se encontró el registro de ${entity.label} solicitado.`);
  }
}

export async function deleteRecord(
  entityKey: string,
  id: string,
  client?: PoolClient,
  access?: RecordAccessContext,
) {
  const entity = requireEntity(entityKey);
  const values: unknown[] = [id];
  const alcance = recordAccessCondition(entity, access, values);
  const filas = await queryRows<{ id: string }>(
    client,
    `DELETE FROM ${identifier(entity.key)} WHERE "id" = $1${alcance ? ` AND ${alcance}` : ""} RETURNING "id"`,
    values,
  );
  // Un borrado que no borró nada no puede informarse como hecho: o el registro no
  // existe, o es de otra persona, y en los dos casos la respuesta es la misma para no
  // revelar cuál de las dos.
  if (!filas.length) {
    throw new RecordOutOfScopeError(`No se encontró el registro de ${entity.label} solicitado.`);
  }
}
