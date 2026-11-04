/**
 * Pruebas de las instrucciones de servidor MCP.
 *
 * Importa el módulo real (`instructions-text.ts`, sin dependencias) con
 * --experimental-strip-types, así que una prueba que pasa dice algo del código que
 * corre, no de una copia.
 *
 * Lo que tiene que valer:
 *   - la base sale siempre, aunque la configuración esté vacía o mal formada;
 *   - cada rol recibe lo general más lo suyo, y nunca lo de otro rol;
 *   - un texto largo no rompe el límite.
 */
import {
  LIMITE_INSTRUCCIONES,
  componerInstrucciones,
} from "../src/platform/mcp/instructions-text.ts";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? ` -- ${detalle}` : ""}`);
  }
}

const persona = {
  aplicacion: "Operación",
  descripcion: "Clientes y procesos",
  nombre: "Yani",
  rol: "colaborador",
  rolEtiqueta: "Colaborador",
  tipo: "user",
};
const agente = { ...persona, nombre: "Claude de Yani", tipo: "agent" };

for (const [nombre, valor] of [["sin configuración", null], ["número", 42], ["lista", ["x"]], ["texto vacío", "   "]]) {
  const salida = componerInstrucciones(persona, valor);
  comprobar(`base presente con ${nombre}`, salida.includes("«Operación»") && salida.includes("list_entities"));
}

comprobar("la persona sabe que escribe a su nombre", componerInstrucciones(persona, null).includes("registrado a tu nombre"));
comprobar(
  "el agente sabe que responde una persona",
  componerInstrucciones(agente, null).includes("persona que responde por esta credencial"),
);

const ID = "11111111-2222-3333-4444-555555555555";
comprobar(
  "la persona recibe su identificador",
  componerInstrucciones({ ...persona, persona: ID }, null).includes(`Tu identificador de persona es ${ID}`),
);
comprobar(
  "el agente recibe el de quien responde por él",
  componerInstrucciones({ ...agente, persona: ID }, null).includes(`La persona que responde por vos tiene el identificador ${ID}`),
);
comprobar(
  "sin persona no se inventa un identificador",
  !componerInstrucciones(agente, null).includes("identificador"),
);

const texto = componerInstrucciones(persona, "Empezá por mis pendientes.");
comprobar("un texto se envía a todos", texto.includes("Empezá por mis pendientes."));

const porRol = {
  general: "GENERAL",
  roles: { colaborador: "SOLO_COLABORADOR", director: "SOLO_DIRECTOR" },
};
const colaborador = componerInstrucciones(persona, porRol);
comprobar("el rol recibe lo general", colaborador.includes("GENERAL"));
comprobar("el rol recibe lo suyo", colaborador.includes("SOLO_COLABORADOR"));
comprobar("el rol no recibe lo de otro", !colaborador.includes("SOLO_DIRECTOR"));
const sinTexto = componerInstrucciones({ ...persona, rol: "socio" }, porRol);
comprobar("un rol sin texto propio recibe sólo lo general", sinTexto.includes("GENERAL") && !sinTexto.includes("SOLO_"));

const largo = componerInstrucciones(persona, "x".repeat(LIMITE_INSTRUCCIONES * 2));
comprobar("respeta el límite", largo.length <= LIMITE_INSTRUCCIONES, `largo ${largo.length}`);
comprobar("avisa que recortó", largo.endsWith("[Instrucciones recortadas: superan el límite de la plataforma.]"));

if (fallos) {
  console.error(`\n${fallos} prueba(s) fallaron.`);
  process.exit(1);
}
console.log("\nInstrucciones MCP: todas las pruebas pasaron.");
