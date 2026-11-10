// Cada herramienta MCP declara qué hace con los datos, y lo declara bien.
//
// Sin la marca, ChatGPT pide confirmación en cada llamada, también para leer. Con una marca
// equivocada es peor: una herramienta que escribe marcada como lectura se ejecuta sin
// preguntar. Esta prueba recorre el código, no una lista: una herramienta nueva sin marca
// rompe el CI el día que se escribe.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const fallas = [];
let previas = 0;
// Sólo dice «ok» si la sección no sumó fallas.
const ok = (mensaje) => {
  if (fallas.length === previas) console.log(`  ok  ${mensaje}`);
  previas = fallas.length;
};

function archivos(directorio) {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = join(directorio, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : ruta.endsWith(".ts") ? [ruta] : [];
  });
}

// 1. Cada registro lleva su propia marca, con su mismo nombre.
const registradas = new Map();
for (const archivo of archivos(join(raiz, "src"))) {
  const texto = readFileSync(archivo, "utf8");
  for (const registro of texto.matchAll(/registerTool\(\s*"([a-z_]+)",\s*\{([\s\S]{0,200})/g)) {
    const [, nombre, cuerpo] = registro;
    registradas.set(nombre, archivo);
    const marca = cuerpo.match(/annotations:\s*marcas\("([a-z_]+)"\)/);
    if (!marca) fallas.push(`${nombre} no declara annotations: marcas("${nombre}")`);
    else if (marca[1] !== nombre) fallas.push(`${nombre} usa las marcas de ${marca[1]}`);
  }
}
if (registradas.size === 0) fallas.push("no se encontró ningún registerTool: la prueba no está mirando el código");
else ok(`${registradas.size} herramientas registradas, cada una con su marca`);

// 2. El mapa no tiene entradas de herramientas que ya no existen.
const anotaciones = readFileSync(join(raiz, "src/platform/mcp/annotations.ts"), "utf8");
const bloque = anotaciones.slice(anotaciones.indexOf("export const MARCAS"), anotaciones.indexOf("} satisfies"));
const declaradas = new Map([...bloque.matchAll(/^\s*([a-z_]+):\s*([A-Z]+),/gm)].map((m) => [m[1], m[2]]));
for (const nombre of declaradas.keys()) {
  if (!registradas.has(nombre)) fallas.push(`MARCAS declara ${nombre}, que no se registra en ningún lado`);
}
ok(`${declaradas.size} entradas en MARCAS`);

// 3. Lo que por nombre sólo consulta está marcado como lectura, y lo que borra, como destructivo.
const lectura = /^(list_|get_|count_|query_|read_|describe_|export_|ver_|guia_|mis_|validar_|tablero_|como_|iteraciones_)/;
for (const [nombre, tipo] of declaradas) {
  if (lectura.test(nombre) && tipo !== "LEE") fallas.push(`${nombre} sólo consulta pero está marcada ${tipo}`);
  if (!lectura.test(nombre) && tipo === "LEE") fallas.push(`${nombre} modifica datos pero está marcada como lectura`);
  if (nombre.startsWith("delete_") && tipo !== "BORRA") fallas.push(`${nombre} borra pero está marcada ${tipo}`);
}
ok("las marcas coinciden con lo que cada herramienta hace");

if (fallas.length) {
  console.error("\nMarcas de herramientas MCP:");
  for (const falla of fallas) console.error(`  FALLA  ${falla}`);
  process.exit(1);
}
console.log("\nMarcas de herramientas MCP: todas las comprobaciones pasaron.");
