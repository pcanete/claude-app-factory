import Link from "@/components/enlace";
import { listManagedUsers } from "@/platform/users/store";
import { conNombresDePersonas } from "@/lib/people-display";
import { ownerFieldRestriction, recordAccessForUser } from "@/lib/record-access";
import { notFound } from "next/navigation";
import { deleteRecordAction } from "@/app/actions";
import { RecordForm } from "@/components/record-form";
import { RecordProperty } from "@/components/record-property";
import { AttachmentPanel } from "@/components/attachment-panel";
import { listAttachments, resolveAttachmentPolicy } from "@/lib/attachments";
import { canAccessRelationshipOptions, hasPermission, requirePermission } from "@/lib/auth";
import { formatDateTimeValue, formatFieldValue, formatValue } from "@/lib/presentation";
import { camposDeLinea, entidadesHijas, repartirCampos, seEditaEnElLugar } from "@/lib/record-layout";
import { getRecord, listRecords, relationshipOptions } from "@/lib/repository";
import { getEntity, relationFields, runtimeSpec, type EntitySpec, type FieldSpec } from "@/lib/spec";
import type { RecordAccessContext } from "@/lib/record-access";
import type { RuntimeUser } from "@/lib/auth-types";
import { TextoLargo } from "@/components/texto-largo";

export const dynamic = "force-dynamic";

/** Cuántos registros relacionados de cada entidad se muestran: los últimos. */
const LIMITE_RELACIONADOS = 50;

function valorLegible(field: FieldSpec, valor: unknown) {
  return field.type === "long_text" && typeof valor === "string" && valor.trim()
    ? <TextoLargo texto={valor} />
    : formatFieldValue(field, valor, runtimeSpec.app.locale);
}

/**
 * Lo relacionado: cada entidad que apunta a este registro, como línea de tiempo con lo
 * último al final. Sólo las que quien mira puede leer, y con su mismo alcance por registro.
 */
