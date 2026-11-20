/**
 * Quien puede crear registros encuentra cómo, desde la página a la que lleva el menú.
 *
 * Desde 2.1.0 el menú lleva a la vista de cada entidad (lista, agenda, tablero) y no al
 * listado base, que es donde estaba «Nuevo». La vista escondió su enlace al listado base
 * cuando tenía pestaña de lista, y el alta quedó sin ningún botón que llevara a ella: el
 * permiso seguía, el camino no. Esta prueba lee las dos páginas y exige que cada una
 * pregunte el permiso de crear y ofrezca el alta y la importación.
 *
 * Lee código, no lo ejecuta: atrapa que alguien saque el botón, que es lo que pasó.
 */
import { readFileSync } from "node:fs";

let fallos = 0;
function comprobar(nombre, condicion) {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}`);
  }
}

for (const [nombre, ruta] of [
  ["la vista de una entidad (a donde lleva el menú)", "src/app/views/[view]/page.tsx"],
  ["el listado base", "src/app/records/[entity]/page.tsx"],
]) {
  const codigo = readFileSync(ruta, "utf8");
  comprobar(`${nombre} pregunta el permiso de crear`, /hasPermission\(user, entity\.key, "create"\)/.test(codigo));
  comprobar(`${nombre} ofrece «Nuevo …» a quien puede crear`, /canCreate && <Link[^>]*href=\{`\/records\/\$\{entity\.key\}\/new`\}/.test(codigo));
  comprobar(`${nombre} ofrece importar a quien puede crear`, /canCreate && <Link[^>]*href=\{`\/records\/\$\{entity\.key\}\/import`\}/.test(codigo));
}

if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nAlta en las vistas: todas las comprobaciones pasaron.");
