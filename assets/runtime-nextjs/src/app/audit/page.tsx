import {
  countActivityEvents,
  listActivityAgents,
  listActivityEvents,
  RETENCION_POR_DEFECTO_DIAS,
  type ActivitySource,
} from "@/lib/audit";
import { ActivityOrganism } from "@/components/activity-organism";
import { Pagination } from "@/components/pagination";
import { getSetting } from "@/platform/settings/store";
import { requireAuditAccess } from "@/lib/auth";
import { formatValue } from "@/lib/presentation";
import { runtimeSpec } from "@/lib/spec";

export const dynamic = "force-dynamic";

/**
 * Una sola pantalla para toda la actividad.
 *
 * Antes había dos: los cambios de datos acá y las llamadas de los agentes en `/agents`.
 * Para reconstruir qué pasó había que mirar las dos y ordenarlas de memoria. Ahora es una
 * línea de tiempo, con el origen como filtro en vez de como pantalla aparte.
 */
const acciones: Array<{ key: string; label: string }> = [
  { key: "create", label: "Creación" },
  { key: "update", label: "Modificación" },
  { key: "delete", label: "Eliminación" },
  { key: "attachment_create", label: "Archivo adjuntado" },
  { key: "attachment_delete", label: "Archivo eliminado" },
  { key: "user_create", label: "Usuario creado" },
  { key: "user_update", label: "Usuario modificado" },
  { key: "user_status", label: "Estado de usuario" },
  { key: "user_invite", label: "Invitación enviada" },
  { key: "user_link", label: "Identidad vinculada" },
  { key: "setting_save", label: "Opción guardada" },
  { key: "setting_delete", label: "Opción eliminada" },
  { key: "agent_create", label: "Conexión de agente creada" },
  { key: "agent_status", label: "Acceso de agente modificado" },
  { key: "agent_owner", label: "Responsable de agente cambiado" },
];

