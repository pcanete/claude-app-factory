/**
 * El menú agrupa las vistas por lo que muestran: una entrada por entidad, con sus vistas
 * como pestañas. Importa el módulo real con --experimental-strip-types.
 */
import { agruparVistas, grupoDeVista } from "../src/lib/view-groups.ts";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? `\n         ${detalle}` : ""}`);
  }
}

const etiquetas = { cliente: "Clientes", interaccion: "Interacciones", compromiso: "Compromisos", propuesta: "Propuestas" };
const vistas = [
  { key: "panorama", label: "Panorama", type: "dashboard" },
  { key: "clientes", label: "Clientes", type: "table", entity: "cliente" },
  { key: "bandeja", label: "Bandeja", type: "table", entity: "interaccion" },
  { key: "agenda", label: "Agenda", type: "calendar", entity: "compromiso" },
  { key: "compromisos", label: "Compromisos", type: "table", entity: "compromiso" },
  { key: "tablero", label: "Tablero", type: "kanban", entity: "compromiso" },
  { key: "pipeline", label: "Pipeline", type: "kanban", entity: "propuesta" },
  { key: "propuestas", label: "Propuestas", type: "table", entity: "propuesta" },
];
const grupos = agruparVistas(vistas, (clave) => etiquetas[clave]);

comprobar("ocho vistas quedan en cinco entradas", grupos.length === 5, grupos.map((g) => g.label).join(", "));
comprobar("en el orden de la primera vista de cada una",
  grupos.map((g) => g.label).join(",") === "Panorama,Clientes,Interacciones,Compromisos,Propuestas");
comprobar("la entrada lleva el nombre de la entidad, no el de la vista", grupos[2].label === "Interacciones");

const compromisos = grupos[3];
comprobar("los compromisos tienen tres pestañas, con la tabla primero y llamada «Lista»",
  compromisos.vistas.map((v) => v.label).join(",") === "Lista,Agenda,Tablero", compromisos.vistas.map((v) => v.label).join(","));
comprobar("la entrada lleva a la tabla", compromisos.href === "/views/compromisos");
comprobar("en propuestas la tabla pasa adelante del kanban",
  grupos[4].vistas.map((v) => v.key).join(",") === "propuestas,pipeline" && grupos[4].href === "/views/propuestas");
comprobar("una vista sin entidad es su propia entrada", grupos[0].key === "vista:panorama" && grupos[0].vistas.length === 1);

const soloKanban = agruparVistas([{ key: "k", label: "Tablero", type: "kanban", entity: "x" }], () => "Equis");
comprobar("sin tabla, la primera vista conserva su nombre", soloKanban[0].vistas[0].label === "Tablero" && soloKanban[0].label === "Equis");
const dosTablas = agruparVistas([
  { key: "a", label: "Abiertos", type: "table", entity: "x" },
  { key: "b", label: "Cerrados", type: "table", entity: "x" },
], () => "Equis");
comprobar("con dos tablas, sólo la primera se llama «Lista»", dosTablas[0].vistas.map((v) => v.label).join(",") === "Lista,Cerrados");
comprobar("sin etiqueta de entidad usa la de la vista", agruparVistas([{ key: "a", label: "Algo", type: "table", entity: "z" }], () => undefined)[0].label === "Algo");

comprobar("una vista encuentra su grupo", grupoDeVista(grupos, "tablero")?.key === "entidad:compromiso");
comprobar("una vista que no está, no", grupoDeVista(grupos, "nada") === null);

if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nGrupos de vistas: todas las comprobaciones pasaron.");
