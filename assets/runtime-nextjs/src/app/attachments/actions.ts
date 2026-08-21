"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAuditEvent } from "@/lib/audit";
import {
  contentTypeAllowed,
  countAttachments,
  deleteAttachment,
  insertAttachment,
  lockAttachmentSet,
  resolveAttachmentPolicy,
} from "@/lib/attachments";
import { requirePermission } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { getRecord } from "@/lib/repository";
import { requireEntity } from "@/lib/spec";

function detailPath(entityKey: string, recordId: string) {
  return `/records/${entityKey}/${recordId}`;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo procesar el archivo.";
}

function cleanFileName(value: string) {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) throw new Error("El archivo debe tener un nombre válido.");
  if (cleaned.length > 255) throw new Error("El nombre del archivo supera los 255 caracteres.");
  return cleaned;
}

export async function uploadAttachmentAction(entityKey: string, recordId: string, formData: FormData) {
  const user = await requirePermission(entityKey, "update");
  const entity = requireEntity(entityKey);
  const policy = resolveAttachmentPolicy(entity);
  let errorMessage: string | null = null;

  try {
    if (!policy) throw new Error("Esta entidad no admite archivos adjuntos.");
    const candidate = formData.get("attachment");
    if (!(candidate instanceof File) || candidate.size === 0) throw new Error("Seleccioná un archivo para adjuntar.");
    if (candidate.size > policy.maxSizeBytes) {
      throw new Error(`El archivo supera el máximo de ${Math.floor(policy.maxSizeBytes / 1024 / 1024)} MB.`);
    }
    const contentType = candidate.type.toLowerCase() || "application/octet-stream";
    if (!contentTypeAllowed(contentType, policy.allowedTypes)) {
      throw new Error(`El tipo ${contentType} no está permitido para esta entidad.`);
    }
    const originalName = cleanFileName(candidate.name);
    const content = Buffer.from(await candidate.arrayBuffer());
    const sha256 = createHash("sha256").update(content).digest("hex");

    await withTransaction(async (client) => {
      const record = await getRecord(entityKey, recordId, client);
      if (!record) throw new Error("El registro al que querés adjuntar el archivo ya no existe.");
      await lockAttachmentSet(client, entityKey, recordId);
      const currentCount = await countAttachments(client, entityKey, recordId);
      if (currentCount >= policy.maxFiles) throw new Error(`El registro ya alcanzó el máximo de ${policy.maxFiles} archivos.`);
      const attachmentId = await insertAttachment(client, {
        entityKey,
        recordId,
        originalName,
        contentType,
        content,
        sha256,
        actorId: user.id,
      });
      await recordAuditEvent(client, {
        actorId: user.id,
        entityKey,
        recordId,
        action: "attachment_create",
        changes: { attachment: { id: attachmentId, originalName, contentType, sizeBytes: content.length, sha256 } },
      });
    });
  } catch (error) {
    errorMessage = safeMessage(error);
  }

  if (errorMessage) redirect(`${detailPath(entityKey, recordId)}?attachment_error=${encodeURIComponent(errorMessage)}`);
  revalidatePath(detailPath(entityKey, recordId));
  revalidatePath("/audit");
  redirect(`${detailPath(entityKey, recordId)}?attachment_success=1`);
}

export async function deleteAttachmentAction(entityKey: string, recordId: string, attachmentId: string) {
  const user = await requirePermission(entityKey, "update");
  const entity = requireEntity(entityKey);
  let errorMessage: string | null = null;

  try {
    if (!resolveAttachmentPolicy(entity)) throw new Error("Esta entidad no admite archivos adjuntos.");
    await withTransaction(async (client) => {
      await lockAttachmentSet(client, entityKey, recordId);
      const deleted = await deleteAttachment(client, entityKey, recordId, attachmentId);
      if (!deleted) throw new Error("El archivo ya no existe o no pertenece a este registro.");
      await recordAuditEvent(client, {
        actorId: user.id,
        entityKey,
        recordId,
        action: "attachment_delete",
        changes: {
          attachment: {
            id: deleted.id,
            originalName: deleted.original_name,
            contentType: deleted.content_type,
            sizeBytes: deleted.size_bytes,
            sha256: deleted.sha256,
          },
        },
      });
    });
  } catch (error) {
    errorMessage = safeMessage(error);
  }

  if (errorMessage) redirect(`${detailPath(entityKey, recordId)}?attachment_error=${encodeURIComponent(errorMessage)}`);
  revalidatePath(detailPath(entityKey, recordId));
  revalidatePath("/audit");
  redirect(detailPath(entityKey, recordId));
}
