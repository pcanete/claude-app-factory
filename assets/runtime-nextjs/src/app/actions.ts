"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAuditEvent } from "@/lib/audit";
import { deleteAttachmentsForRecord } from "@/lib/attachments";
import { hasPermission, requirePermission } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { deleteRecord, getRecord, insertRecord, recordInputFromForm, updateRecord } from "@/lib/repository";
import { applyRules, RuleBlockedError } from "@/lib/rules";
import { requireEntity } from "@/lib/spec";

export async function createRecordAction(entityKey: string, formData: FormData) {
  const user = await requirePermission(entityKey, "create");
  const entity = requireEntity(entityKey);
  const values = recordInputFromForm(entity, formData, "create");
  let id: string | null = null;
  let blockedMessage: string | null = null;
  try {
    id = await withTransaction(async (client) => {
      const evaluated = applyRules({ entityKey, event: "before_create", values });
      const recordId = await insertRecord(entityKey, evaluated.values, client);
      const after = await getRecord(entityKey, recordId, client);
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
  revalidatePath("/");
  revalidatePath(`/records/${entityKey}`);
  revalidatePath("/audit");
  redirect(hasPermission(user, entityKey, "read") ? `/records/${entityKey}/${id}` : `/records/${entityKey}`);
}

export async function updateRecordAction(entityKey: string, id: string, formData: FormData) {
  const user = await requirePermission(entityKey, "update");
  const entity = requireEntity(entityKey);
  const values = recordInputFromForm(entity, formData, "update");
  let blockedMessage: string | null = null;
  try {
    await withTransaction(async (client) => {
      const before = await getRecord(entityKey, id, client, true);
      if (!before) throw new Error("El registro que intentás modificar ya no existe.");
      const evaluated = applyRules({ entityKey, event: "before_update", values, before });
      await updateRecord(entityKey, id, evaluated.values, client);
      const after = await getRecord(entityKey, id, client);
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
  revalidatePath("/");
  revalidatePath(`/records/${entityKey}`);
  revalidatePath(`/records/${entityKey}/${id}`);
  revalidatePath("/audit");
  redirect(`/records/${entityKey}/${id}`);
}

export async function deleteRecordAction(entityKey: string, id: string) {
  const user = await requirePermission(entityKey, "delete");
  requireEntity(entityKey);
  let blockedMessage: string | null = null;
  try {
    await withTransaction(async (client) => {
      const before = await getRecord(entityKey, id, client, true);
      if (!before) throw new Error("El registro que intentás eliminar ya no existe.");
      const evaluated = applyRules({ entityKey, event: "before_delete", values: {}, before });
      const deletedAttachments = await deleteAttachmentsForRecord(client, entityKey, id);
      await deleteRecord(entityKey, id, client);
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
  revalidatePath("/");
  revalidatePath(`/records/${entityKey}`);
  revalidatePath("/audit");
  redirect(`/records/${entityKey}`);
}
