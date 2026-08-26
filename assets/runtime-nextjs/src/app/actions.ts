"use server";

import { redirect } from "next/navigation";
import { recordAuditEvent } from "@/lib/audit";
import { deleteAttachmentsForRecord } from "@/lib/attachments";
import { hasPermission, requirePermission } from "@/lib/auth";
import {
  assertRecordOwnershipChange,
  prepareRecordCreate,
  recordAccessForUser,
} from "@/lib/record-access";
import { withTransaction } from "@/lib/db";
import { deleteRecord, getRecord, insertRecord, recordInputFromForm, updateRecord } from "@/lib/repository";
import { applyRules, RuleBlockedError } from "@/lib/rules";
import { requireEntity } from "@/lib/spec";
import { revalidateAfterWrite } from "@/lib/revalidation";

export async function createRecordAction(entityKey: string, formData: FormData) {
  const user = await requirePermission(entityKey, "create");
  const access = recordAccessForUser(user);
  const entity = requireEntity(entityKey);
  const values = prepareRecordCreate(entity, recordInputFromForm(entity, formData, "create"), access);
  let id: string | null = null;
  let blockedMessage: string | null = null;
  try {
    id = await withTransaction(async (client) => {
      const evaluated = applyRules({ entityKey, event: "before_create", values });
      const recordId = await insertRecord(entityKey, evaluated.values, client, access);
      const after = await getRecord(entityKey, recordId, client, false, access);
      await recordAuditEvent(client, {
        actorId: user.id,
        entityKey,
        recordId,
        action: "create",
        changes: { after, rules: evaluated.applied },
      });
      return recordId;
    });
  } catch (error) {
    if (error instanceof RuleBlockedError) blockedMessage = error.message;
    else throw error;
  }
  if (blockedMessage) redirect(`/records/${entityKey}/new?rule_error=${encodeURIComponent(blockedMessage)}`);
  if (!id) throw new Error("No se pudo crear el registro.");
  revalidateAfterWrite(entityKey);
  redirect(hasPermission(user, entityKey, "read") ? `/records/${entityKey}/${id}` : `/records/${entityKey}`);
}

export async function updateRecordAction(entityKey: string, id: string, formData: FormData) {
  const user = await requirePermission(entityKey, "update");
  const access = recordAccessForUser(user);
  const entity = requireEntity(entityKey);
  const values = recordInputFromForm(entity, formData, "update");
  assertRecordOwnershipChange(entity, values, access);
  let blockedMessage: string | null = null;
  try {
    await withTransaction(async (client) => {
      const before = await getRecord(entityKey, id, client, true, access);
      if (!before) throw new Error("El registro que intentás modificar ya no existe.");
      const evaluated = applyRules({ entityKey, event: "before_update", values, before });
      await updateRecord(entityKey, id, evaluated.values, client, access);
      const after = await getRecord(entityKey, id, client, false, access);
      await recordAuditEvent(client, {
        actorId: user.id,
        entityKey,
        recordId: id,
        action: "update",
        changes: { before, after, rules: evaluated.applied },
      });
    });
  } catch (error) {
    if (error instanceof RuleBlockedError) blockedMessage = error.message;
    else throw error;
  }
  if (blockedMessage) redirect(`/records/${entityKey}/${id}?rule_error=${encodeURIComponent(blockedMessage)}`);
  revalidateAfterWrite(entityKey, id);
  redirect(`/records/${entityKey}/${id}`);
}

export async function deleteRecordAction(entityKey: string, id: string) {
  const user = await requirePermission(entityKey, "delete");
  const access = recordAccessForUser(user);
  requireEntity(entityKey);
  let blockedMessage: string | null = null;
  try {
    await withTransaction(async (client) => {
      const before = await getRecord(entityKey, id, client, true, access);
      if (!before) throw new Error("El registro que intentás eliminar ya no existe.");
      const evaluated = applyRules({ entityKey, event: "before_delete", values: {}, before });
      const deletedAttachments = await deleteAttachmentsForRecord(client, entityKey, id);
      await deleteRecord(entityKey, id, client, access);
      await recordAuditEvent(client, {
        actorId: user.id,
        entityKey,
        recordId: id,
        action: "delete",
        changes: { before, attachments: deletedAttachments, rules: evaluated.applied },
      });
    });
  } catch (error) {
    if (error instanceof RuleBlockedError) blockedMessage = error.message;
    else throw error;
  }
  if (blockedMessage) redirect(`/records/${entityKey}/${id}?rule_error=${encodeURIComponent(blockedMessage)}`);
  revalidateAfterWrite(entityKey);
  redirect(`/records/${entityKey}`);
}
