/**
 * Qué imágenes de lo producido sirven de vista previa de una iteración.
 *
 * Las láminas de un carrusel se suben con subir_producido y, hasta 2.5.3, había que volver
 * a mandarlas con adjuntar_a_iteracion para que se vieran en el panel. Ese segundo paso
 * necesita una credencial de agente guardada en la máquina, y quien se conecta con su
 * propia cuenta no la tiene: subía todo y la iteración quedaba incompleta igual. Ahora,
 * al confirmar, la aplicación toma las imágenes que ya tiene y las deja como vista previa.
 *
 * Sólo imágenes que el panel acepta como adjunto, que no superen el tamaño máximo, en el
 * orden de sus nombres (slide-02 antes que slide-10) y hasta el máximo de archivos.
 *
 * Sin dependencias: `scripts/test-almacen.mjs` prueba este archivo.
 */
export type ArchivoCandidato = { original_name: string; content_type: string; size_bytes: number };

export function elegirVistaPrevia<T extends ArchivoCandidato>(
  archivos: readonly T[],
  politica: { maxFiles: number; maxSizeBytes: number; allowedTypes: string[] },
): T[] {
  const permitido = (tipo: string) => politica.allowedTypes.some((candidato) =>
    candidato.endsWith("/*") ? tipo.startsWith(candidato.slice(0, -1)) : tipo === candidato);
  return archivos
    .filter((archivo) => {
      const tipo = archivo.content_type.toLowerCase();
      return tipo.startsWith("image/") && permitido(tipo) && archivo.size_bytes > 0 && archivo.size_bytes <= politica.maxSizeBytes;
    })
    .sort((a, b) => a.original_name.localeCompare(b.original_name, "es", { numeric: true }))
    .slice(0, Math.max(0, politica.maxFiles));
}
