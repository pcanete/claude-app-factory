import type { FieldSpec } from "@/lib/spec";

export function formatValue(value: unknown, locale = "es-AR") {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (value instanceof Date) return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatDateTimeValue(value: unknown, locale = "es-AR") {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.valueOf())
    ? formatValue(value, locale)
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatFieldValue(field: FieldSpec, value: unknown, locale = "es-AR") {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "enum") {
    return field.options?.find((option) => option.key === String(value))?.label ?? String(value);
  }
  if (field.type === "date") {
    const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    return Number.isNaN(date.valueOf())
      ? String(value)
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
  }
  if (field.type === "datetime") {
    return formatDateTimeValue(value, locale);
  }
  if (field.type === "integer" || field.type === "decimal") {
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat(locale).format(number) : String(value);
  }
  return formatValue(value, locale);
}

export function recordsForClient(records: Array<Record<string, unknown>>) {
  return records.map((record) => Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  ));
}
