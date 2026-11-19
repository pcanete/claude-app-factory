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
 * Una imagen guardada dos veces (mismo nombre y mismo MD5, como en `repetidos.ts`) entra una
 * sola vez: si una subida repetida dejó lo producido duplicado, la vista previa no lo copia.
 *
 * Sin dependencias: `scripts/test-almacen.mjs` prueba este archivo.
 */
export type ArchivoCandidato = { original_name: string; content_type: string; size_bytes: number; md5: string };

export function elegirVistaPrevia<T extends ArchivoCandidato>(
  archivos: readonly T[],
  politica: { maxFiles: number; maxSizeBytes: number; allowedTypes: string[] },
): T[] {
  const permitido = (tipo: string) => politica.allowedTypes.some((candidato) =>
    candidato.endsWith("/*") ? tipo.startsWith(candidato.slice(0, -1)) : tipo === candidato);
  const vistos = new Set<string>();
  return archivos
    .filter((archivo) => {
      const clave = `${archivo.original_name}\u0000${archivo.md5.toLowerCase()}`;
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    })
    .filter((archivo) => {
      const tipo = archivo.content_type.toLowerCase();
      return tipo.startsWith("image/") && permitido(tipo) && archivo.size_bytes > 0 && archivo.size_bytes <= politica.maxSizeBytes;
    })
    .sort(porNombre)
    .slice(0, Math.max(0, politica.maxFiles));
}

/** Orden natural de nombre: slide-02 antes que slide-10. */
export function porNombre(a: { original_name: string }, b: { original_name: string }) {
  return a.original_name.localeCompare(b.original_name, "es", { numeric: true });
}

export type AdjuntoExistente = { original_name: string; md5: string };

/**
 * Qué imágenes de lo producido faltan en la vista previa (2.5.6).
 *
 * Sin vista previa, son las que elige `elegirVistaPrevia`. Con vista previa, sólo se completa
 * si salió de lo producido —cada imagen adjunta es una copia (mismo nombre y MD5) de un
 * archivo guardado—: así, si se borró un archivo y se volvió a subir, su lámina vuelve. Si
 * alguien eligió la vista previa a mano (una portada que no está en lo producido), no se
 * toca. Nunca agrega una copia de algo que ya está, ni pasa del máximo de adjuntos.
 *
 * `adjuntos` son las imágenes adjuntas; `totalAdjuntos`, todos los adjuntos del registro.
 */
export function vistaPreviaQueFalta<T extends ArchivoCandidato>(
  guardados: readonly T[],
  adjuntos: readonly AdjuntoExistente[],
  totalAdjuntos: number,
  politica: { maxFiles: number; maxSizeBytes: number; allowedTypes: string[] },
): T[] {
  const clave = (a: { original_name: string; md5: string }) => `${a.original_name}\u0000${a.md5.toLowerCase()}`;
  if (!adjuntos.length) return elegirVistaPrevia(guardados, { ...politica, maxFiles: politica.maxFiles - totalAdjuntos });
  const deLoProducido = new Set(guardados.map(clave));
  if (!adjuntos.every((adjunto) => deLoProducido.has(clave(adjunto)))) return [];
  const presentes = new Set(adjuntos.map(clave));
  return elegirVistaPrevia(guardados, { ...politica, maxFiles: Number.MAX_SAFE_INTEGER })
    .filter((archivo) => !presentes.has(clave(archivo)))
    .slice(0, Math.max(0, politica.maxFiles - totalAdjuntos));
}
