import { listAgentEvents, listManagedAgents } from "@/platform/mcp/admin";
import { requireAuditAccess } from "@/lib/auth";
import { formatDateTimeValue } from "@/lib/presentation";
import { runtimeSpec } from "@/lib/spec";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  await requireAuditAccess();
  const [agents, events] = await Promise.all([listManagedAgents(), listAgentEvents()]);
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Operación mediante MCP</p>
          <h1>Agentes</h1>
          <p className="subtitle">Identidades autorizadas, alcances de lectura o escritura y sus últimas ejecuciones.</p>
        </div>
      </div>

      <section>
        <div className="section-heading"><h2>Identidades</h2></div>
        <div className="table-wrap">
          {agents.length ? (
            <table className="audit-table">
              <thead><tr><th>Agente</th><th>Rol</th><th>Estado</th><th>Vencimiento</th><th>Último uso</th><th>Llamadas</th></tr></thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id}>
                    <td><strong>{agent.name}</strong><div className="table-secondary">{agent.scopes.join(", ")}</div></td>
                    <td>{agent.role_label}</td>
                    <td><span className={`user-status ${agent.active ? "on" : "off"}`}>{agent.active ? "Activo" : "Inactivo"}</span></td>
                    <td>{agent.expires_at ? formatDateTimeValue(agent.expires_at, runtimeSpec.app.locale) : "Sin vencimiento"}</td>
                    <td>{agent.last_used_at ? formatDateTimeValue(agent.last_used_at, runtimeSpec.app.locale) : "Nunca"}</td>
                    <td>{agent.event_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty">Todavía no hay agentes MCP. Creá uno con <code>pnpm mcp:agent:create</code>.</div>}
        </div>
      </section>

      <section>
        <div className="section-heading"><h2>Actividad reciente</h2></div>
        <div className="table-wrap">
          {events.length ? (
            <table className="audit-table">
              <thead><tr><th>Fecha</th><th>Agente</th><th>Herramienta</th><th>Entidad</th><th>Estado</th><th>Resultado</th><th>Entrada</th></tr></thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTimeValue(event.started_at, runtimeSpec.app.locale)}</td>
                    <td>{event.agent_name}</td>
                    <td><code>{event.tool_name}</code></td>
                    <td>{event.entity_key ?? "—"}</td>
                    <td><span className={`audit-badge ${event.status === "failed" ? "delete" : event.status === "completed" ? "create" : "update"}`}>{event.status}</span></td>
                    <td>{event.result_count ?? "—"}{event.duration_ms === null ? "" : ` · ${event.duration_ms} ms`}</td>
                    <td><details><summary>Ver entrada</summary><pre className="audit-json">{JSON.stringify(event.input_summary, null, 2)}</pre>{event.error_message && <p className="error-text">{event.error_message}</p>}</details></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty">Todavía no hay actividad de agentes.</div>}
        </div>
      </section>
    </>
  );
}
