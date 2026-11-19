/**
 * Cómo llega un campo sí/no desde el formulario del panel.
 *
 * Uno obligatorio es una casilla: marcada llega "on", sin marcar no llega (null) y es `false`.
 * Uno opcional tiene tres estados —sí, no y sin valor— y una casilla sólo tiene dos: guardar
 * el formulario sin tocar nada convertía «sin valor» en «no» (2.5.6). Por eso el opcional es
 * un selector que manda "true", "false" o "" (sin valor, `null`).
 *
 * Sin dependencias: `scripts/test-form-boolean.mjs` prueba este archivo.
 */
export function booleanoDeFormulario(raw: unknown, requerido: boolean): boolean | null {
  if (raw === "true" || raw === "on") return true;
  if (raw === "false") return false;
  if (requerido) return false;
  // Opcional: vacío es sin valor. Sin el campo en el formulario (null), también: no se inventa un «no».
  return null;
}

/** El valor del selector de un sí/no opcional. */
export function valorDeSelectorBooleano(valor: unknown) {
  return valor === true ? "true" : valor === false ? "false" : "";
}
