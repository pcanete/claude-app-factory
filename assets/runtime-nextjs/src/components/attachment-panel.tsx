import { deleteAttachmentAction, uploadAttachmentAction } from "@/app/attachments/actions";
import type { AttachmentMetadata, ResolvedAttachmentPolicy } from "@/lib/attachments";
import { formatValue } from "@/lib/presentation";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentPanel({
  entityKey,
  recordId,
  attachments,
  policy,
  canUpdate,
  locale,
}: {
  entityKey: string;
  recordId: string;
  attachments: AttachmentMetadata[];
  policy: ResolvedAttachmentPolicy;
  canUpdate: boolean;
  locale?: string;
}) {
  const uploadAction = uploadAttachmentAction.bind(null, entityKey, recordId);
  const remaining = Math.max(0, policy.maxFiles - attachments.length);

  return (
    <section className="attachment-panel" aria-labelledby="attachments-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Documentación</p>
          <h2 id="attachments-title">Archivos adjuntos</h2>
        </div>
        <span className="attachment-count">{attachments.length}/{policy.maxFiles}</span>
      </div>
      {canUpdate && remaining > 0 && (
        <form action={uploadAction} className="attachment-upload">
          <input
            accept={policy.allowedTypes.join(",")}
            aria-label="Archivo para adjuntar"
            className="control"
            name="attachment"
            required
            type="file"
          />
          <button className="button" type="submit">Adjuntar archivo</button>
          <p className="field-help">
            Máximo {Math.floor(policy.maxSizeBytes / 1024 / 1024)} MB por archivo · quedan {remaining} lugares.
          </p>
        </form>
      )}
      {attachments.length ? (
        <div className="attachment-list">
          {attachments.map((attachment) => {
            const deleteAction = deleteAttachmentAction.bind(null, entityKey, recordId, attachment.id);
            return (
              <article className="attachment-item" key={attachment.id}>
                <div className="attachment-icon" aria-hidden="true">↧</div>
                <div className="attachment-info">
                  <a className="record-link" href={`/attachments/${attachment.id}`}>{attachment.original_name}</a>
                  <div className="table-secondary">
                    {formatBytes(attachment.size_bytes)} · {attachment.created_by_name ?? "Usuario eliminado"} · {formatValue(attachment.created_at, locale)}
                  </div>
                </div>
                {canUpdate && (
                  <form action={deleteAction}>
                    <button className="text-button danger-text" type="submit">Eliminar</button>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      ) : <div className="empty compact">Este registro todavía no tiene archivos adjuntos.</div>}
    </section>
  );
}
