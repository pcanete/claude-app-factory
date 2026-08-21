"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { recordAuditEvent } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { getRecord, updateRecord } from "@/lib/repository";
import { applyRules, RuleBlockedError } from "@/lib/rules";
import { type FieldSpec, requireEntity, requireView, runtimeSpec } from "@/lib/spec";

export type RecordOperationResult = { ok: true; updated: number } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function validDateKey(value: string) {
  if (!DATE_KEY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function resultError(error: unknown): RecordOperationResult {
  if (error instanceof RuleBlockedError) return { ok: false, error: error.message };
  if (error instanceof Error && [
    "El registro ya no existe.",
    "La selección contiene identificadores inválidos.",
    "Seleccioná entre 1 y 100 registros.",
  ].includes(error.message)) return { ok: false, error: error.message };
  return { ok: false, error: "No se pudo completar la operación. Revisá los datos e intentá nuevamente." };
}

function revalidateEntity(entityKey: string, viewKey: string) {
  revalidatePath("/");
  revalidatePath(`/records/${entityKey}`);
  revalidatePath(`/views/${viewKey}`);
  revalidatePath("/audit");
}

function bulkValue(field: FieldSpec, rawValue: string) {
  if (field.type === "boolean") {
    if (rawValue !== "true" && rawValue !== "false") throw new Error("Valor booleano inválido.");
    return rawValue === "true";
  }
  const option = field.options?.find((candidate) => candidate.key === rawValue);
  if (!option) throw new Error("Opción inválida.");
  return option.key;
}

async function updateOne(input: {
  client: PoolClient;
  actorId: string;
  entityKey: string;
  recordId: string;
  values: Record<string, unknown>;
  source: Record<string, unknown>;
}) {
  const before = await getRecord(input.entityKey, input.recordId, input.client, true);
  if (!before) throw new Error("El registro ya no existe.");
  const evaluated = applyRules({ entityKey: input.entityKey, event: "before_update", values: input.values, before });
  await updateRecord(input.entityKey, input.recordId, evaluated.values, input.client);
  const after = await getRecord(input.entityKey, input.recordId, input.client);
  await recordAuditEvent(input.client, {
    actorId: input.actorId,
    entityKey: input.entityKey,
    recordId: input.recordId,
    action: "update",
    changes: { before, after, rules: evaluated.applied, source: input.source },
  });
}

export async function bulkSetRecordsAction(
  viewKey: string,
  recordIds: string[],
  fieldKey: string,
  rawValue: string,
): Promise<RecordOperationResult> {
  const view = requireView(viewKey);
  if (view.type !== "table" || !view.entity) return { ok: false, error: "La vista no admite edición masiva." };
  const user = await requirePermission(view.entity, "update");
  const entity = requireEntity(view.entity);
  const allowed = new Set(view.bulk_edit_fields ?? []);
  const field = entity.fields.find((candidate) => candidate.key === fieldKey && allowed.has(candidate.key) && ["enum", "boolean"].includes(candidate.type));
  if (!field) return { ok: false, error: "El campo no está habilitado para edición masiva." };
  const ids = [...new Set(recordIds)].sort();
  if (ids.length < 1 || ids.length > 100) return { ok: false, error: "Seleccioná entre 1 y 100 registros." };
  if (ids.some((id) => !UUID.test(id))) return { ok: false, error: "La selección contiene identificadores inválidos." };
  try {
    const value = bulkValue(field, rawValue);
    await withTransaction(async (client) => {
      for (const recordId of ids) {
        await updateOne({
          client,
          actorId: user.id,
          entityKey: entity.key,
          recordId,
          values: { [field.key]: value },
          source: { kind: "bulk", view: view.key, field: field.key },
        });
      }
    });
  } catch (error) {
    return resultError(error);
  }
  revalidateEntity(entity.key, view.key);
  return { ok: true, updated: ids.length };
}

export async function moveRecordAction(viewKey: string, recordId: string, targetKey: string): Promise<RecordOperationResult> {
  const view = requireView(viewKey);
  if (view.type !== "kanban" || !view.entity || !view.allow_move || !view.group_by) {
    return { ok: false, error: "El movimiento no está habilitado en esta vista." };
  }
  if (!UUID.test(recordId)) return { ok: false, error: "La selección contiene identificadores inválidos." };
  const user = await requirePermission(view.entity, "update");
  const entity = requireEntity(view.entity);
  const field = entity.fields.find((candidate) => candidate.key === view.group_by && candidate.type === "enum");
  if (!field?.options?.some((option) => option.key === targetKey)) return { ok: false, error: "La columna de destino no es válida." };
  try {
    await withTransaction((client) => updateOne({
      client,
      actorId: user.id,
      entityKey: entity.key,
      recordId,
      values: { [field.key]: targetKey },
      source: { kind: "kanban", view: view.key, field: field.key },
    }));
  } catch (error) {
    return resultError(error);
  }
  revalidateEntity(entity.key, view.key);
  return { ok: true, updated: 1 };
}

function timezoneParts(value: unknown, timezone: string) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.valueOf())) throw new Error("Fecha inválida.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour), minute: Number(map.minute), second: Number(map.second),
  };
}

