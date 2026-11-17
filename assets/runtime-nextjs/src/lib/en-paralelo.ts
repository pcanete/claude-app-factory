/**
 * Aplica una función asíncrona a cada elemento, con a lo sumo `limite` en vuelo a la vez,
 * y devuelve los resultados en el mismo orden que la entrada.
 *
 * Para consultas de red independientes (un HEAD por archivo): en serie, el tiempo de la
 * función es la suma de todas las esperas, y en un plan que cobra duración de funciones
 * eso es lo que se paga. El límite evita abrir cien conexiones de golpe. Si una falla,
 * falla todo, como fallaría el bucle en serie que reemplaza.
 *
 * Sin dependencias: `scripts/test-almacen.mjs` lo prueba.
 */
export async function enParalelo<T, R>(elementos: readonly T[], limite: number, funcion: (elemento: T, indice: number) => Promise<R>): Promise<R[]> {
  const resultados = new Array<R>(elementos.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < elementos.length) {
      const indice = siguiente++;
      resultados[indice] = await funcion(elementos[indice], indice);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, elementos.length)) }, trabajador));
  return resultados;
}
