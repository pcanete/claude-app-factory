import { listAuditEvents, type AuditAction } from "@/lib/audit";
import { requireAuditAccess } from "@/lib/auth";
import { formatValue } from "@/lib/presentation";
import { runtimeSpec } from "@/lib/spec";

export const dynamic = "force-dynamic";

const actions: Array<{ key: AuditAction; label: string }> = [
  { key: "create", label: "Creación" },
  { key: "update", label: "Modificación" },
  { key: "delete", label: "Eliminación" },
  { key: "attachment_create", label: "Archivo adjuntado" },
  { key: "attachment_delete", label: "Archivo eliminado" },
  { key: "user_create", label: "Usuario creado" },
  { key: "user_update", label: "Usuario modificado" },
  { key: "user_status", label: "Estado de usuario" },
];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; action?: string }>;
}) {
  await requireAuditAccess();
  const requested = await searchParams;
  const auditEntities = [
    ...runtimeSpec.entities.map((entity) => ({ key: entity.key, label: entity.label, labelPlural: entity.label_plural })),
    { key: "app_user", label: "Usuario", labelPlural: "Usuarios" },
  ];
  const entityKey = auditEntities.some((entity) => entity.key === requested.entity)
    ? requested.entity
    : undefined;
  const action = actions.some((candidate) => candidate.key === requested.action)
    ? requested.action as AuditAction
    : undefined;
  const events = await listAuditEvents({ entityKey, action });
  const entityLabels = Object.fromEntries(auditEntities.map((entity) => [entity.key, entity.label]));
  const actionLabels = Object.fromEntries(actions.map((candidate) => [candidate.key, candidate.label]));

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Control interno</p>
          <h1>Auditoría</h1>
          <p className="subtitle">Últimos 200 cambios registrados por el runtime.</p>
        </div>
      </div>
      <form className="toolbar">
        <select aria-label="Filtrar por entidad" className="control audit-filter" defaultValue={entityKey ?? ""} name="entity">
          <option value="">Todas las entidades</option>
          {auditEntities.map((entity) => (
            <option key={entity.key} value={entity.key}>{entity.labelPlural}</option>
          ))}
        </select>
        <select aria-label="Filtrar por acción" className="control audit-filter" defaultValue={action ?? ""} name="action">
          <option value="">Todas las acciones</option>
          {actions.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>{candidate.label}</option>
          ))}
        </select>
        <button className="button secondary" type="submit">Filtrar</button>
      </form>
      <div className="table-wrap">
        {events.length ? (
          <table className="audit-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Entidad</th>
                <th>Acción</th>
                <th>Registro</th>
                <th>Cambios</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatValue(event.created_at, runtimeSpec.app.locale)}</td>
                  <td>
                    <div>{event.actor_name ?? "Usuario eliminado"}</div>
                    <div className="table-secondary">{event.actor_email ?? "—"}</div>
                  </td>
                  <td>{entityLabels[event.entity_key] ?? event.entity_key}</td>
                  <td><span className={`audit-badge ${event.action}`}>{actionLabels[event.action]}</span></td>
                  <td><code className="record-id">{event.record_id ?? "—"}</code></td>
                  <td>
                    <details>
                      <summary>Ver cambios</summary>
                      <pre className="audit-json">{JSON.stringify(event.changes, null, 2)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">Todavía no hay eventos de auditoría para estos filtros.</div>}
      </div>
    </>
  );
}
