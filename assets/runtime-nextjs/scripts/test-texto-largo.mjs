/**
 * Un texto largo en markdown se muestra legible en la ficha, y nada de lo escrito se
 * convierte en algo ejecutable ni se altera.
 *
 * Importa el módulo real (`lib/texto-largo.ts`, sin dependencias) con
 * --experimental-strip-types. Hasta 2.6.1 la ficha mostraba las notas como un solo
 * renglón: los títulos, las listas y los saltos de línea se perdían en la vista.
 */
import { enlaceSeguro, leerLinea, leerTextoLargo } from "../src/lib/texto-largo.ts";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? `\n         ${detalle}` : ""}`);
  }
}

/** El texto visible de una línea, como lo leería una persona. */
const visible = (partes) => partes.map((p) => (p.tipo === "texto" ? p.texto : visible(p.partes))).join("");
const tipos = (bloques) => bloques.map((b) => b.tipo).join(",");

const nota = [
  "## Estado inicial",
  "La web no responde. **Primer paso:** revisar el servidor.",
  "",
  "### Pendientes",
  "* Dominio.",
  "* Servidor.",
  "",
  "1. Primero.",
  "2. Segundo.",
  "",
  "Mensajes",
  "[10:00, 1/1/2026] Alguien: hola",
  "Otra línea",
  "",
  "* * *",
  "> Ver [https://ejemplo.com](https://ejemplo.com/)",
  "",
  "—",
  "Origen: https://ejemplo.com/t/abc123",
].join("\n");
const bloques = leerTextoLargo(nota);

comprobar("reconoce títulos, párrafos, listas, separador y cita en orden",
  tipos(bloques) === "titulo,parrafo,titulo,lista,lista,parrafo,separador,cita,parrafo", tipos(bloques));
comprobar("## es título de nivel 2 y ### de nivel 3", bloques[0].nivel === 2 && bloques[2].nivel === 3);
comprobar("la lista con asteriscos no es ordenada y tiene sus dos ítems",
  bloques[3].ordenada === false && bloques[3].items.length === 2 && visible(bloques[3].items[0]) === "Dominio.");
comprobar("la lista numerada es ordenada", bloques[4].ordenada === true && bloques[4].items.length === 2);
comprobar("cada renglón de un párrafo se conserva como línea propia",
  bloques[5].lineas.length === 3 && visible(bloques[5].lineas[1]) === "[10:00, 1/1/2026] Alguien: hola");
comprobar("la negrita entre bordes de palabra se reconoce",
  bloques[1].lineas[0].some((p) => p.tipo === "negrita" && visible(p.partes) === "Primer paso:"));
comprobar("una dirección suelta se vuelve enlace",
  bloques[8].lineas[1].some((p) => p.tipo === "enlace" && p.href === "https://ejemplo.com/t/abc123"));

// Textos con asteriscos pegados a letras o números (como una clave) se ven tal cual.
for (const crudo of ["Ab**Cd**Ef00", "Xy00***Z", "Qw00**111", "Zz99**", "Ab*/Cd12", "valor: ****"]) {
  const linea = leerLinea(crudo);
  comprobar(`«${crudo}» queda intacto`, visible(linea) === crudo && linea.every((p) => p.tipo === "texto"), JSON.stringify(linea));
}

// Sólo se enlaza lo que se puede abrir sin riesgo.
for (const peligroso of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "//otro.example"]) {
  comprobar(`no se enlaza «${peligroso}»`, enlaceSeguro(peligroso) === null);
  const linea = leerLinea(`[clic](${peligroso})`);
  comprobar(`[clic](${peligroso}) queda como texto`, linea.every((p) => p.tipo === "texto"), JSON.stringify(linea));
}
comprobar("se enlazan web y correo", enlaceSeguro("https://a.com/x?y=1") !== null && enlaceSeguro("mailto:a@b.com") !== null);

// Un enlace con negrita adentro, como lo exportan algunas herramientas.
const conNegrita = leerLinea("Usuario: [**alguien@ejemplo.com**](mailto:alguien@ejemplo.com)");
const enlace = conNegrita.find((p) => p.tipo === "enlace");
comprobar("un enlace con negrita adentro mantiene las dos cosas",
  enlace?.href === "mailto:alguien@ejemplo.com" && enlace.partes[0]?.tipo === "negrita");

// Una imagen no se carga: se ofrece como enlace.
const imagen = leerLinea("![](https://archivos.ejemplo.com/image.png)");
comprobar("una imagen se muestra como enlace, no como imagen",
  imagen.length === 1 && imagen[0].tipo === "enlace" && visible(imagen[0].partes) === "Imagen");

// Los escapes de markdown se ven como el carácter.
comprobar("los escapes se muestran sin la barra", visible(leerLinea(String.raw`a\*\*b y 1\_2`)) === "a**b y 1_2");

// La puntuación final no queda dentro del enlace ni se pierde.
const conPunto = leerLinea("Ver https://ejemplo.com/a.");
comprobar("el punto final queda fuera del enlace",
  conPunto[1]?.href === "https://ejemplo.com/a" && visible(conPunto) === "Ver https://ejemplo.com/a.");

// HTML escrito en la nota es texto, no marcado.
const html = leerTextoLargo("<script>alert(1)</script>\n<b>hola</b>");
comprobar("el HTML queda como texto visible",
  html.length === 1 && visible(html[0].lineas[0]) === "<script>alert(1)</script>");

comprobar("los saltos de Windows se leen igual", tipos(leerTextoLargo("## T\r\nlinea\r\n")) === "titulo,parrafo");
comprobar("un texto vacío no produce bloques", leerTextoLargo("  \n\n ").length === 0);

if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nTexto largo: todas las comprobaciones pasaron.");
