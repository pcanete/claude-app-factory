import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * El ticket de subida: lo que permite que un script suba lo producido sin ninguna clave.
 *
 * Hasta 2.5.x el script del equipo leía una credencial de agente de un archivo de la
 * máquina para pedir las direcciones de subida. Esas credenciales vencen, y reemplazarlas
 * en un archivo oculto no es algo que una persona sin perfil técnico sepa hacer. Ahora la
 * IA pide la subida con el conector de la persona (que entra con su cuenta y no vence) y
 * recibe un ticket: una dirección firmada que vale una hora y sólo sirve para traer las
 * direcciones de subida de esa iteración. El script lo usa y no necesita nada más.
 *
 * El ticket no se guarda: es `iteracion.vence.firma`, firmado con una clave del servidor.
 * Da el mismo poder que las direcciones firmadas que ya devolvía subir_producido —subir los
 * archivos pendientes de esa iteración, con el MD5 declarado— y nada más.
 *
 * Sin dependencias de la aplicación: `scripts/test-almacen.mjs` prueba este archivo.
 */
function firma(clave: string, iteracion: string, vence: number) {
  return createHmac("sha256", clave).update(`subidas:${iteracion}:${vence}`).digest("base64url");
}

export function firmarTicket(clave: string, iteracion: string, segundos = 3600, ahora = new Date()) {
  const vence = Math.floor(ahora.getTime() / 1000) + segundos;
  return { ticket: `${iteracion}.${vence}.${firma(clave, iteracion, vence)}`, vence: new Date(vence * 1000).toISOString() };
}

/** La iteración del ticket si la firma es buena y no venció; si no, null. */
export function verificarTicket(clave: string, ticket: string, ahora = new Date()): string | null {
  const partes = ticket.split(".");
  if (partes.length !== 3) return null;
  const [iteracion, venceTexto, recibida] = partes;
  if (!/^[0-9a-f-]{36}$/i.test(iteracion) || !/^\d{1,12}$/.test(venceTexto)) return null;
  const vence = Number(venceTexto);
  if (vence * 1000 <= ahora.getTime()) return null;
  const esperada = Buffer.from(firma(clave, iteracion, vence));
  const dada = Buffer.from(recibida);
  if (esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) return null;
  return iteracion;
}
