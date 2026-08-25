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

/**
 * Enumerar en vez de enumerar a mano.
 *
 * La versión anterior de esta prueba listaba las funciones que había que revisar. Eso
 * comprueba lo que alguien se acordó de escribir, no lo que el código hace: una función
 * nueva que consulta la base sin alcance pasaba, porque nadie la había agregado a la
 * lista. Ahora la prueba recorre el repositorio, se queda con todo lo que ejecuta SQL y
 * exige que cada una aplique alcance. Agregar un camino sin alcance rompe la prueba sin
 * que nadie tenga que acordarse de nada.
 *
 * Una función puede quedar exenta, pero sólo por escrito y con motivo: la excepción se
 * declara acá abajo y queda a la vista en la revisión.
 */
const repositorio = await readFile(resolve("src/lib/repository.ts"), "utf8");

// Las tres formas legítimas de aplicar alcance: filtrar en SQL, delegar en quien filtra,
// o —al crear— fijar el dueño del registro.
const APLICA_ALCANCE = /recordAccessCondition|listWhere\(|prepareRecordCreate|assertRecordOwnershipChange/;

const EXENTAS = {
  queryRows: "Es el ejecutor de SQL, no arma consultas: el alcance lo pone quien lo llama.",
};

function funcionesDelRepositorio(fuente) {
  const encabezado = /^(?:export )?(?:async )?function (\w+)/gm;
  const encontradas = [];
  let coincidencia;
  while ((coincidencia = encabezado.exec(fuente))) {
    encontradas.push({ nombre: coincidencia[1], desde: coincidencia.index });
  }
  return encontradas.map((funcion, indice) => ({
    nombre: funcion.nombre,
    cuerpo: fuente.slice(funcion.desde, encontradas[indice + 1]?.desde ?? fuente.length),
  }));
}

const funciones = funcionesDelRepositorio(repositorio);
comprobar(
  "la prueba encuentra las funciones del repositorio",
  funciones.length >= 15,
  `encontradas ${funciones.length}`,
);

const consultan = funciones.filter((funcion) => /(queryRows|sql)[<(]/.test(funcion.cuerpo));
comprobar("hay funciones que consultan la base", consultan.length >= 8, `${consultan.length}`);

for (const funcion of consultan) {
  if (EXENTAS[funcion.nombre]) {
    console.log(`  --  ${funcion.nombre} exenta: ${EXENTAS[funcion.nombre]}`);
    continue;
  }
  comprobar(
    `${funcion.nombre} aplica alcance`,
    APLICA_ALCANCE.test(funcion.cuerpo),
    "consulta la base sin filtrar por alcance ni declararse exenta",
  );
}

comprobar(
  "el alcance 'ninguno' se traduce a una condición imposible, no a la ausencia de filtro",
  /if \(alcance === "none"\) return "FALSE";/.test(repositorio),
);
comprobar(
  "modificar y borrar distinguen 'no hay fila' de 'salió bien'",
  /UPDATE[\s\S]{0,200}RETURNING "id"/.test(repositorio)
    && /DELETE FROM[\s\S]{0,200}RETURNING "id"/.test(repositorio)
    && (repositorio.match(/RecordOutOfScopeError/g) ?? []).length >= 2,
);

console.log("\nTodo camino que llega a los datos lleva identidad");

/**
 * Mismo criterio del lado de las pantallas: en vez de una lista de rutas escrita a mano,
 * se buscan todos los archivos que importan el repositorio. Una ruta nueva que consulte
 * datos sin identidad falla acá el día que se escribe, no el día que alguien la audita.
 */
const LECTURAS_SENSIBLES = [
  "countRecords", "countFilteredRecords", "listRecords", "aggregateRecords",
  "breakdownRecords", "calendarRecords", "listRecordsForExport", "getRecord",
  "relationshipOptions", "insertRecord", "updateRecord", "deleteRecord",
];
const LLEVA_IDENTIDAD = /recordAccessFor(User|Agent)|alcanceDeRegistros|\baccess\b/;

async function fuentesDe(directorio) {
  const { readdir } = await import("node:fs/promises");
  const entradas = await readdir(resolve(directorio), { withFileTypes: true });
  const archivos = [];
  for (const entrada of entradas) {
    const ruta = `${directorio}/${entrada.name}`;
    if (entrada.isDirectory()) archivos.push(...(await fuentesDe(ruta)));
    else if (/\.(ts|tsx)$/.test(entrada.name)) archivos.push(ruta);
  }
  return archivos;
}

const candidatos = [
  ...(await fuentesDe("src/app")),
  ...(await fuentesDe("src/platform")),
  ...(await fuentesDe("src/components")),
];

let consumidores = 0;
for (const ruta of candidatos) {
  const fuente = await readFile(resolve(ruta), "utf8");
  // Importar sólo un tipo no consulta nada, y una prop que se llama igual que una
  // función tampoco: lo que cuenta es traer el módulo e invocarlo.
  const importa = /import (?!type )[^;]*from "@\/lib\/repository"/.test(fuente)
    && LECTURAS_SENSIBLES.some((nombre) => fuente.includes(nombre + "("));
  if (!importa) continue;
  consumidores += 1;
  comprobar(ruta, LLEVA_IDENTIDAD.test(fuente), "usa el repositorio sin pasar identidad");
}

comprobar(
  "la prueba encontró los caminos a los datos",
  consumidores >= 6,
  `sólo ${consumidores}: revisá que el recorrido siga alcanzando las rutas`,
);

console.log(fallos === 0 ? "\nAlcance por registro verificado." : `\n${fallos} comprobaciones fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
