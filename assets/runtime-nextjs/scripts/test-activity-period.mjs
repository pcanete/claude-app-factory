/**
 * Pruebas del período del grafo de actividad.
 *
 * Importa el módulo real (`lib/activity-period.ts`) con --experimental-strip-types.
 *
 * Lo que tiene que valer:
 *   - un período que no existe en la dirección cae en «últimos eventos», no rompe la página;
 *   - cada período cuenta desde el momento correcto, y «últimos eventos» no pone fecha;
 *   - agrupar los últimos eventos da lo mismo que agrupa la base: un grupo por actor y
 *     entidad, con la cantidad, los fallos y el más reciente. Si esto difiere, el grafo
 *     muestra otra cosa según el período elegido.
 */
import { agruparEventos, desdeDePeriodo, periodoValido } from "../src/lib/activity-period.ts";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? `\n         ${detalle}` : ""}`);
  }
}

comprobar("un período desconocido cae en los últimos eventos", periodoValido("90d") === "recientes");
comprobar("sin período, los últimos eventos", periodoValido(undefined) === "recientes");
comprobar("un período conocido se respeta", periodoValido("7d") === "7d");

const ahora = new Date("2026-11-17T12:00:00Z");
comprobar("los últimos eventos no tienen fecha de inicio", desdeDePeriodo("recientes", ahora) === undefined);
comprobar("24 horas cuenta desde ayer a la misma hora",
  desdeDePeriodo("24h", ahora)?.toISOString() === "2026-11-16T12:00:00.000Z", String(desdeDePeriodo("24h", ahora)));
comprobar("30 días cuenta desde hace 30 días",
  desdeDePeriodo("30d", ahora)?.toISOString() === "2026-10-18T12:00:00.000Z", String(desdeDePeriodo("30d", ahora)));

const base = {
  actor_id: null, actor_name: null, actor_email: null, agent_name: "Agente A", responsible_id: null,
  responsible_name: "Responsable", record_id: null, action: "query_records", details: null,
  result_count: 1, duration_ms: 10, error_message: null,
};
const eventos = [
  { ...base, event_key: "1", source: "agent", agent_id: "a", entity_key: "iteracion", status: "completed", created_at: new Date("2026-11-17T11:00:00Z") },
  { ...base, event_key: "2", source: "agent", agent_id: "a", entity_key: "iteracion", status: "failed", created_at: new Date("2026-11-17T11:30:00Z") },
  { ...base, event_key: "3", source: "agent", agent_id: "a", entity_key: "proceso", status: "completed", created_at: new Date("2026-11-17T10:00:00Z") },
  { ...base, event_key: "4", source: "human", agent_id: null, agent_name: null, actor_id: "p", actor_name: "Persona", entity_key: "iteracion", status: "completed", created_at: new Date("2026-11-17T09:00:00Z") },
];
const grupos = agruparEventos(eventos);
const iteracion = grupos.find((g) => g.agent_id === "a" && g.entity_key === "iteracion");
comprobar("un grupo por actor y entidad", grupos.length === 3, JSON.stringify(grupos));
comprobar("el grupo suma la cantidad y los fallos", iteracion?.cantidad === 2 && iteracion?.fallos === 1, JSON.stringify(iteracion));
comprobar("y se queda con el más reciente aunque no venga primero",
  new Date(iteracion?.ultimo).toISOString() === "2026-11-17T11:30:00.000Z", JSON.stringify(iteracion));
comprobar("una persona y un agente sobre la misma entidad son grupos distintos",
  grupos.filter((g) => g.entity_key === "iteracion").length === 2, JSON.stringify(grupos));
comprobar("sin eventos no hay grupos", agruparEventos([]).length === 0);

if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nPeríodo de actividad: todas las comprobaciones pasaron.");
