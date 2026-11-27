/**
 * Pruebas del color principal que declara el AppSpec.
 *
 * Importa el módulo real (`src/lib/theme.ts`, sin dependencias) con
 * --experimental-strip-types: una prueba que pasa habla del código que corre.
 *
 * Lo que tiene que valer:
 *   - sólo se aceptan colores #abc o #aabbcc: nada más llega a la hoja de estilos;
 *   - el color de texto se lee sobre las tarjetas (4,5:1) y es el más cercano al de marca;
 *   - un color que ya se lee como texto no se toca;
 *   - el texto sobre un botón es el que mejor se lee, blanco u oscuro;
 *   - sin color o con uno inválido, queda el de la plataforma.
 */
import {
  FONDO_DE_LECTURA,
  colorDeTexto,
  contraste,
  normalizarColor,
  textoSobre,
  variablesDeTema,
} from "../src/lib/theme.ts";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? ` -- ${detalle}` : ""}`);
  }
}

comprobar("un color de seis dígitos se acepta, en minúsculas", normalizarColor("#5B5BD6") === "#5b5bd6");
comprobar("uno de tres se expande", normalizarColor("#abc") === "#aabbcc");
for (const malo of ["red", "#12345", "#gggggg", "#5b5bd6; } body { display:none", "", null, 42]) {
  comprobar(`se rechaza ${JSON.stringify(malo)}`, normalizarColor(malo) === null);
}
comprobar("el contraste de blanco sobre negro es 21", Math.round(contraste("#ffffff", "#000000")) === 21);

const indigo = "#5b5bd6";
comprobar("el índigo tal cual no se lee como texto sobre las tarjetas", contraste(indigo, FONDO_DE_LECTURA) < 4.5, contraste(indigo, FONDO_DE_LECTURA).toFixed(2));
const textoIndigo = colorDeTexto(indigo);
comprobar("su versión de texto sí se lee", contraste(textoIndigo, FONDO_DE_LECTURA) >= 4.5, `${textoIndigo} ${contraste(textoIndigo, FONDO_DE_LECTURA).toFixed(2)}`);
comprobar("y no se aclaró más de lo necesario", contraste(textoIndigo, FONDO_DE_LECTURA) < 5.5, contraste(textoIndigo, FONDO_DE_LECTURA).toFixed(2));
comprobar("un color que ya se lee no se toca", colorDeTexto("#7dd3fc") === "#7dd3fc");
comprobar("sobre un índigo el texto del botón es blanco", textoSobre(indigo) === "#ffffff");
comprobar("sobre un amarillo es oscuro", textoSobre("#facc15") === "#0b0d12");

const porDefecto = variablesDeTema();
comprobar("sin color queda el de la plataforma", porDefecto["--primary"] === "#0ea5e9");
comprobar("con uno inválido, también", variablesDeTema({ primary: "url(x)" })["--primary"] === "#0ea5e9");
const operacion = variablesDeTema({ primary: "#5B5BD6" });
comprobar("con uno válido, se usa tal cual para fondos", operacion["--primary"] === "#5b5bd6");
comprobar("y su versión de texto para enlaces", operacion["--primary-text"] === textoIndigo);

if (fallos) {
  console.error(`\n${fallos} prueba(s) fallaron.`);
  process.exit(1);
}
console.log("\nColor principal: todas las pruebas pasaron.");
