import "server-only";
import { getSetting } from "@/platform/settings/store";
import { runtimeSpec } from "@/lib/spec";
import type { AgentPrincipal } from "@/platform/mcp/store";
import {
  CLAVE_INSTRUCCIONES,
  NAMESPACE_INSTRUCCIONES,
  componerInstrucciones,
} from "@/platform/mcp/instructions-text";

/**
 * Instrucciones de servidor: lo que todo cliente MCP recibe al conectarse, antes de
 * llamar a ninguna herramienta. Es el manual de inducción que llega a cualquier IA
 * —la de la organización o la que cada persona compró— sin instalar nada.
 *
 * El texto es de la organización, no de la fábrica: vive en la configuración
 * (`mcp` / `instrucciones`) y se edita sin desplegar. Cómo se arma está en
 * `instructions-text.ts`, separado para poder probarlo sin base ni servidor.
 *
 * Nunca falla: si la configuración no se puede leer, la conexión sigue con la base.
 * Unas instrucciones que faltan empobrecen la sesión; un servidor que no arranca la
 * impide, y eso es peor.
 */
export async function instruccionesPara(principal: AgentPrincipal) {
  let valor: unknown = null;
  try {
    const setting = await getSetting(NAMESPACE_INSTRUCCIONES, CLAVE_INSTRUCCIONES);
    valor = setting?.value ?? null;
  } catch (error) {
    console.error("No se pudieron leer las instrucciones MCP", error);
  }
  const rolEtiqueta = runtimeSpec.roles.find((rol) => rol.key === principal.roleKey)?.label ?? principal.roleKey;
  return componerInstrucciones(
    {
      aplicacion: runtimeSpec.app.name,
      descripcion: runtimeSpec.app.description,
      nombre: principal.name,
      rol: principal.roleKey,
      rolEtiqueta,
      tipo: principal.kind,
      persona: principal.kind === "user" ? principal.id : principal.ownerUserId ?? null,
    },
    valor,
  );
}
