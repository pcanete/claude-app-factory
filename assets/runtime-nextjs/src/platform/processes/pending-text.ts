/**
 * Qué hacer primero, dicho para una persona que mira el panel.
 *
 * `mis_pendientes` trae su propio `como_seguir`, pero está escrito para una IA y nombra
 * herramientas (`tomar_caso`, `revisar_etapa`). En la pantalla lo lee alguien que no las usa.
 */
export function comoSeguirEnElPanel(pendientes: {
  para_seguir: unknown[];
  para_revisar: unknown[];
  disponibles: unknown[];
  con_problemas?: unknown[];
}) {
  if (pendientes.para_seguir.length) return "Empezá por lo que ya tenés tomado.";
  if (pendientes.para_revisar.length) {
    return "Hay trabajo de otras personas esperando tu revisión: mientras no lo revises, no avanza.";
  }
  if (pendientes.disponibles.length) return "Elegí uno de los disponibles para tomarlo.";
  if (pendientes.con_problemas?.length) {
    return "Lo único pendiente son casos trabados por la definición de su proceso: empezá por corregirla.";
  }
  return "No tenés nada pendiente ahora.";
}
