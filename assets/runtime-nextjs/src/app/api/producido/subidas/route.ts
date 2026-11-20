import { subidasDelTicket } from "@/platform/processes/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Las direcciones para subir lo producido de una iteración, a cambio de un ticket.
 *
 * Sin sesión ni credencial: la autorización es el ticket que devuelve subir_producido, que
 * vale una hora y sólo sirve para esa iteración (`platform/storage/ticket.ts`). Con esto el
 * script de subida no necesita ninguna clave guardada en la máquina. Un ticket inválido o
 * vencido responde 404, sin decir por qué.
 */
export async function GET(request: Request) {
  const ticket = new URL(request.url).searchParams.get("t") ?? "";
  const resultado = ticket ? await subidasDelTicket(ticket).catch(() => null) : null;
  if (!resultado) return Response.json({ error: "El ticket no vale o venció. Pedí la subida de nuevo con subir_producido." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json(resultado, { headers: { "Cache-Control": "private, no-store" } });
}
