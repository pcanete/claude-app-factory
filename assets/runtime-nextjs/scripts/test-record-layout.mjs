/**
 * Pruebas del reparto de la ficha en dos columnas.
 *
 * Importa el módulo real (`src/lib/record-layout.ts`, sin dependencias) con
 * --experimental-strip-types: una prueba que pasa habla del código que corre.
 *
 * Lo que tiene que valer:
 *   - los textos largos van a la columna principal y el resto a las propiedades, sin
 *     repetir el título;
 *   - se cambian en el lugar sólo los campos de opciones y de sí o no;
 *   - lo relacionado son las entidades que apuntan a esta, y una que se apunta a sí misma
 *     no cuenta;
 *   - la línea de tiempo elige el primer campo de cada clase y no inventa los que no hay.
 */
import { camposDeLinea, entidadesHijas, repartirCampos, seEditaEnElLugar } from "../src/lib/record-layout.ts";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? ` -- ${detalle}` : ""}`);
  }
}

const tarea = {
  key: "tarea",
  label: "Tarea",
  title_field: "titulo",
  fields: [
    { key: "titulo", label: "Título", type: "text" },
    { key: "estado", label: "Estado", type: "enum" },
    { key: "notas", label: "Notas", type: "long_text" },
    { key: "vence", label: "Vence", type: "date" },
    { key: "hecha", label: "Hecha", type: "boolean" },
    { key: "datos", label: "Datos", type: "json" },
  ],
  relationships: [{ key: "cliente", label: "Cliente", type: "belongs_to", target: "cliente" }],
};
const nota = {
  key: "nota",
  label: "Nota",
  title_field: "resumen",
  fields: [
    { key: "resumen", label: "Resumen", type: "text" },
    { key: "tipo", label: "Tipo", type: "enum" },
    { key: "autor", label: "Autor", type: "person" },
    { key: "detalle", label: "Detalle", type: "long_text" },
  ],
  relationships: [
    { key: "tarea", label: "Tarea", type: "belongs_to", target: "tarea" },
    { key: "anterior", label: "Anterior", type: "belongs_to", target: "nota" },
  ],
};
const cliente = { key: "cliente", label: "Cliente", title_field: "nombre", fields: [{ key: "nombre", label: "Nombre", type: "text" }] };

const { principales, propiedades } = repartirCampos(tarea);
comprobar("los textos largos van a la columna principal", principales.map((c) => c.key).join(",") === "notas,datos", principales.map((c) => c.key).join(","));
comprobar("el resto va a las propiedades, sin el título", propiedades.map((c) => c.key).join(",") === "estado,vence,hecha", propiedades.map((c) => c.key).join(","));
comprobar("se editan en el lugar las opciones", seEditaEnElLugar({ type: "enum" }));
comprobar("y los sí o no", seEditaEnElLugar({ type: "boolean" }));
comprobar("pero no una fecha ni un texto", !seEditaEnElLugar({ type: "date" }) && !seEditaEnElLugar({ type: "text" }));

const deTarea = entidadesHijas([tarea, nota, cliente], "tarea");
comprobar("lo relacionado de una tarea son sus notas", deTarea.length === 1 && deTarea[0].entidad.key === "nota" && deTarea[0].relacion.key === "tarea");
const deCliente = entidadesHijas([tarea, nota, cliente], "cliente");
comprobar("lo relacionado de un cliente son sus tareas", deCliente.length === 1 && deCliente[0].entidad.key === "tarea");
comprobar("una entidad que se apunta a sí misma no cuenta", entidadesHijas([tarea, nota, cliente], "nota").length === 0);
comprobar("sin nada que apunte, no hay nada relacionado", entidadesHijas([cliente], "cliente").length === 0);

const linea = camposDeLinea(nota);
comprobar("la línea muestra título, tipo, persona y detalle", linea.titulo === "resumen" && linea.etiqueta === "tipo" && linea.persona === "autor" && linea.detalle === "detalle");
comprobar("y no inventa una fecha que no tiene", linea.fecha === null);
comprobar("una entidad sin opciones no tiene etiqueta", camposDeLinea(cliente).etiqueta === null);

if (fallos) {
  console.error(`\n${fallos} prueba(s) fallaron.`);
  process.exit(1);
}
console.log("\nFicha en dos columnas: todas las pruebas pasaron.");
