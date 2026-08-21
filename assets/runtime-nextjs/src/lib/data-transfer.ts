import ExcelJS from "exceljs";
import { sql } from "@/lib/db";
import { applyRules, type AppliedRule, RuleBlockedError } from "@/lib/rules";
import { type EntitySpec, type FieldSpec, relationFields, requireEntity, runtimeSpec } from "@/lib/spec";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1000;
export const MAX_EXPORT_ROWS = 10_000;
export const IMPORT_PREVIEW_ROWS = 20;

const IDENTIFIER = /^[a-z][a-z0-9_]{0,47}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORMULA_CELL = Symbol("formula-cell");

export type ImportIssue = {
  row: number;
  column?: string;
  message: string;
};

export type ValidatedImportRow = {
  rowNumber: number;
  values: Record<string, unknown>;
  rules?: AppliedRule[];
};

export type ImportValidation = {
  columns: Array<{ key: string; label: string }>;
  rows: ValidatedImportRow[];
  issues: ImportIssue[];
};

type TransferColumn = {
  key: string;
  label: string;
  type: FieldSpec["type"] | "relationship";
  required: boolean;
  defaultValue?: unknown;
  field?: FieldSpec;
  relationship?: ReturnType<typeof relationFields>[number];
};

function identifier(value: string) {
  if (!IDENTIFIER.test(value)) throw new Error(`Identificador inseguro: ${value}`);
  return `"${value}"`;
}

export function importColumns(entity: EntitySpec): TransferColumn[] {
  return [
    ...entity.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: Boolean(field.required),
      defaultValue: field.default,
      field,
    } satisfies TransferColumn)),
    ...relationFields(entity).map((relationship) => ({
      key: `${relationship.key}_id`,
      label: relationship.label,
      type: "relationship" as const,
      required: Boolean(relationship.required),
      relationship,
    })),
  ];
}

export function exportColumns(entity: EntitySpec) {
  return [
    { key: "id", label: "ID" },
    ...importColumns(entity).map(({ key, label }) => ({ key, label })),
    { key: "created_at", label: "Creado" },
    { key: "updated_at", label: "Actualizado" },
  ];
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("El CSV contiene una comilla sin cerrar.");
  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function excelCellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date || typeof value !== "object") return value;
  if ("formula" in value || "sharedFormula" in value) return FORMULA_CELL;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("text" in value) return value.text;
  if ("error" in value) return value.error;
  return String(value);
}

async function readMatrix(file: File): Promise<unknown[][]> {
  if (!file.name.toLowerCase().endsWith(".csv") && !file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Formato no admitido. Usá un archivo .csv o .xlsx.");
  }
  if (!file.size) throw new Error("El archivo está vacío.");
  if (file.size > MAX_IMPORT_BYTES) throw new Error("El archivo supera el límite de 5 MB.");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (file.name.toLowerCase().endsWith(".csv")) return parseCsv(buffer.toString("utf8"));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("El Excel no contiene hojas.");
  const matrix: unknown[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values: unknown[] = [];
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      values.push(excelCellValue(row.getCell(column)));
    }
    matrix.push(values);
  });
  return matrix;
}

function isBlank(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && !value.trim());
}