function timezoneOffset(date: Date, timezone: string) {
  const part = timezoneParts(date, timezone);
  return Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second) - date.getTime();
}

function zonedIso(dateKey: string, current: unknown, timezone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const time = timezoneParts(current, timezone);
  const local = Date.UTC(year, month - 1, day, time.hour, time.minute, time.second);
  let guess = local;
  for (let index = 0; index < 3; index += 1) guess = local - timezoneOffset(new Date(guess), timezone);
  return new Date(guess).toISOString();
}

function dateKey(value: unknown, timezone: string) {
  if (typeof value === "string" && DATE_KEY.test(value.slice(0, 10)) && !value.includes("T")) return value.slice(0, 10);
  const part = timezoneParts(value, timezone);
  return `${part.year}-${String(part.month).padStart(2, "0")}-${String(part.day).padStart(2, "0")}`;
}

function dayDelta(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function rescheduledValue(field: FieldSpec, current: unknown, targetDate: string, timezone: string) {
  return field.type === "date" ? targetDate : zonedIso(targetDate, current, timezone);
}

export async function rescheduleRecordAction(viewKey: string, recordId: string, targetDate: string): Promise<RecordOperationResult> {
  const view = requireView(viewKey);
  if (view.type !== "calendar" || !view.entity || !view.allow_reschedule || !view.date_field) {
    return { ok: false, error: "La reprogramación no está habilitada en esta vista." };
  }
  if (!UUID.test(recordId)) return { ok: false, error: "La selección contiene identificadores inválidos." };
  if (!validDateKey(targetDate)) return { ok: false, error: "La fecha de destino no es válida." };
  const user = await requirePermission(view.entity, "update");
  const entity = requireEntity(view.entity);
  const startField = entity.fields.find((candidate) => candidate.key === view.date_field && ["date", "datetime"].includes(candidate.type));
  const endField = view.end_date_field
    ? entity.fields.find((candidate) => candidate.key === view.end_date_field && ["date", "datetime"].includes(candidate.type))
    : undefined;
  if (!startField) return { ok: false, error: "El campo de fecha configurado no es válido." };
  const timezone = runtimeSpec.app.timezone ?? "UTC";
  try {
    await withTransaction(async (client) => {
      const before = await getRecord(entity.key, recordId, client, true);
      if (!before) throw new Error("El registro ya no existe.");
      if (!before[startField.key]) throw new Error("Fecha inválida.");
      const values: Record<string, unknown> = {
        [startField.key]: rescheduledValue(startField, before[startField.key], targetDate, timezone),
      };
      if (endField && before[endField.key]) {
        const delta = dayDelta(dateKey(before[startField.key], timezone), targetDate);
        const shiftedEnd = addDays(dateKey(before[endField.key], timezone), delta);
        values[endField.key] = rescheduledValue(endField, before[endField.key], shiftedEnd, timezone);
      }
      const evaluated = applyRules({ entityKey: entity.key, event: "before_update", values, before });
      await updateRecord(entity.key, recordId, evaluated.values, client);
      const after = await getRecord(entity.key, recordId, client);
      await recordAuditEvent(client, {
        actorId: user.id,
        entityKey: entity.key,
        recordId,
        action: "update",
        changes: { before, after, rules: evaluated.applied, source: { kind: "calendar", view: view.key, field: startField.key } },
      });
    });
  } catch (error) {
    return resultError(error);
  }
  revalidateEntity(entity.key, view.key);
  return { ok: true, updated: 1 };
}
