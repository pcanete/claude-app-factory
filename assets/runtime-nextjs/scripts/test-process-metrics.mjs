/**
 * Pruebas del tablero del trabajo: lo que se mide sale de la bitácora tal como la deja el motor.
 *
 * Importa el módulo real (`platform/processes/metrics.ts`, sin dependencias) con
 * --experimental-strip-types.
 *
 * Lo que tiene que valer:
 *   - cola, trabajo, espera y revisión se separan bien, incluida la vuelta tras una devolución;
 *   - una devolución se le atribuye a quien cerró y al modelo que declaró, no a quien revisó;
 *   - un cierre sin revisión no cuenta como aprobado ni como pendiente;
 *   - la etapa que más frena por caso es la traba, con su motivo;
 *   - un caso quieto hace días aparece como detenido.
 */
import { medirProceso, modeloDe } from "../src/platform/processes/metrics.ts";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.log(`  FALLA  ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const T0 = Date.parse("2026-01-01T00:00:00Z");
const h = (horas) => new Date(T0 + horas * 3_600_000).toISOString();
const ev = (instancia, horas, tipo, etapa, autor = null, extra = {}) => ({ instancia, fecha: h(horas), tipo, etapa, autor, ...extra });

const eventos = [
  // Caso A: tres etapas, la 2 con revisión, una espera, una devolución y entrega.
  ev("A", 0, "creada", 1),
  ev("A", 2, "tomada", 1, "p1"),
  ev("A", 5, "esperando", 1, "p1", { resumen: "Falta el logo en alta" }),
  ev("A", 9, "tomada", 1, "p1"),
  ev("A", 10, "cerrada", 1, "p1", { receta: { modelo: "Claude Opus" } }),
  ev("A", 12, "tomada", 2, "p2"),
  ev("A", 15, "cerrada", 2, "p2", { receta: { modelo: "gpt" } }),
  ev("A", 16, "devuelta", 2, "p1", { resumen: "Devuelta: el tono", salidas: { motivo: "El tono no es el de la marca" } }),
  ev("A", 18, "tomada", 2, "p2"),
  ev("A", 19, "cerrada", 2, "p2", { receta: { modelo: "  GPT " } }),
  ev("A", 21, "revisada", 2, "p1"),
  ev("A", 22, "tomada", 3, "p1"),
  ev("A", 23, "cerrada", 3, "p1", { receta: {} }),
  ev("A", 23, "entregada", 3, "p1"),
  // Caso B: se libera y lo toma otra persona; sigue abierto.
  ev("B", 0, "creada", 1),
  ev("B", 1, "tomada", 1, "p1"),
  ev("B", 3, "liberada", 1, "p1", { resumen: "No tengo acceso a la carpeta" }),
  ev("B", 4, "tomada", 1, "p2"),
];
// El orden de llegada no importa: el tablero ordena por fecha dentro de cada caso.
eventos.reverse();

const tablero = medirProceso({
  etapas: [{ orden: 1, nombre: "Reunir" }, { orden: 2, nombre: "Liquidar" }, { orden: 3, nombre: "Presentar" }],
  casos: [
    { id: "A", titulo: "Caso A", etapa: 3, estado: "entregada", actualizado: h(23) },
    { id: "B", titulo: "Caso B", etapa: 1, estado: "tomada", actualizado: h(4) },
    { id: "C", titulo: "Caso C", etapa: 2, estado: "esperando", actualizado: h(0) },
  ],
  eventos,
  ahora: h(24 * 5 + 1),
});
const [e1, e2, e3] = tablero.etapas;

console.log("Tiempos");
comprobar("cola de la etapa 1: 2 h en cada caso", e1.cola.casos === 2 && e1.cola.mediana_horas === 2, JSON.stringify(e1.cola));
comprobar("trabajo de la etapa 1 sin contar la espera", e1.trabajo.casos === 2 && e1.trabajo.mediana_horas === 3, JSON.stringify(e1.trabajo));
comprobar("espera de la etapa 1: 4 h", e1.espera.casos === 1 && e1.espera.mediana_horas === 4, JSON.stringify(e1.espera));
comprobar("la cola de la etapa 2 empieza al cerrar la 1", e2.cola.mediana_horas === 2, JSON.stringify(e2.cola));
comprobar("trabajo de la etapa 2 suma los dos tramos", e2.trabajo.mediana_horas === 4, JSON.stringify(e2.trabajo));
comprobar("lo que tarda en retomarse una devolución es espera", e2.espera.mediana_horas === 2, JSON.stringify(e2.espera));
comprobar("revisión de la etapa 2: 1 h + 2 h", e2.revision.mediana_horas === 3, JSON.stringify(e2.revision));
comprobar("ciclo completo del caso entregado: 23 h", tablero.ciclo.casos === 1 && tablero.ciclo.mediana_horas === 23, JSON.stringify(tablero.ciclo));

console.log("Devoluciones y modelos");
comprobar("tasa de devolución de la etapa 2: una de dos", e2.revisiones === 2 && e2.devueltas === 1 && e2.tasa_devolucion === 0.5);
comprobar("el modelo se agrupa sin mayúsculas ni espacios", igual(e2.modelos, [{ modelo: "gpt", cierres: 2, aprobadas: 1, devueltas: 1, sin_revision: 0, pendientes: 0 }]), JSON.stringify(e2.modelos));
comprobar("un cierre sin revisión no es aprobado ni pendiente", igual(e1.modelos, [{ modelo: "claude opus", cierres: 1, aprobadas: 0, devueltas: 0, sin_revision: 1, pendientes: 0 }]), JSON.stringify(e1.modelos));
comprobar("la última etapa entregada sin revisión tampoco", e3.modelos[0]?.sin_revision === 1 && e3.modelos[0]?.pendientes === 0, JSON.stringify(e3.modelos));
comprobar("una receta sin modelo dice «sin declarar»", modeloDe({}) === "sin declarar" && e3.modelos[0]?.modelo === "sin declarar");

console.log("Personas");
const p1 = tablero.personas.find((p) => p.persona === "p1");
const p2 = tablero.personas.find((p) => p.persona === "p2");
comprobar("la devolución es de quien cerró, no de quien revisó", p2?.devueltas === 1 && p1?.devueltas === 0, JSON.stringify(tablero.personas));
comprobar("cierres por persona", p1?.cierres === 2 && p2?.cierres === 2 && p2?.tasa_devolucion === 0.5);

console.log("Trabas");
comprobar("la etapa 1 es la traba, por esperas", igual(tablero.traba, { orden: 1, nombre: "Reunir", motivo: "esperas" }), JSON.stringify(tablero.traba));
comprobar("los motivos llevan el texto, más reciente primero", e1.motivos.length === 2 && e1.motivos[0].texto === "Falta el logo en alta" && e1.motivos[1].texto === "No tengo acceso a la carpeta", JSON.stringify(e1.motivos));
comprobar("el motivo de una devolución sale de lo que escribió quien revisó", e2.motivos[0]?.texto === "El tono no es el de la marca", JSON.stringify(e2.motivos));
comprobar("lo que hay ahora en cada etapa", igual(e1.ahora, { tomada: 1 }) && igual(e2.ahora, { esperando: 1 }));
comprobar("un caso quieto hace 5 días está detenido", tablero.detenidos.length === 1 && tablero.detenidos[0].caso === "C" && tablero.detenidos[0].dias === 5, JSON.stringify(tablero.detenidos));
comprobar("totales", tablero.casos === 3 && tablero.entregados === 1);

console.log("Sin datos");
const vacio = medirProceso({ etapas: [{ orden: 1, nombre: "Única" }], casos: [], eventos: [], ahora: h(0) });
comprobar("sin eventos no inventa números", vacio.etapas[0].cola.mediana_horas === null && vacio.etapas[0].tasa_devolucion === null && vacio.traba === null);

if (fallos) {
  console.log(`\nTablero del trabajo: ${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nTablero del trabajo: todas las comprobaciones pasaron.");
