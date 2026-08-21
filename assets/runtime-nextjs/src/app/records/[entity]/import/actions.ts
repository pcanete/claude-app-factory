"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAuditEvent } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { parseAndValidateImport, type ImportIssue } from "@/lib/data-transfer";
import { withTransaction } from "@/lib/db";
import { completeImportBatch, createImportBatch, lockImportBatch } from "@/lib/import-batches";
import { getRecord, insertRecord } from "@/lib/repository";
import { applyRules } from "@/lib/rules";
import { requireEntity } from "@/lib/spec";

export type ImportFormState = {
  issues: ImportIssue[];
};

export async function previewImportAction(
  entityKey: string,
  _previousState: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const user = await requirePermission(entityKey, "create");
  const entity = requireEntity(entityKey);
  const file = formData.get("file");
  if (!(file instanceof File)) return { issues: [{ row: 0, message: "Seleccioná un archivo CSV o Excel." }] };

  let validation;
  try {
    validation = await parseAndValidateImport(entity, file);
  } catch (error) {
    return { issues: [{ row: 0, message: error instanceof Error ? error.message : "No se pudo leer el archivo." }] };
  }
  if (validation.issues.length) return { issues: validation.issues.slice(0, 100) };
  const batchId = await createImportBatch({
    actorId: user.id,
    entityKey,
    fileName: file.name.slice(0, 240),
    rows: validation.rows,
  });
  redirect(`/records/${entityKey}/import?batch=${batchId}`);
}

export async function confirmImportAction(entityKey: string, batchId: string) {
  const user = await requirePermission(entityKey, "create");
  requireEntity(entityKey);
  let imported = 0;
  let failed = false;
  try {
    await withTransaction(async (client) => {
      const batch = await lockImportBatch(client, batchId, user.id, entityKey);
      if (!batch || batch.status !== "ready" || batch.rows.length !== batch.row_count) {
        throw new Error("La vista previa venció o ya fue procesada.");
      }
      for (const row of batch.rows) {
        const evaluated = applyRules({ entityKey, event: "before_create", values: row.values });
        const appliedRules = [...(row.rules ?? []), ...evaluated.applied].filter(
          (rule, index, rules) => rules.findIndex((candidate) => candidate.ruleKey === rule.ruleKey) === index,
        );
        const recordId = await insertRecord(entityKey, evaluated.values, client);
        const after = await getRecord(entityKey, recordId, client);
        await recordAuditEvent(client, {
          actorId: user.id,
          entityKey,
          recordId,
          action: "create",
          changes: {
            after,
            rules: appliedRules,
            import: { batchId: batch.id, fileName: batch.file_name, rowNumber: row.rowNumber },
          },
        });
      }
      imported = batch.row_count;
      await completeImportBatch(client, batch.id);
    });
  } catch {
    failed = true;
  }
  if (failed) redirect(`/records/${entityKey}/import?batch=${batchId}&error=commit`);
  revalidatePath("/");
  revalidatePath(`/records/${entityKey}`);
  revalidatePath("/audit");
  redirect(`/records/${entityKey}?imported=${imported}`);
}
