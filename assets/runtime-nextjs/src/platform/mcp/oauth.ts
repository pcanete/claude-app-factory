import "server-only";
import { auth } from "@clerk/nextjs/server";
import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { sql } from "@/lib/db";
import { USER_SCOPES, type AgentPrincipal } from "@/platform/mcp/store";

/**
 * Identidad de una persona que conecta un cliente MCP remoto.
 *
 * Clerk prueba **quién** es; la aplicación decide **qué puede hacer**. El rol sale de
 * `app_user`, igual que cuando esa misma persona entra por el panel, así que conectar
 * Claude no le da un permiso que no tenía sentada frente a la pantalla.
 *
 * Un usuario desactivado o no invitado no opera, aunque su sesión de Clerk sea válida:
 * la identidad se prueba afuera, la autorización se decide acá.
 */
export type OAuthOutcome =
  | { estado: "ok"; principal: AgentPrincipal }
  | { estado: "sin_identidad" }
  | { estado: "sin_vincular" }
  | { estado: "inactivo" }
  | { estado: "no_invitado" };

export async function authenticateOAuthUser(token: string): Promise<OAuthOutcome> {
  const clerkAuth = await auth({ acceptsToken: "oauth_token" });
  const verificado = verifyClerkToken(clerkAuth, token);
  const subject = verificado?.extra?.userId ?? verificado?.clientId;
  if (!subject) return { estado: "sin_identidad" };

  const filas = await sql<{ id: string; display_name: string; role_key: string; active: boolean }>(
    `SELECT id, display_name, role_key, active
       FROM app_user
      WHERE auth_subject = $1
      LIMIT 1`,
    [String(subject)],
  );
  const usuario = filas[0];

  if (!usuario) {
    // La identidad es válida pero no corresponde a ningún usuario vinculado. El caso
    // más común no es un intruso: es alguien invitado que todavía no entró por el
    // panel, y cuyo registro sigue esperando con `auth_subject` pendiente.
    const pendientes = await sql<{ id: string }>(
      `SELECT id FROM app_user WHERE auth_subject LIKE 'pending:%' LIMIT 1`,
    );
    return { estado: pendientes.length ? "sin_vincular" : "no_invitado" };
  }
  if (!usuario.active) return { estado: "inactivo" };

  return {
    estado: "ok",
    principal: {
      id: usuario.id,
      name: usuario.display_name,
      roleKey: usuario.role_key,
      scopes: USER_SCOPES,
      kind: "user",
    },
  };
}

/** Qué decirle a quien no pudo entrar, para que busque el problema donde está. */
export function oauthMessage(outcome: Exclude<OAuthOutcome, { estado: "ok" }>) {
  switch (outcome.estado) {
    case "sin_vincular":
      return "Tu identidad es válida pero todavía no está vinculada: entrá una vez por el navegador a la aplicación y volvé a conectar.";
    case "inactivo":
      return "Tu usuario está desactivado en la aplicación.";
    case "no_invitado":
      return "Tu identidad es válida pero no corresponde a ningún usuario de esta aplicación.";
    default:
      return "Credencial MCP inválida.";
  }
}
