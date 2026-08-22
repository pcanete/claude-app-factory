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
export async function authenticateOAuthUser(token: string): Promise<AgentPrincipal | null> {
  const clerkAuth = await auth({ acceptsToken: "oauth_token" });
  const verificado = verifyClerkToken(clerkAuth, token);
  const subject = verificado?.extra?.userId ?? verificado?.clientId;
  if (!subject) return null;

  const filas = await sql<{ id: string; display_name: string; role_key: string }>(
    `SELECT id, display_name, role_key
       FROM app_user
      WHERE auth_subject = $1 AND active = TRUE
      LIMIT 1`,
    [String(subject)],
  );
  const usuario = filas[0];
  if (!usuario) return null;

  return {
    id: usuario.id,
    name: usuario.display_name,
    roleKey: usuario.role_key,
    scopes: USER_SCOPES,
    kind: "user",
  };
}
