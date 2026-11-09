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
  // En el panel, decidir va primero: es lo único que no puede hacer la IA, y lo que frena al resto.
  if (pendientes.para_revisar.length) {
    const n = pendientes.para_revisar.length;
    return n === 1
      ? "Tenés una decisión pendiente: mientras no decidas, ese caso no avanza."
      : `Tenés ${n} decisiones pendientes: mientras no decidas, esos casos no avanzan.`;
  }
  if (pendientes.para_seguir.length) return "Seguí con lo que ya tenés tomado.";
  if (pendientes.disponibles.length) return "Elegí uno de los disponibles para tomarlo.";
  if (pendientes.con_problemas?.length) {
    return "Lo único pendiente son casos trabados por la definición de su proceso: empezá por corregirla.";
  }
  return "No tenés nada pendiente ahora.";
}
