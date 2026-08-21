"use client";

import { useActionState, useState } from "react";
import { createAgentAction, type AgentCreateState } from "@/app/agents/actions";

type RoleOption = { key: string; label: string };

const initialState: AgentCreateState = { status: "idle" };

export function AgentCreateForm({ roles }: { roles: RoleOption[] }) {
  const [state, action, pending] = useActionState(createAgentAction, initialState);
  const [copied, setCopied] = useState<"token" | "command" | null>(null);
  const token = state.token ?? "";
  const command = token && typeof window !== "undefined"
    ? `claude mcp add --transport http factory --scope user ${window.location.origin}/api/mcp --header "Authorization: Bearer ${token}"`
    : "";

  async function copy(value: string, kind: "token" | "command") {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
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
            </select>
            <span className="field-help">Recomendado: consultar y modificar.</span>
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
          <div><p className="eyebrow">Conexión lista</p><h3>{state.agentName}</h3></div>
          <p>{state.message}</p>
          <div className="agent-copy-block">
            <span>Credencial</span>
            <code>{token}</code>
            <button className="button secondary" onClick={() => copy(token, "token")} type="button">{copied === "token" ? "Copiada" : "Copiar credencial"}</button>
          </div>
          <div className="agent-copy-block">
            <span>Claude Code</span>
            <code>{command}</code>
            <button className="button" onClick={() => copy(command, "command")} type="button">{copied === "command" ? "Copiado" : "Copiar comando listo"}</button>
          </div>
          <p className="field-help">Pegá el comando en PowerShell. La credencial no se guarda en texto plano y no puede recuperarse.</p>
        </aside>
      )}
    </div>
  );
}