function asText(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function scalarValue(field: FieldSpec, raw: unknown): unknown {
  if (raw === FORMULA_CELL) throw new Error("Las fórmulas no están permitidas; pegá su valor calculado.");
  if (isBlank(raw)) return undefined;
  const text = asText(raw);
  if (field.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    const normalized = text.toLocaleLowerCase("es");
    if (["true", "1", "sí", "si", "yes", "s"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
    throw new Error("Usá Sí/No, Verdadero/Falso o 1/0.");
  }
  if (field.type === "integer") {
    const number = typeof raw === "number" ? raw : Number(text);
    if (!Number.isSafeInteger(number)) throw new Error("Debe ser un número entero.");
    return number;
  }
  if (field.type === "decimal") {
    const normalized = typeof raw === "number" ? raw : Number(text.replace(",", "."));
    if (!Number.isFinite(normalized)) throw new Error("Debe ser un número decimal.");
    return normalized;
  }
  if (field.type === "date") {
    const date = raw instanceof Date ? raw : /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : null;
    if (!date || Number.isNaN(date.getTime())) throw new Error("Usá una fecha con formato AAAA-MM-DD.");
    return date.toISOString().slice(0, 10);
  }
  if (field.type === "datetime") {
    const date = raw instanceof Date ? raw : new Date(text);
    if (Number.isNaN(date.getTime())) throw new Error("Usá una fecha y hora válida.");
    return date.toISOString();
  }
  if (field.type === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new Error("Debe ser un correo electrónico válido.");
    return text;
  }
  if (field.type === "url") {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new Error("Debe ser una URL válida.");
    }
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("La URL debe usar HTTP o HTTPS.");
    return url.toString();
  }
  if (field.type === "enum") {
    const option = field.options?.find(
      (candidate) => candidate.key === text || candidate.label.toLocaleLowerCase("es") === text.toLocaleLowerCase("es"),
    );
    if (!option) throw new Error(`Valor no permitido. Opciones: ${field.options?.map((item) => item.key).join(", ")}.`);
    return option.key;
  }
  if (field.type === "json" || field.type === "file") {
    if (typeof raw === "object" && raw !== null && !(raw instanceof Date)) return raw;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Debe contener JSON válido.");
    }
  }
  return text;
}

async function relationshipMaps(entity: EntitySpec, rawRows: Array<{ rowNumber: number; raw: Record<string, unknown> }>) {
  const result = new Map<string, { ids: Map<string, string>; labels: Map<string, string | null> }>();
  for (const relationship of relationFields(entity)) {
    const key = `${relationship.key}_id`;
    const values = [...new Set(rawRows.map((row) => row.raw[key]).filter((value) => !isBlank(value)).map(asText))];
    if (!values.length) {
      result.set(key, { ids: new Map(), labels: new Map() });
      continue;
    }
    const target = requireEntity(relationship.target);
    const rows = await sql<{ id: string; label: string }>(
      `SELECT "id"::text AS id, CAST(${identifier(target.title_field)} AS text) AS label
        FROM ${identifier(target.key)}
        WHERE "id"::text = ANY($1::text[])
           OR CAST(${identifier(target.title_field)} AS text) = ANY($2::text[])
           OR lower(CAST(${identifier(target.title_field)} AS text)) = ANY($3::text[])`,
      [values, values, values.map((value) => value.toLocaleLowerCase("es"))],
    );
    const ids = new Map(rows.map((row) => [row.id, row.id]));
    const labels = new Map<string, string | null>();
    for (const row of rows) {
      const normalized = row.label.toLocaleLowerCase("es");
      labels.set(normalized, labels.has(normalized) ? null : row.id);
    }
    result.set(key, { ids, labels });
  }
  return result;
}

async function existingUniqueValues(entity: EntitySpec, rows: ValidatedImportRow[]) {
  const result = new Map<string, Set<string>>();
  for (const field of entity.fields.filter((candidate) => candidate.unique)) {
    const values = [...new Set(rows.map((row) => row.values[field.key]).filter((value) => value !== undefined && value !== null).map(String))];
    if (!values.length) continue;
    const existing = await sql<{ value: string }>(
      `SELECT CAST(${identifier(field.key)} AS text) AS value
         FROM ${identifier(entity.key)}
        WHERE CAST(${identifier(field.key)} AS text) = ANY($1::text[])`,
      [values],
    );
    result.set(field.key, new Set(existing.map((item) => item.value)));
  }
  return result;
}

export async function parseAndValidateImport(entity: EntitySpec, file: File): Promise<ImportValidation> {
  const matrix = await readMatrix(file);
  const columns = importColumns(entity);
  const issues: ImportIssue[] = [];
  if (!matrix.length) return { columns, rows: [], issues: [{ row: 1, message: "El archivo no contiene encabezados." }] };
  const headers = matrix[0].map((value) => asText(value));
  const known = new Set([...columns.map((column) => column.key), "id", "created_at", "updated_at"]);
  const seen = new Set<string>();
  headers.forEach((header) => {
    if (!header) return;
    if (seen.has(header)) issues.push({ row: 1, column: header, message: "La columna está repetida." });
    else if (!known.has(header)) issues.push({ row: 1, column: header, message: "La columna no pertenece a esta entidad." });
    seen.add(header);
  });
  for (const column of columns) {
    if (column.required && column.defaultValue === undefined && !seen.has(column.key)) {
      issues.push({ row: 1, column: column.key, message: "Falta una columna obligatoria." });
    }
  }
  if (issues.length) return { columns, rows: [], issues };

  const rawRows = matrix.slice(1).map((cells, index) => ({
    rowNumber: index + 2,
    raw: Object.fromEntries(headers.map((header, column) => [header, cells[column]])),
  })).filter((row) => columns.some((column) => !isBlank(row.raw[column.key])));
  if (!rawRows.length) return { columns, rows: [], issues: [{ row: 2, message: "No hay filas con datos para importar." }] };
  if (rawRows.length > MAX_IMPORT_ROWS) {
    return { columns, rows: [], issues: [{ row: MAX_IMPORT_ROWS + 2, message: `El límite es de ${MAX_IMPORT_ROWS} filas por importación.` }] };
  }

  const relationLookups = await relationshipMaps(entity, rawRows);
  const rows: ValidatedImportRow[] = [];
  for (const row of rawRows) {
    const values: Record<string, unknown> = {};
    for (const column of columns) {
      const raw = row.raw[column.key];
      if (column.type === "relationship") {
        if (isBlank(raw)) {
          if (column.required) issues.push({ row: row.rowNumber, column: column.key, message: "La relación es obligatoria." });
          else values[column.key] = null;
          continue;
        }
        if (raw === FORMULA_CELL) {
          issues.push({ row: row.rowNumber, column: column.key, message: "Las fórmulas no están permitidas." });
          continue;
        }
        const text = asText(raw);
        const lookup = relationLookups.get(column.key);
        const id = lookup?.ids.get(text) ?? lookup?.labels.get(text.toLocaleLowerCase("es"));
        if (id === null) issues.push({ row: row.rowNumber, column: column.key, message: "El nombre coincide con más de un registro; usá su ID." });
        else if (!id) issues.push({ row: row.rowNumber, column: column.key, message: UUID.test(text) ? "El ID relacionado no existe." : "No se encontró un registro relacionado con ese nombre." });
        else values[column.key] = id;
        continue;
      }
      try {
        const value = scalarValue(column.field!, raw);
        if (value === undefined) {
          if (column.required && column.defaultValue === undefined) throw new Error("El campo es obligatorio.");
        } else {
          values[column.key] = value;
        }
      } catch (error) {
        issues.push({ row: row.rowNumber, column: column.key, message: error instanceof Error ? error.message : "Valor inválido." });
      }
    }
    rows.push({ rowNumber: row.rowNumber, values });
  }

  if (!issues.length) {
    for (const row of rows) {
      try {
        const evaluated = applyRules({ entityKey: entity.key, event: "before_create", values: row.values });
        row.values = evaluated.values;
        row.rules = evaluated.applied;
      } catch (error) {
        issues.push({
          row: row.rowNumber,
          message: error instanceof RuleBlockedError ? error.message : "No se pudo evaluar una regla para esta fila.",
        });
      }
    }
  }

  for (const field of entity.fields.filter((candidate) => candidate.unique)) {
    const seenValues = new Map<string, number>();
    for (const row of rows) {
      const value = row.values[field.key];
      if (value === undefined || value === null) continue;
      const normalized = String(value);
      const firstRow = seenValues.get(normalized);
      if (firstRow) issues.push({ row: row.rowNumber, column: field.key, message: `Valor repetido en el archivo (primera aparición: fila ${firstRow}).` });
      else seenValues.set(normalized, row.rowNumber);
    }
  }
  if (!issues.length) {
    const existing = await existingUniqueValues(entity, rows);
    for (const row of rows) {
      for (const [fieldKey, values] of existing) {
        const value = row.values[fieldKey];
        if (value !== undefined && value !== null && values.has(String(value))) {
          issues.push({ row: row.rowNumber, column: fieldKey, message: "El valor ya existe en la base de datos." });
        }
      }
    }
  }
  return { columns: columns.map(({ key, label }) => ({ key, label })), rows, issues };
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (typeof value === "string" && /^[=+\-@]/.test(text.trimStart())) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildCsv(entity: EntitySpec, records: Array<Record<string, unknown>>, template: boolean) {
  const columns = template ? importColumns(entity) : exportColumns(entity);
  const lines = [columns.map((column) => csvCell(column.key)).join(",")];
  if (!template) {
    for (const record of records) lines.push(columns.map((column) => csvCell(record[column.key])).join(","));
  }
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

export async function buildXlsx(entity: EntitySpec, records: Array<Record<string, unknown>>, template: boolean) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = runtimeSpec.app.name;
  workbook.created = new Date();
  const columns = template ? importColumns(entity) : exportColumns(entity);
  const worksheet = workbook.addWorksheet("Datos", { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.columns = columns.map((column) => ({ header: column.key, key: column.key, width: Math.max(14, Math.min(34, column.label.length + 5)) }));
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
  if (!template) records.forEach((record) => worksheet.addRow(Object.fromEntries(columns.map((column) => [column.key, record[column.key] ?? null]))));

  if (template) {
    const dictionary = workbook.addWorksheet("Diccionario");
    dictionary.columns = [
      { header: "Columna", key: "key", width: 28 },
      { header: "Nombre", key: "label", width: 30 },
      { header: "Tipo", key: "type", width: 18 },
      { header: "Obligatoria", key: "required", width: 14 },
      { header: "Valores admitidos", key: "values", width: 54 },
    ];
    dictionary.getRow(1).font = { bold: true };
    for (const column of importColumns(entity)) {
      const values = column.field?.type === "enum"
        ? column.field.options?.map((option) => `${option.key} (${option.label})`).join(", ")
        : column.relationship ? `ID o nombre exacto de ${requireEntity(column.relationship.target).label}` : "";
      dictionary.addRow({ key: column.key, label: column.label, type: column.type, required: column.required ? "Sí" : "No", values });
    }
  }
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}
