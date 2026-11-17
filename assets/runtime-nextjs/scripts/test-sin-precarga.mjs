/**
 * Ningún enlace precarga páginas dinámicas sin que se pida.
 *
 * `next/link` precarga cada enlace visible, y acá precargar es renderizar en el servidor:
 * el menú lateral sumaba una docena de páginas por visita, y una tabla una por fila. Eso
 * agotó el límite de duración de funciones de un plan gratuito y dejó la aplicación
 * fuera de servicio. Todos los enlaces pasan por `components/enlace.tsx`, que no precarga.
 *
 * Esta prueba falla si algún archivo de src/ importa `next/link` directamente.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("../src/", import.meta.url));
const permitido = join("components", "enlace.tsx");

function archivos(dir) {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.(tsx?|jsx?|mjs)$/.test(nombre) ? [ruta] : [];
  });
}

const infractores = archivos(raiz)
  .filter((ruta) => relative(raiz, ruta) !== permitido)
  .filter((ruta) => /from\s+["']next\/link["']|require\(\s*["']next\/link["']\s*\)/.test(readFileSync(ruta, "utf8")))
  .map((ruta) => relative(raiz, ruta));

if (infractores.length) {
  console.error("Importan next/link directamente (usar @/components/enlace, que no precarga):");
  for (const ruta of infractores) console.error(`  ${ruta}`);
  process.exit(1);
}
const enlace = readFileSync(join(raiz, permitido), "utf8");
if (!/prefetch\s*=\s*false/.test(enlace)) {
  console.error("components/enlace.tsx dejó de poner prefetch = false por defecto.");
  process.exit(1);
}
console.log("Sin precarga: ningún archivo importa next/link directamente y el enlace propio no precarga.");
