import Link from "next/link";
import { deleteAgentAction, setAgentOwnerAction, setAgentStatusAction } from "@/app/agents/actions";
import { AgentCreateForm } from "@/components/agent-create-form";
import { countAgentEvents, listAgentEvents, listManagedAgents } from "@/platform/mcp/admin";
import { Pagination } from "@/components/pagination";
import { requireUserManagementAccess } from "@/lib/auth";
import { listManagedUsers } from "@/platform/users/store";
import { formatDateTimeValue } from "@/lib/presentation";
import { runtimeSpec } from "@/lib/spec";

export const dynamic = "force-dynamic";

const successMessages: Record<string, string> = {
  revoked: "El acceso fue revocado inmediatamente.",
  reactivated: "La conexión volvió a estar activa.",
  deleted: "La conexión se eliminó. No tenía actividad registrada.",
  owner: "Cambió el responsable de la conexión.",
};

// Un agente es una identidad con un rol: crearlo equivale a delegar ese rol,
// así que se gobierna con la misma capacidad que administra personas.
export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; page?: string }>;
}) {
  const actor = await requireUserManagementAccess();
  const requested = await searchParams;
  const POR_PAGINA = 25;
  const totalEventos = await countAgentEvents();
  const paginas = Math.max(1, Math.ceil(totalEventos / POR_PAGINA));
  const solicitada = Number(requested.page ?? "1");
  const page = Number.isInteger(solicitada) && solicitada > 0 ? Math.min(solicitada, paginas) : 1;
  const personas = await listManagedUsers({ active: true, limit: 200 });
  const [agents, events] = await Promise.all([
    listManagedAgents(),
    listAgentEvents({ limit: POR_PAGINA, offset: (page - 1) * POR_PAGINA }),
  ]);
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Operación mediante MCP</p>
          <h1>Agentes</h1>
          <p className="subtitle">Creá y controlá conexiones para Claude, Riel u otros agentes sin usar la terminal.</p>
        </div>
      </div>
      {requested.error === "not_found" && <div className="notice import-error">La conexión solicitada no existe.</div>}
      {requested.error === "con_historial" && (
        <div className="notice import-error">
          Esa conexión ya operó, así que no se elimina: su actividad quedaría sin dueño en la
          auditoría. Revocala — deja de funcionar en el acto y conserva el historial.
        </div>
      )}
      {requested.saved && successMessages[requested.saved] && <div className="notice success">{successMessages[requested.saved]}</div>}

      <section>
        <div className="section-heading"><div><h2>Nueva conexión</h2><p className="subtitle">Elegí qué puede hacer y copiá el acceso listo para usar.</p></div></div>
        <AgentCreateForm
          defaultOwnerId={actor.id}
          people={personas.map((persona) => ({ id: persona.id, name: persona.displayName }))}
          roles={runtimeSpec.roles.map((role) => ({ key: role.key, label: role.label }))}
        />
      </section>

      <section>
        <div className="section-heading"><div><h2>Conexiones existentes</h2><p className="subtitle">
            Revocar corta el acceso en el acto y conserva el historial. Eliminar sólo está
            disponible para conexiones que nunca se usaron.
          </p></div></div>
        <div className="table-wrap">
          {agents.length ? (
            <table className="audit-table">
              <thead><tr><th>Agente</th><th>Rol</th><th>Responsable</th><th>Estado</th><th>Vencimiento</th><th>Último uso</th><th>Llamadas</th><th>Acción</th></tr></thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id}>
                    <td><strong>{agent.name}</strong><div className="table-secondary">{agent.scopes.join(", ")}</div></td>
                    <td>{agent.role_label}</td>
                    <td>
                      <form action={setAgentOwnerAction} className="owner-cell">
                        <input name="id" type="hidden" value={agent.id} />
                        <select className="control" defaultValue={agent.owner_user_id ?? ""} name="owner_user_id">
                          {!agent.owner_user_id && <option value="">Sin responsable</option>}
                          {personas.map((persona) => (
                            <option key={persona.id} value={persona.id}>{persona.displayName}</option>
                          ))}
                        </select>
                        <button className="text-button" type="submit">Cambiar</button>
                      </form>
                    </td>
                    <td><span className={`user-status ${agent.active ? "on" : "off"}`}>{agent.active ? "Activo" : "Inactivo"}</span></td>
                    <td>{agent.expires_at ? formatDateTimeValue(agent.expires_at, runtimeSpec.app.locale) : "Sin vencimiento"}</td>
                    <td>{agent.last_used_at ? formatDateTimeValue(agent.last_used_at, runtimeSpec.app.locale) : "Nunca"}</td>
                    <td>{agent.event_count}</td>
                    <td>
                      <div className="row-actions">
                        <form action={setAgentStatusAction}>
                          <input name="id" type="hidden" value={agent.id} />
                          <input name="active" type="hidden" value={agent.active ? "false" : "true"} />
                          <button className={`button ${agent.active ? "danger" : "secondary"}`} type="submit">{agent.active ? "Revocar" : "Reactivar"}</button>
                        </form>
                        {Number(agent.event_count) === 0 && (
                          <form action={deleteAgentAction}>
                            <input name="id" type="hidden" value={agent.id} />
                            <button className="text-button danger-text" type="submit">Eliminar</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty">Todavía no hay conexiones. Creá la primera con el formulario de arriba.</div>}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <h2>Actividad</h2>
            <p className="subtitle">
              Lo que hacen los agentes se registra junto con lo que hacen las personas, en
              una sola línea de tiempo: <Link className="record-link" href="/audit?source=agent">ver la actividad de agentes</Link>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
