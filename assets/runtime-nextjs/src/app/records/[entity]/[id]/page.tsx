import { listManagedUsers } from "@/platform/users/store";
import { conNombresDePersonas } from "@/lib/people-display";
import { ownerFieldRestriction, recordAccessForUser } from "@/lib/record-access";
import { notFound } from "next/navigation";
import { deleteRecordAction } from "@/app/actions";
import { RecordForm } from "@/components/record-form";
import { AttachmentPanel } from "@/components/attachment-panel";
import { listAttachments, resolveAttachmentPolicy } from "@/lib/attachments";
import { canAccessRelationshipOptions, hasPermission, requirePermission } from "@/lib/auth";
import { formatFieldValue, formatValue } from "@/lib/presentation";
import { getRecord, relationshipOptions } from "@/lib/repository";
import { getEntity, runtimeSpec, type FieldSpec } from "@/lib/spec";
import { TextoLargo } from "@/components/texto-largo";

export const dynamic = "force-dynamic";

const esCampoLargo = (field: FieldSpec) => ["long_text", "json", "file"].includes(field.type);

/**
 * Los datos cortos primero, de a dos por fila; los textos largos después, a todo el ancho.
 * Un texto largo en media columna, al lado de una fecha, no se puede leer.
 */
function camposEnOrdenDeLectura(fields: FieldSpec[]) {
  return [...fields.filter((field) => !esCampoLargo(field)), ...fields.filter(esCampoLargo)];
}

/** Con un número impar de datos cortos, el último ocupa la fila entera: no queda un hueco. */
function ocupaLaFila(fields: FieldSpec[], field: FieldSpec) {
  if (esCampoLargo(field)) return true;
  const cortos = fields.filter((f) => !esCampoLargo(f));
  return cortos.length % 2 === 1 && cortos[cortos.length - 1] === field;
}

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
  const access = recordAccessForUser(user);
  const canUpdate = hasPermission(user, entity.key, "update");
  const canDelete = hasPermission(user, entity.key, "delete");
  const canEditRelationships = canAccessRelationshipOptions(user, entity);
  const attachmentPolicy = resolveAttachmentPolicy(entity);
  const [record, options, attachments] = await Promise.all([
    getRecord(entity.key, id, undefined, false, access),
    canUpdate && canEditRelationships ? relationshipOptions(entity, access) : Promise.resolve({}),
    attachmentPolicy ? listAttachments(entity.key, id) : Promise.resolve([]),
  ]);
  if (!record) notFound();
  const deleteAction = deleteRecordAction.bind(null, entity.key, id);

  // Sólo se cargan si la entidad tiene algún campo de tipo persona: no vale la pena
  // consultar usuarios para un formulario que no los usa.
  const personas = entity.fields.some((field) => field.type === "person")
    ? (await listManagedUsers({ active: true, limit: 200 })).map((persona) => ({
        id: persona.id,
        name: persona.displayName,
      }))
    : undefined;

  const restriccionDeDueno = ownerFieldRestriction(entity, access);
  // Para mostrar: los campos de persona con el nombre. El formulario sigue con el id.
  const [paraMostrar] = await conNombresDePersonas(entity, [record]);

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
        {camposEnOrdenDeLectura(entity.fields).map((field) => {
          const valor = paraMostrar[field.key];
          return (
            <div className={`detail-item${ocupaLaFila(entity.fields, field) ? " full" : ""}`} key={field.key}>
              <div className="detail-key">{field.label}</div>
              <div className="detail-value">
                {field.type === "long_text" && typeof valor === "string" && valor.trim()
                  ? <TextoLargo texto={valor} />
                  : formatFieldValue(field, valor, runtimeSpec.app.locale)}
              </div>
            </div>
          );
        })}
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
          <RecordForm entity={entity} ownerRestriction={restriccionDeDueno} people={personas} record={record} relationshipOptions={options} />
        </>
      ) : (
        <div className="notice readonly">Vista de sólo lectura para el rol actual.</div>
      )}
    </>
  );
}
