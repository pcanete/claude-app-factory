/**
 * Un sí/no opcional que se guarda desde el panel no se inventa un «no».
 *
 * Importa el módulo real (`lib/form-boolean.ts`, sin dependencias) con
 * --experimental-strip-types. Hasta 2.5.5 un sí/no opcional era una casilla: guardar el
 * formulario de un registro sin tocar ese campo convertía «sin valor» (null) en `false`.
 */
import { booleanoDeFormulario, valorDeSelectorBooleano } from "../src/lib/form-boolean.ts";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? `\n         ${detalle}` : ""}`);
  }
}

comprobar("opcional sin valor queda sin valor", booleanoDeFormulario("", false) === null);
comprobar("opcional que no llegó en el formulario queda sin valor", booleanoDeFormulario(null, false) === null);
comprobar("opcional «true» es sí", booleanoDeFormulario("true", false) === true);
comprobar("opcional «false» es no", booleanoDeFormulario("false", false) === false);
comprobar("obligatorio con la casilla marcada es sí", booleanoDeFormulario("on", true) === true);
comprobar("obligatorio con la casilla sin marcar es no", booleanoDeFormulario(null, true) === false);
comprobar("el selector muestra sin valor para null", valorDeSelectorBooleano(null) === "" && valorDeSelectorBooleano(undefined) === "");
comprobar("y sí o no para los booleanos", valorDeSelectorBooleano(true) === "true" && valorDeSelectorBooleano(false) === "false");
comprobar("ida y vuelta: null pasa por el selector y vuelve null",
  booleanoDeFormulario(valorDeSelectorBooleano(null), false) === null);

if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nSí/no del formulario: todas las comprobaciones pasaron.");
