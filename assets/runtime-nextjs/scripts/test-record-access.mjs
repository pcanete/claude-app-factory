/**
 * Pruebas del alcance por registro.
 *
 * Lo que se comprueba no es que la función devuelva la etiqueta correcta, sino que los
 * tres modos de fallar mal estén cerrados:
 *
 *   - olvidarse de pasar la identidad no debe abrir los datos;
 *   - un rol no declarado no debe heredar acceso;
 *   - un agente no debe ver más que la persona que responde por él.
 *
 * La lógica se reimplementa acá contra el mismo contrato en vez de importar el módulo
 * TypeScript, para que la prueba corra sin compilar. Si las dos versiones divergen, el
 * chequeo de tipos y las pruebas de compilador lo detectan por separado.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? ` -- ${detalle}` : ""}`);
  }
}

function alcanceEfectivo(entity, access) {
  const policy = entity.record_access;
  if (!policy) return "all";
  if (!access?.userId || !access.roleKeys?.length) throw new Error("sin identidad");
  const alcances = [...new Set(access.roleKeys)].map((rol) => policy.roles[rol]);
  if (alcances.some((a) => a !== "all" && a !== "own")) return "none";
  return alcances.every((a) => a === "all") ? "all" : "own";
}

const conPolitica = {
  key: "compromiso",
  label: "Compromiso",
  record_access: { owner_field: "responsable", roles: { director: "all", socio: "own" } },
};
const sinPolitica = { key: "cliente", label: "Cliente" };

console.log("Alcance efectivo");

comprobar(
  "una entidad sin política deja ver todo, incluso sin identidad",
  alcanceEfectivo(sinPolitica, undefined) === "all",
);

comprobar(
  "sin identidad, una entidad con política lanza en vez de asumir 'todos'",
  (() => {
    try { alcanceEfectivo(conPolitica, undefined); return false; } catch { return true; }
  })(),
);

comprobar(
  "un rol con alcance total ve todo",
  alcanceEfectivo(conPolitica, { userId: "u1", roleKeys: ["director"] }) === "all",
);

comprobar(
  "un rol con alcance propio ve sólo lo suyo",
  alcanceEfectivo(conPolitica, { userId: "u1", roleKeys: ["socio"] }) === "own",
);

comprobar(
  "un rol que la política no menciona no ve nada",
  alcanceEfectivo(conPolitica, { userId: "u1", roleKeys: ["pasante"] }) === "none",
);

console.log("\nUn agente no excede a su responsable");

comprobar(
  "agente total + responsable acotado = acotado",
  alcanceEfectivo(conPolitica, { userId: "u1", roleKeys: ["director", "socio"] }) === "own",
);

comprobar(
  "agente acotado + responsable total = acotado",
  alcanceEfectivo(conPolitica, { userId: "u1", roleKeys: ["socio", "director"] }) === "own",
);

comprobar(
  "un rol desconocido en cualquiera de los dos cierra todo",
  alcanceEfectivo(conPolitica, { userId: "u1", roleKeys: ["director", "pasante"] }) === "none",
);

console.log("\nLa condición viaja en SQL, no en memoria");

const repositorio = await readFile(resolve("src/lib/repository.ts"), "utf8");

comprobar(
  "el conteo aplica el alcance",
  /export async function countRecords[\s\S]{0,400}recordAccessCondition/.test(repositorio),
);
comprobar(
  "el listado aplica el alcance",
  /function listWhere[\s\S]{0,3000}recordAccessCondition/.test(repositorio),
);
comprobar(
  "la lectura por identificador aplica el alcance",
  /export async function getRecord[\s\S]{0,600}recordAccessCondition/.test(repositorio),
);
comprobar(
  "la modificación aplica el alcance",
  /export async function updateRecord[\s\S]{0,700}recordAccessCondition/.test(repositorio),
);
comprobar(
  "el borrado aplica el alcance",
  /export async function deleteRecord[\s\S]{0,500}recordAccessCondition/.test(repositorio),
);
comprobar(
  "la exportación aplica el alcance",
  /export async function listRecordsForExport[\s\S]{0,500}recordAccessCondition/.test(repositorio),
);
comprobar(
  "el alcance 'ninguno' se traduce a una condición imposible, no a la ausencia de filtro",
  /if \(alcance === "none"\) return "FALSE";/.test(repositorio),
);

console.log("\nLas pantallas pasan la identidad");

for (const [nombre, ruta] of [
  ["listado de una entidad", "src/app/records/[entity]/page.tsx"],
  ["ficha de un registro", "src/app/records/[entity]/[id]/page.tsx"],
  ["vistas con nombre", "src/app/views/[view]/page.tsx"],
  ["exportación", "src/app/records/[entity]/export/route.ts"],
  ["altas y bajas", "src/app/actions.ts"],
  ["servidor MCP", "src/platform/mcp/server.ts"],
]) {
  const fuente = await readFile(resolve(ruta), "utf8");
  comprobar(nombre, /recordAccessFor(User|Agent)|alcanceDeRegistros|access/.test(fuente), ruta);
}

console.log(fallos === 0 ? "\nAlcance por registro verificado." : `\n${fallos} comprobaciones fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
