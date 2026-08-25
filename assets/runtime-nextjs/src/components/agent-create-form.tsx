"use client";

import { useActionState, useState } from "react";
import { createAgentAction, type AgentCreateState } from "@/app/agents/actions";

type RoleOption = { key: string; label: string };
type PersonOption = { id: string; name: string };
type ClientKey = "claude" | "codex" | "json" | "manual";

const initialState: AgentCreateState = { status: "idle" };

const CLIENTES: Array<{ key: ClientKey; label: string; donde: string }> = [
  { key: "claude", label: "Claude Code", donde: "una terminal" },
  { key: "codex", label: "Codex", donde: "PowerShell" },
  { key: "json", label: "Archivo de configuración", donde: "el archivo del cliente" },
  { key: "manual", label: "Datos sueltos", donde: "cualquier otro cliente" },
];

/**
 * El asistente de conexión.
 *
 * Dos cosas que parecen detalles y no lo son:
 *
 * 1. **El nombre de la conexión lo decide el servidor**, derivado del nombre del agente y
 *    de la aplicación. Cada cliente MCP guarda sus servidores en una lista donde el nombre
 *    es la clave: dos entradas con el mismo nombre no dan error, la segunda reemplaza a la
 *    primera y una conexión desaparece.
 * 2. **La credencial no va dentro del comando.** Un comando pegado en la terminal queda en
 *    el historial del shell, en texto plano, para siempre. Se guarda primero en una
 *    variable de entorno y el comando la referencia por nombre.
 */