const POR_PAGINA = 50;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    entity?: string;
    action?: string;
    source?: string;
    agent?: string;
    page?: string;
  }>;
}) {
  await requireAuditAccess();
  const requested = await searchParams;

  const entidades = [
    ...runtimeSpec.entities.map((entity) => ({ key: entity.key, label: entity.label, labelPlural: entity.label_plural })),
    { key: "app_user", label: "Usuario", labelPlural: "Usuarios" },
    { key: "app_user_setting", label: "Preferencia", labelPlural: "Preferencias" },
    { key: "app_setting", label: "Configuración", labelPlural: "Configuración" },
    { key: "app_agent", label: "Agente", labelPlural: "Agentes" },
  ];

  const agentes = await listActivityAgents();
  const entityKey = entidades.some((entity) => entity.key === requested.entity) ? requested.entity : undefined;
  const source = requested.source === "human" || requested.source === "agent"
    ? (requested.source as ActivitySource)
    : undefined;
  // La acción no se valida contra el catálogo: las herramientas MCP también son acciones
  // y su nombre lo pone el servidor, no esta lista.
  const action = requested.action?.trim() || undefined;
  const agentId = agentes.some((agente) => agente.id === requested.agent) ? requested.agent : undefined;

  const filtros = { entityKey, action, source, agentId };
  const total = await countActivityEvents(filtros);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const solicitada = Number(requested.page ?? "1");
  const page = Number.isInteger(solicitada) && solicitada > 0 ? Math.min(solicitada, paginas) : 1;
  const eventos = await listActivityEvents({
    ...filtros,
    limit: POR_PAGINA,
    offset: (page - 1) * POR_PAGINA,
  });

  const retencionGuardada = await getSetting("auditoria", "retencion_dias");
  const retencion = typeof retencionGuardada?.value === "number"
    ? retencionGuardada.value
    : RETENCION_POR_DEFECTO_DIAS;

  const etiquetasDeEntidad = Object.fromEntries(entidades.map((entity) => [entity.key, entity.label]));
  const etiquetasDeAccion = Object.fromEntries(acciones.map((candidate) => [candidate.key, candidate.label]));

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Control interno</p>
          <h1>Actividad</h1>
          <p className="subtitle">
            {total.toLocaleString("es-AR")} registros de lo que hicieron personas y agentes.
            Se conservan {retencion} días; lo anterior se vence solo. No se edita ni se borra
            a mano: si se pudiera elegir qué sacar, dejaría de ser evidencia.
          </p>
        </div>
      </div>

      <ActivityOrganism entityLabels={etiquetasDeEntidad} events={eventos} total={total} />

      <form className="toolbar">
        <select aria-label="Filtrar por origen" className="control audit-filter" defaultValue={source ?? ""} name="source">
          <option value="">Personas y agentes</option>
          <option value="human">Sólo personas</option>
          <option value="agent">Sólo agentes</option>
        </select>
        <select aria-label="Filtrar por agente" className="control audit-filter" defaultValue={agentId ?? ""} name="agent">
          <option value="">Cualquier agente</option>
          {agentes.map((agente) => <option key={agente.id} value={agente.id}>{agente.name}</option>)}
        </select>
        <select aria-label="Filtrar por entidad" className="control audit-filter" defaultValue={entityKey ?? ""} name="entity">
          <option value="">Todas las entidades</option>
          {entidades.map((entity) => <option key={entity.key} value={entity.key}>{entity.labelPlural}</option>)}
        </select>
        <select aria-label="Filtrar por acción" className="control audit-filter" defaultValue={action ?? ""} name="action">
          <option value="">Todas las acciones</option>
          {acciones.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label}</option>)}
        </select>
        <button className="button secondary" type="submit">Filtrar</button>
      </form>

      <div className="table-wrap">
        {eventos.length ? (
          <table className="audit-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Quién</th>
                <th>Responsable</th>
                <th>Entidad</th>
                <th>Acción</th>
                <th>Resultado</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {eventos.map((evento) => (
                <tr key={evento.event_key}>
                  <td data-label="Fecha">{formatValue(evento.created_at, runtimeSpec.app.locale)}</td>
                  <td data-label="Quién">
                    <div>
                      {evento.source === "agent"
                        ? evento.agent_name ?? "Agente eliminado"
                        : evento.actor_name ?? "Identidad eliminada"}
                    </div>
                    <div className="table-secondary">
                      {evento.source === "agent" ? "Agente · MCP" : evento.actor_email ?? "Persona"}
                    </div>
                  </td>
                  <td data-label="Responsable">
                    {evento.responsible_name ?? <span className="table-secondary">Sin responsable</span>}
                  </td>
                  <td data-label="Entidad">
                    {evento.entity_key ? etiquetasDeEntidad[evento.entity_key] ?? evento.entity_key : "—"}
                  </td>
                  <td data-label="Acción">
                    <span className={`audit-badge ${evento.action}`}>
                      {etiquetasDeAccion[evento.action] ?? evento.action}
                    </span>
                  </td>
                  <td data-label="Resultado">
                    {evento.status === "failed"
                      ? <span className="danger-text">Falló</span>
                      : evento.result_count === null
                        ? <code className="record-id">{evento.record_id ?? "—"}</code>
                        : `${evento.result_count}${evento.duration_ms === null ? "" : ` · ${evento.duration_ms} ms`}`}
                  </td>
                  <td data-label="Detalle">
                    <details>
                      <summary>Ver detalle</summary>
                      <pre className="audit-json">{JSON.stringify(evento.details, null, 2)}</pre>
                      {evento.error_message && <p className="danger-text">{evento.error_message}</p>}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">Todavía no hay actividad para estos filtros.</div>}
      </div>
      {total > POR_PAGINA && (
        <Pagination baseHref="/audit" page={page} pageSize={POR_PAGINA} query={requested} total={total} />
      )}
    </>
  );
}
