"use client";

import { useActionState, useState } from "react";
import { regenerateAgentTokenAction, type AgentRotateState } from "@/app/agents/actions";

const initialState: AgentRotateState = { status: "idle" };

/**
 * Regenerar la clave de una conexión que ya existe.
 *
 * Las credenciales vencen (90 días por defecto) y antes la única salida era crear otra
 * conexión, con otro nombre y sin el historial. Esto le da al mismo agente otra clave y
 * otro vencimiento; la anterior deja de servir en el acto. Como al crear, la clave se
 * muestra una sola vez y se copia sin pasar por la pantalla.
 */
export function AgentRotateForm({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [state, action, pending] = useActionState(regenerateAgentTokenAction, initialState);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(false);
  const token = state.token ?? "";
  const variable = state.envVar ?? "";
  const lineaWindows = `[Environment]::SetEnvironmentVariable("${variable}", "${token}", "User")`;
  const lineaPosix = `export ${variable}='${token}'   # y actualizalo en tu perfil`;

  async function copiar(valor: string, clave: string) {
    await navigator.clipboard.writeText(valor);
    setCopiado(clave);
    window.setTimeout(() => setCopiado(null), 1800);
  }

  const oculto = (texto: string) => (mostrar ? texto : texto.replaceAll(token, "<CREDENCIAL>"));

  return (
    <details className="case-cancel agent-rotate">
      <summary>Regenerar clave</summary>
      {state.status !== "success" ? (
        <form action={action}>
          <input name="id" type="hidden" value={agentId} />
          <select aria-label={`Vence si no se usa: clave nueva de ${agentName}`} className="control" defaultValue="90" name="expires_days">
            <option value="30">30 días</option>
            <option value="90">90 días</option>
            <option value="180">180 días</option>
            <option value="365">1 año</option>
          </select>
          <button className="button secondary" disabled={pending} type="submit">{pending ? "Generando…" : "Generar clave nueva"}</button>
          <span className="field-help">Para una clave filtrada o perdida: la actual deja de funcionar en el acto. Se mantienen el nombre, el rol, el responsable y el historial.</span>
          {state.status === "error" && <span aria-live="polite" className="field-help danger-text">{state.message}</span>}
        </form>
      ) : (
        <div aria-live="polite" className="agent-copy-block">
          <span>{state.message}</span>
          <code>{mostrar ? token : "•".repeat(48)}</code>
          <div className="row-actions">
            <button className="button" onClick={() => copiar(token, "token")} type="button">{copiado === "token" ? "Copiada" : "Copiar clave"}</button>
            <button className="text-button" onClick={() => setMostrar((v) => !v)} type="button">{mostrar ? "ocultar" : "mostrar"}</button>
          </div>
          <span className="field-help">
            Si la guardaste en la variable {variable} con el asistente de conexión, actualizala con esta línea en
            PowerShell y reiniciá el cliente. Si la pegaste directo en la configuración del cliente, reemplazala ahí.
          </span>
          <code>{oculto(lineaWindows)}</code>
          <button className="button secondary" onClick={() => copiar(lineaWindows, "win")} type="button">{copiado === "win" ? "Copiado" : "Copiar línea de PowerShell"}</button>
          <code>{oculto(lineaPosix)}</code>
          <button className="button secondary" onClick={() => copiar(lineaPosix, "posix")} type="button">{copiado === "posix" ? "Copiado" : "Copiar línea de Mac o Linux"}</button>
        </div>
      )}
    </details>
  );
}