export function AgentCreateForm({
  roles,
  people,
  defaultOwnerId,
}: {
  roles: RoleOption[];
  people: PersonOption[];
  defaultOwnerId: string;
}) {
  const [state, action, pending] = useActionState(createAgentAction, initialState);
  const [cliente, setCliente] = useState<ClientKey>("claude");
  const [copiado, setCopiado] = useState<string | null>(null);
  const [mostrarCredencial, setMostrarCredencial] = useState(false);

  const token = state.token ?? "";
  const conexion = state.connectionName ?? "";
  const variable = state.envVar ?? "";
  const endpoint = typeof window !== "undefined" ? `${window.location.origin}/api/mcp` : "/api/mcp";

  // Windows y POSIX guardan variables de entorno de forma distinta; el resto del comando
  // es igual. Las comillas simples evitan que el shell expanda `${...}` antes de tiempo:
  // el literal tiene que llegar a la configuración del cliente, no su valor.
  const guardarVariable = `[Environment]::SetEnvironmentVariable("${variable}", "${token}", "User")`;
  const guardarVariablePosix = `export ${variable}='${token}'   # y agregalo a tu perfil`;

  const bloques: Record<ClientKey, { texto: string; nota: string }> = {
    claude: {
      texto: `${guardarVariable}\nclaude mcp add --transport http ${conexion} --scope user ${endpoint} --header 'Authorization: Bearer \${${variable}}'`,
      nota: "Pegá las dos líneas en PowerShell. En Mac o Linux usá la variante de abajo para la primera línea. Cerrá y volvé a abrir el cliente para que lea la variable.",
    },
    codex: {
      texto: `${guardarVariable}\ncodex mcp add ${conexion} --url "${endpoint}" --bearer-token-env-var ${variable}`,
      nota: "Pegá las dos líneas en PowerShell. Cerrá y volvé a abrir Codex para que lea la variable.",
    },
    json: {
      texto: JSON.stringify(
        {
          mcpServers: {
            [conexion]: {
              type: "http",
              url: endpoint,
              headers: { Authorization: `Bearer \${${variable}}` },
            },
          },
        },
        null,
        2,
      ),
      nota: "Para clientes que se configuran por archivo. Requiere que la variable de entorno exista en la máquina.",
    },
    manual: {
      texto: `Endpoint:   ${endpoint}\nNombre:     ${conexion}\nEncabezado: Authorization: Bearer <credencial>`,
      nota: "Para cualquier cliente que pida los datos por separado. La credencial está arriba.",
    },
  };

  async function copiar(valor: string, clave: string) {
    await navigator.clipboard.writeText(valor);
    setCopiado(clave);
    window.setTimeout(() => setCopiado(null), 1800);
  }

  return (
    <div className="agent-create-layout">
      <form action={action} className="form-card agent-create-form">
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Nombre de la conexión</span>
            <input className="control" defaultValue="Claude" maxLength={120} name="name" required />
            <span className="field-help">Por ejemplo: Claude, Riel o Generador web.</span>
          </label>
          <label className="field">
            <span className="field-label">Rol</span>
            <select className="control" defaultValue="admin" name="role_key">
              {roles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
            </select>
            <span className="field-help">Define sobre qué entidades puede trabajar.</span>
          </label>
          <label className="field">
            <span className="field-label">Permisos</span>
            <select className="control" defaultValue="write" name="access">
              <option value="read">Sólo consultar</option>
              <option value="write">Consultar y modificar</option>
              <option value="full">Control total, incluso eliminar</option>
              <option value="admin">Control total y configuración del sistema</option>
            </select>
            <span className="field-help">
              Recomendado: consultar y modificar. La configuración del sistema se otorga
              aparte y sólo funciona si el rol elegido ya puede administrar.
            </span>
          </label>
          <label className="field">
            <span className="field-label">Responsable</span>
            <select className="control" defaultValue={defaultOwnerId} name="owner_user_id">
              {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
            <span className="field-help">
              Quién se hace cargo de lo que haga esta conexión. Toda su actividad queda a
              nombre de esa persona.
            </span>
          </label>
          <label className="field">
            <span className="field-label">Vencimiento</span>
            <select className="control" defaultValue="90" name="expires_days">
              <option value="30">30 días</option>
              <option value="90">90 días</option>
              <option value="180">180 días</option>
              <option value="365">1 año</option>
            </select>
            <span className="field-help">Después deberá crearse una credencial nueva.</span>
          </label>
        </div>
        {state.status === "error" && <div aria-live="polite" className="notice import-error agent-form-notice">{state.message}</div>}
        <div className="form-actions">
          <button className="button" disabled={pending} type="submit">{pending ? "Creando…" : "Crear conexión"}</button>
        </div>
      </form>

      {state.status === "success" && token && (
        <aside aria-live="polite" className="agent-token-card">
          <div>
            <p className="eyebrow">Conexión lista</p>
            <h3>{state.agentName}</h3>
          </div>
          <p>{state.message}</p>

          <div className="agent-copy-block">
            <span>
              Credencial
              <button className="text-button" onClick={() => setMostrarCredencial((v) => !v)} type="button">
                {mostrarCredencial ? "ocultar" : "mostrar"}
              </button>
            </span>
            <code>{mostrarCredencial ? token : "•".repeat(48)}</code>
            <button className="button secondary" onClick={() => copiar(token, "token")} type="button">
              {copiado === "token" ? "Copiada" : "Copiar credencial"}
            </button>
            <span className="field-help">
              Se muestra una sola vez. Queda guardada como hash: si se pierde, se emite otra.
            </span>
          </div>

          <div className="agent-copy-block">
            <span>Nombre de la conexión</span>
            <code>{conexion}</code>
            <span className="field-help">
              Lleva el nombre de esta aplicación adelante para que no pise otra conexión ya
              instalada en la misma máquina.
            </span>
          </div>

          <div className="client-tabs" role="tablist">
            {CLIENTES.map((opcion) => (
              <button
                aria-selected={cliente === opcion.key}
                className={`client-tab ${cliente === opcion.key ? "active" : ""}`}
                key={opcion.key}
                onClick={() => setCliente(opcion.key)}
                role="tab"
                type="button"
              >
                {opcion.label}
              </button>
            ))}
          </div>

          <div className="agent-copy-block">
            <span>Pegar en {CLIENTES.find((o) => o.key === cliente)?.donde}</span>
            <code>{mostrarCredencial ? bloques[cliente].texto : bloques[cliente].texto.replaceAll(token, "<CREDENCIAL>")}</code>
            <button className="button" onClick={() => copiar(bloques[cliente].texto, cliente)} type="button">
              {copiado === cliente ? "Copiado" : "Copiar"}
            </button>
            <span className="field-help">{bloques[cliente].nota}</span>
          </div>

          {(cliente === "claude" || cliente === "codex") && (
            <div className="agent-copy-block">
              <span>En Mac o Linux, la primera línea</span>
              <code>{mostrarCredencial ? guardarVariablePosix : guardarVariablePosix.replaceAll(token, "<CREDENCIAL>")}</code>
              <button className="button secondary" onClick={() => copiar(guardarVariablePosix, "posix")} type="button">
                {copiado === "posix" ? "Copiada" : "Copiar"}
              </button>
            </div>
          )}

          <p className="field-help">
            La credencial va en una variable de entorno y el comando la nombra: así no queda
            en el historial del shell ni en el archivo de configuración.
          </p>
        </aside>
      )}
    </div>
  );
}