async function relacionados(entity: EntitySpec, id: string, user: RuntimeUser, access: RecordAccessContext) {
  const hijas = entidadesHijas(runtimeSpec.entities, entity.key)
    .filter(({ entidad }) => hasPermission(user, entidad.key, "read"));
  return Promise.all(hijas.map(async ({ entidad, relacion }) => {
    const hija = getEntity(entidad.key)!;
    const registros = await listRecords(hija.key, {
      filters: { [relacion.key]: id },
      sort: "created_at",
      direction: "desc",
      limit: LIMITE_RELACIONADOS,
      access,
    });
    return {
      entidad: hija,
      relacion,
      registros: (await conNombresDePersonas(hija, registros)).reverse(),
      puedeCrear: hasPermission(user, hija.key, "create"),
    };
  }));
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
  const canSeeRelationships = canAccessRelationshipOptions(user, entity);
  const attachmentPolicy = resolveAttachmentPolicy(entity);
  const [record, options, attachments, relacionadosDe] = await Promise.all([
    getRecord(entity.key, id, undefined, false, access),
    canSeeRelationships ? relationshipOptions(entity, access) : Promise.resolve({} as Record<string, Array<{ id: string; label: string }>>),
    attachmentPolicy ? listAttachments(entity.key, id) : Promise.resolve([]),
    relacionados(entity, id, user, access),
  ]);
  if (!record) notFound();
  const deleteAction = deleteRecordAction.bind(null, entity.key, id);

  // Sólo se cargan si la entidad tiene algún campo de tipo persona: no vale la pena
  // consultar usuarios para un formulario que no los usa.
  const personas = canUpdate && entity.fields.some((field) => field.type === "person")
    ? (await listManagedUsers({ active: true, limit: 200 })).map((persona) => ({
        id: persona.id,
        name: persona.displayName,
      }))
    : undefined;

  const restriccionDeDueno = ownerFieldRestriction(entity, access);
  // Para mostrar: los campos de persona con el nombre. El formulario sigue con el id.
  const [paraMostrar] = await conNombresDePersonas(entity, [record]);
  const { principales, propiedades } = repartirCampos(entity);
  const textos = principales.filter((field) => {
    const valor = paraMostrar[field.key];
    return valor !== null && valor !== undefined && valor !== "";
  });

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">{entity.label}</p>
          <h1>{formatValue(record[entity.title_field], runtimeSpec.app.locale)}</h1>
        </div>
        {canDelete && <form action={deleteAction}>
          <button className="button danger small" type="submit">Eliminar</button>
        </form>}
      </div>
      {query.rule_error && <div className="notice rule-blocked">{query.rule_error}</div>}
      {query.attachment_error && <div className="notice rule-blocked">{query.attachment_error}</div>}
      {query.attachment_success === "1" && <div className="notice success">Archivo adjuntado correctamente.</div>}

      <div className="record-layout">
        <div className="record-main">
          {textos.map((field) => (
            <section className="record-text" key={field.key}>
              <h2 className="record-section-title">{field.label}</h2>
              <div className="detail-value">{valorLegible(field, paraMostrar[field.key])}</div>
            </section>
          ))}
          {!textos.length && principales.length > 0 && <p className="table-secondary">Sin {principales.map((f) => f.label.toLowerCase()).join(" ni ")}.</p>}

          {relacionadosDe.map(({ entidad, relacion, registros, puedeCrear }) => {
            const linea = camposDeLinea(entidad);
            const campo = (clave: string | null) => clave ? entidad.fields.find((f) => f.key === clave) : undefined;
            const etiqueta = campo(linea.etiqueta);
            const detalle = campo(linea.detalle);
            const fecha = campo(linea.fecha);
            return (
              <section className="record-timeline" key={`${entidad.key}-${relacion.key}`}>
                <div className="record-section-head">
                  <h2 className="record-section-title">{entidad.label_plural} <span className="group-count">{registros.length}</span></h2>
                  {puedeCrear && (
                    <Link className="button secondary small" href={`/records/${entidad.key}/new?${relacion.key}_id=${encodeURIComponent(id)}`}>
                      Nueva {entidad.label.toLowerCase()}
                    </Link>
                  )}
                </div>
                {registros.length ? (
                  <ol className="timeline">
                    {registros.map((hijo) => (
                      <li className="timeline-item" key={String(hijo.id)}>
                        <div className="timeline-head">
                          {etiqueta && hijo[etiqueta.key] ? <span className="badge">{formatFieldValue(etiqueta, hijo[etiqueta.key], runtimeSpec.app.locale)}</span> : null}
                          <Link className="record-link" href={`/records/${entidad.key}/${hijo.id}`}>{formatValue(hijo[linea.titulo], runtimeSpec.app.locale)}</Link>
                          <span className="timeline-meta">
                            {linea.persona && hijo[linea.persona] ? `${String(hijo[linea.persona])} · ` : ""}
                            {fecha && hijo[fecha.key] ? formatFieldValue(fecha, hijo[fecha.key], runtimeSpec.app.locale) : formatDateTimeValue(hijo.created_at, runtimeSpec.app.locale)}
                          </span>
                        </div>
                        {detalle && typeof hijo[detalle.key] === "string" && String(hijo[detalle.key]).trim() && (
                          <div className="timeline-body"><TextoLargo texto={String(hijo[detalle.key])} /></div>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : <p className="table-secondary">Todavía no hay {entidad.label_plural.toLowerCase()}.</p>}
              </section>
            );
          })}

          {attachmentPolicy && (
            <AttachmentPanel
              attachments={attachments}
              canUpdate={canUpdate}
              entityKey={entity.key}
              locale={runtimeSpec.app.locale}
              policy={attachmentPolicy}
              recordId={id}
            />
          )}

          {canUpdate && canSeeRelationships ? (
            <details className="record-edit">
              <summary>Editar todos los campos</summary>
              <RecordForm entity={entity} ownerRestriction={restriccionDeDueno} people={personas} record={record} relationshipOptions={options} />
            </details>
          ) : (
            <div className="notice readonly">Vista de sólo lectura para el rol actual.</div>
          )}
        </div>

        <aside aria-label="Propiedades" className="record-aside">
          <dl className="properties">
            {propiedades.map((field) => (
              <div className="property" key={field.key}>
                <dt>{field.label}</dt>
                <dd>
                  {canUpdate && seEditaEnElLugar(field)
                    ? <RecordProperty entityKey={entity.key} field={field} recordId={id} value={record[field.key]} />
                    : valorLegible(field, paraMostrar[field.key])}
                </dd>
              </div>
            ))}
            {relationFields(entity).map((relacion) => {
              const destino = record[`${relacion.key}_id`];
              const etiqueta = typeof destino === "string"
                ? (options[relacion.key] ?? []).find((opcion) => opcion.id === destino)?.label
                : undefined;
              return (
                <div className="property" key={relacion.key}>
                  <dt>{relacion.label}</dt>
                  <dd>
                    {typeof destino !== "string" ? "—"
                      : hasPermission(user, relacion.target, "read")
                        ? <Link className="record-link" href={`/records/${relacion.target}/${destino}`}>{etiqueta ?? "Abrir"}</Link>
                        : etiqueta ?? "—"}
                  </dd>
                </div>
              );
            })}
            <div className="property">
              <dt>Actualizado</dt>
              <dd>{formatDateTimeValue(record.updated_at, runtimeSpec.app.locale)}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </>
  );
}
