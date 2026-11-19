/**
 * Cuándo dos archivos de lo producido son el mismo.
 *
 * Un archivo es el mismo si tiene el mismo nombre y el mismo MD5: los mismos bytes con el
 * mismo nombre. Con eso alcanza para que repetir una subida —después de un error a mitad de
 * camino, o porque el script se volvió a correr entero— no deje cada archivo dos veces en lo
 * producido ni en la vista previa. Un archivo con el mismo nombre y otro contenido es otro
 * archivo: no se pisa nada que ya estaba guardado.
 *
 * Sin dependencias: `scripts/test-almacen.mjs` prueba este archivo.
 */
export type ArchivoComparable = { original_name: string; md5: string };

export function claveDeArchivo(archivo: ArchivoComparable) {
  return `${archivo.original_name}\u0000${archivo.md5.toLowerCase()}`;
}

/**
 * Separa los pendientes que hay que comprobar de los que repiten un archivo ya guardado o
 * a otro pendiente igual (se queda el primero en el orden en que llegan). Los repetidos se
 * descartan sin consultar el almacén: lo que representan ya está, o va a estar.
 */
export function separarRepetidos<T extends ArchivoComparable>(guardados: readonly ArchivoComparable[], pendientes: readonly T[]) {
  const vistos = new Set(guardados.map(claveDeArchivo));
  const unicos: T[] = [];
  const repetidos: T[] = [];
  for (const archivo of pendientes) {
    const clave = claveDeArchivo(archivo);
    if (vistos.has(clave)) repetidos.push(archivo);
    else {
      vistos.add(clave);
      unicos.push(archivo);
    }
  }
  return { unicos, repetidos };
}

/** El primero de cada archivo, en el orden en que llegan. */
export function sinRepetidos<T extends ArchivoComparable>(archivos: readonly T[]) {
  return separarRepetidos([], archivos).unicos;
}
