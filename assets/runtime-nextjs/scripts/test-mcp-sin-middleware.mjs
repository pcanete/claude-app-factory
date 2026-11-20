/**
 * Las rutas que se autentican solas no pasan por el middleware de Clerk.
 *
 * En /api/mcp el middleware dejaba la invocación abierta hasta el tope de 300 s aunque la
 * respuesta ya hubiera salido: un tercio de las llamadas, y casi todo el consumo de funciones
 * de un plan con límite. Esta prueba lee el `matcher` de `src/proxy.ts` y lo convierte con la
 * misma función que usa Next al compilar (`getMiddlewareMatchers`): no una copia de su lógica.
 * Exige que /api/mcp, el ticket de subida y la salud queden afuera, que el resto del panel y
 * de /api siga pasando, y que la función corte antes de Clerk también para esas rutas.
 *
 * Además exige que la verificación OAuth no use `auth()`, que sin el middleware falla: tiene
 * que verificar con el pedido en la mano (`authenticateRequest`).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getMiddlewareMatchers } = require("next/dist/build/analysis/get-page-static-info");

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? `\n         ${detalle}` : ""}`);
  }
}

const proxy = readFileSync("src/proxy.ts", "utf8");
const lista = /matcher:\s*(\[[\s\S]*?\])\s*,?\s*\}/.exec(proxy);
comprobar("src/proxy.ts declara un matcher", Boolean(lista));
const patrones = lista ? new Function(`return ${lista[1]}`)() : [];
const regex = getMiddlewareMatchers(patrones, {}).map((m) => new RegExp(m.regexp));
const pasa = (ruta) => regex.some((r) => r.test(ruta));

for (const ruta of ["/api/mcp", "/api/producido/subidas", "/api/health"]) {
  comprobar(`${ruta} no pasa por el middleware`, !pasa(ruta));
}
for (const ruta of ["/", "/agents", "/records/cliente", "/procesos/algo", "/api/otra-ruta", "/producido/abc"]) {
  comprobar(`${ruta} sigue pasando por el middleware`, pasa(ruta));
}
comprobar("la función corta antes de Clerk para esas rutas",
  /seAutenticaSola\(request\.nextUrl\.pathname\)\)\s*return NextResponse\.next\(\)/.test(proxy)
    && proxy.indexOf("seAutenticaSola(request") < proxy.indexOf("withClerk(request"));

const oauth = readFileSync("src/platform/mcp/oauth.ts", "utf8");
comprobar("la verificación OAuth no depende del middleware (sin auth())", !/\bauth\(\s*\{/.test(oauth) && /authenticateRequest\(/.test(oauth));
const ruta = readFileSync("src/app/api/mcp/route.ts", "utf8");
comprobar("/api/mcp tiene un fusible de duración", /export const maxDuration = \d+;/.test(ruta));

if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nMCP sin middleware: todas las comprobaciones pasaron.");
