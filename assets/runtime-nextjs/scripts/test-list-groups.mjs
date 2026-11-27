/**
 * Pruebas de la lista agrupada.
 *
 * Importa el módulo real (`src/lib/list-groups.ts`, sin dependencias) con
 * --experimental-strip-types: una prueba que pasa habla del código que corre.
 *
 * Lo que tiene que valer:
 *   - los grupos salen en el orden de las opciones del AppSpec, no en el de los registros;
 *   - un grupo vacío no se muestra;
 *   - un registro sin valor, o con un valor que ya no es opción, no se pierde: va al final;
 *   - dentro de cada grupo se respeta el orden en que llegaron (el de la consulta);
 *   - «míos» usa el dueño de la política de acceso, si no el primer campo de persona de la
 *     vista, si no el primero de la entidad; sin campos de persona no hay «míos».
 */
import { SIN_VALOR, agruparPorOpcion, campoDeMios } from "../src/lib/list-groups.ts";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? ` -- ${detalle}` : ""}`);
  }
}

const estado = {
  key: "estado",
  label: "Estado",
  options: [
    { key: "entrada", label: "Entrada" },
    { key: "pendiente", label: "Pendiente" },
    { key: "en_curso", label: "En curso" },
    { key: "entregado", label: "Entregado" },
  ],
};
const registros = [
  { id: "1", estado: "entregado" },
  { id: "2", estado: "pendiente" },
  { id: "3", estado: null },
  { id: "4", estado: "pendiente" },
  { id: "5", estado: "retirado" },
  { id: "6", estado: "entrada" },
];
const grupos = agruparPorOpcion(registros, estado);
comprobar("los grupos siguen el orden de las opciones", grupos.map((g) => g.key).join(",") === `entrada,pendiente,entregado,${SIN_VALOR}`, grupos.map((g) => g.key).join(","));
comprobar("un grupo vacío no aparece", !grupos.some((g) => g.key === "en_curso"));
comprobar("dentro del grupo se respeta el orden de llegada", grupos[1].records.map((r) => r.id).join(",") === "2,4");
const sinValor = grupos.at(-1);
comprobar("lo que no tiene valor o tiene uno que ya no existe va al final", sinValor.key === SIN_VALOR && sinValor.records.map((r) => r.id).join(",") === "3,5");
comprobar("y su grupo se nombra con el campo", sinValor.label === "Sin estado", sinValor.label);
comprobar("no se pierde ningún registro", grupos.reduce((n, g) => n + g.records.length, 0) === registros.length);
comprobar("sin registros no hay grupos", agruparPorOpcion([], estado).length === 0);
comprobar("un campo sin opciones manda todo a «sin valor»", agruparPorOpcion([{ estado: "x" }], { key: "estado", label: "Estado" })[0].key === SIN_VALOR);

const campos = [
  { key: "titulo", type: "text" },
  { key: "autor", type: "person" },
  { key: "responde", type: "person" },
];
comprobar("«míos» usa el dueño de la política de acceso", campoDeMios({ fields: campos, record_access: { owner_field: "autor" } }, ["responde"]) === "autor");
comprobar("si no hay política, el primer campo de persona de la vista", campoDeMios({ fields: campos }, ["titulo", "responde"]) === "responde");
comprobar("si la vista no muestra ninguno, el primero de la entidad", campoDeMios({ fields: campos }, ["titulo"]) === "autor");
comprobar("un dueño que no es de persona no cuenta", campoDeMios({ fields: campos, record_access: { owner_field: "titulo" } }, ["responde"]) === "responde");
comprobar("sin campos de persona no hay «míos»", campoDeMios({ fields: [{ key: "titulo", type: "text" }] }) === null);

if (fallos) {
  console.error(`\n${fallos} prueba(s) fallaron.`);
  process.exit(1);
}
console.log("\nLista agrupada: todas las pruebas pasaron.");
