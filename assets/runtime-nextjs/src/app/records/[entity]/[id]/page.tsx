import { notFound } from "next/navigation";
import { deleteRecordAction } from "@/app/actions";
import { RecordForm } from "@/components/record-form";
import { AttachmentPanel } from "@/components/attachment-panel";
import { listAttachments, resolveAttachmentPolicy } from "@/lib/attachments";
import { canAccessRelationshipOptions, hasPermission, requirePermission } from "@/lib/auth";
import { formatFieldValue, formatValue } from "@/lib/presentation";
import { getRecord, relationshipOptions } from "@/lib/repository";
import { getEntity, runtimeSpec } from "@/lib/spec";

export const dynamic = "force-dynamic";

export default async function RecordDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string; id: string }>;
  searchParams: Promise<{ rule_error?: string; attachment_error?: string; attachment_success?: string }>;
}) {
  const [{ entity: entityKey, id }, query] = await Promise.all([params, searchParams]);
  const entity = getEntity(entityKey);
  if (!entity) notFound();
  const user = await requirePermission(entity.key, "read");
  const canUpdate = hasPermission(user, entity.key, "update");
  const canDelete = hasPermission(user, entity.key, "delete");
  const canEditRelationships = canAccessRelationshipOptions(user, entity);
  const attachmentPolicy = resolveAttachmentPolicy(entity);
  const [record, options, attachments] = await Promise.all([
    getRecord(entity.key, id),
    canUpdate && canEditRelationships ? relationshipOptions(entity) : Promise.resolve({}),
    attachmentPolicy ? listAttachments(entity.key, id) : Promise.resolve([]),
  ]);
  if (!record) notFound();
  const deleteAction = deleteRecordAction.bind(null, entity.key, id);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">{entity.label}</p>
          <h1>{formatValue(record[entity.title_field], runtimeSpec.app.locale)}</h1>
          <p className="subtitle">Ficha y edición del registro.</p>
        </div>
        {canDelete && <form action={deleteAction}>
          <button className="button danger" type="submit">Eliminar</button>
        </form>}
      </div>
      {query.rule_error && <div className="notice rule-blocked">{query.rule_error}</div>}
      {query.attachment_error && <div className="notice rule-blocked">{query.attachment_error}</div>}
      {query.attachment_success === "1" && <div className="notice success">Archivo adjuntado correctamente.</div>}
      <section className="detail-list" aria-label="Resumen del registro">
        {entity.fields.map((field) => (
          <div className="detail-item" key={field.key}>
            <div className="detail-key">{field.label}</div>
            <div className="detail-value">{formatFieldValue(field, record[field.key], runtimeSpec.app.locale)}</div>
          </div>
        ))}
      </section>
      {attachmentPolicy && (
        <>
          <div style={{ height: 24 }} />
          <AttachmentPanel
            attachments={attachments}
            canUpdate={canUpdate}
            entityKey={entity.key}
            locale={runtimeSpec.app.locale}
            policy={attachmentPolicy}
            recordId={id}
          />
        </>
      )}
      {canUpdate && canEditRelationships ? (
        <>
          <div style={{ height: 24 }} />
          <RecordForm entity={entity} record={record} relationshipOptions={options} />
        </>
      ) : (
        <div className="notice readonly">Vista de sólo lectura para el rol actual.</div>
      )}
    </>
  );
}
