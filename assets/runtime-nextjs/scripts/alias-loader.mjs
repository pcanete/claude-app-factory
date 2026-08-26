/**
 * Resuelve los alias `@/` fuera de Next.
 *
 * Node 24 ejecuta TypeScript quitando los tipos, así que un script puede importar los
 * módulos de `src/` tal como están. Lo único que no entiende es el alias `@/`, que
 * resuelve el bundler. Estas veinte líneas lo suplen.
 *
 * Existe para que las pruebas contra la base ejerzan el código real y no una copia
 * parecida: una prueba de seguridad que reimplementa lo que dice verificar confirma su
 * propia reimplementación, no el sistema.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const raiz = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

export function resolve(especificador, contexto, siguiente) {
  if (!especificador.startsWith("@/")) return siguiente(especificador, contexto);
  const base = resolvePath(raiz, "src", especificador.slice(2));
  for (const candidato of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidato) && !candidato.endsWith("/")) {
      return { url: pathToFileURL(candidato).href, shortCircuit: true };
    }
  }
  return siguiente(especificador, contexto);
}
