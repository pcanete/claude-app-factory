/**
 * Pruebas de la guarda contra migraciones destructivas.
 *
 * Dos mitades, dos formas de probarlas: el análisis del SQL es una función pura y se
 * prueba con las migraciones reales del kernel; la consulta a la base se prueba con
 * un cliente simulado, porque lo que importa no es que PostgreSQL sepa contar sino
 * que la guarda frene cuando hay filas y deje pasar cuando no las hay.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  mensajeDeBloqueo,
  migracionesAutorizadas,
  operacionesConDatos,
  operacionesDestructivas,
} from "./destructive-guard.mjs";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? ` -- ${detalle}` : ""}`);
  }
}

console.log("Análisis del SQL");

const retiro = await readFile(resolve("database/platform/160_retirar_asistente.sql"), "utf8");
const enRetiro = operacionesDestructivas(retiro);
comprobar(
  "la migración de retiro declara sus cinco DROP TABLE",
  enRetiro.filter((o) => o.operacion === "DROP TABLE").length === 5,
  JSON.stringify(enRetiro),
);
comprobar(
  "no confunde el comentario sobre app_setting con una sentencia",
  !enRetiro.some((o) => o.objeto === "app_setting"),
);

for (const archivo of ["110_user_management.sql", "140_mcp_agents.sql", "150_mcp_write.sql"]) {
  const sql = await readFile(resolve(`database/platform/${archivo}`), "utf8");
  comprobar(`${archivo} no dispara la guarda`, operacionesDestructivas(sql).length === 0);
}

comprobar(
  "un comentario que menciona DROP TABLE no cuenta",
  operacionesDestructivas("-- ojo: no hacer DROP TABLE cliente\nALTER TABLE cliente ADD COLUMN x text;").length === 0,
);
comprobar(
  "un ALTER con varias columnas las declara todas",
  operacionesDestructivas("ALTER TABLE cliente DROP COLUMN a, DROP COLUMN IF EXISTS b;").length === 2,
);
comprobar(
  "DELETE con WHERE no es una migración destructiva",
  operacionesDestructivas("DELETE FROM cliente WHERE estado = 'baja';").length === 0,
);
comprobar(
  "DELETE sin WHERE sí lo es",
  operacionesDestructivas("DELETE FROM cliente;").length === 1,
);
comprobar(
  "TRUNCATE con varias tablas las declara todas",
  operacionesDestructivas("TRUNCATE TABLE cliente, interaccion CASCADE;").length === 2,
);
comprobar(
  "DROP SCHEMA se marca como grave sin poder inspeccionarlo",
  operacionesDestructivas("DROP SCHEMA public CASCADE;")[0]?.siempreGrave === true,
);

console.log("\nDecisión contra la base");

function clienteFalso({ existen = [], conFilas = [], columnasConValores = [] }) {
  return {
    async query(sql, params) {
      if (sql.includes("to_regclass")) {
        return { rows: [{ oid: existen.includes(params[0]) ? 12345 : null }] };
      }
      if (sql.includes("information_schema.columns")) {
        const clave = `${params[1]}.${params[2]}`;
        return { rowCount: columnasConValores.some((c) => c.startsWith(clave)) ? 1 : 0 };
      }
      if (sql.includes("IS NOT NULL")) {
        const clave = sql.match(/"public"\."(\w+)"[\s\S]*?WHERE "(\w+)"/);
        return { rows: [{ hay: columnasConValores.includes(`${clave[1]}.${clave[2]}=valores`) }] };
      }
      const tabla = sql.match(/"public"\."(\w+)"/)?.[1];
      return { rows: [{ hay: conFilas.includes(tabla) }] };
    },
  };
}

const dropCliente = operacionesDestructivas("DROP TABLE IF EXISTS cliente;");

comprobar(
  "una tabla que no existe no frena el despliegue",
  (await operacionesConDatos(clienteFalso({ existen: [] }), dropCliente)).length === 0,
);
comprobar(
  "una tabla existente pero vacía tampoco",
  (await operacionesConDatos(clienteFalso({ existen: ["public.cliente"], conFilas: [] }), dropCliente)).length === 0,
);
comprobar(
  "una tabla con filas frena el despliegue",
  (await operacionesConDatos(
    clienteFalso({ existen: ["public.cliente"], conFilas: ["cliente"] }),
    dropCliente,
  )).length === 1,
);
comprobar(
  "una consulta que falla se trata como riesgo, no como permiso",
  (await operacionesConDatos(
    { async query() { throw new Error("sin conexión"); } },
    dropCliente,
  )).length === 1,
);
comprobar(
  "un nombre que no se puede interpretar se trata como riesgo",
  (await operacionesConDatos(clienteFalso({}), [{ operacion: "DROP TABLE", objeto: "algo raro(" }])).length === 1,
);

const dropColumna = operacionesDestructivas("ALTER TABLE cliente DROP COLUMN notas;");
comprobar(
  "una columna sin valores no frena el despliegue",
  (await operacionesConDatos(
    clienteFalso({ existen: ["public.cliente"], columnasConValores: ["cliente.notas"] }),
    dropColumna,
  )).length === 0,
);
comprobar(
  "una columna con valores sí lo frena",
  (await operacionesConDatos(
    clienteFalso({ existen: ["public.cliente"], columnasConValores: ["cliente.notas=valores"] }),
    dropColumna,
  )).length === 1,
);

console.log("\nAutorización explícita");
comprobar(
  "sin variable no hay ninguna migración autorizada",
  migracionesAutorizadas({}).size === 0,
);
comprobar(
  "se autoriza por nombre, no en bloque",
  migracionesAutorizadas({ ALLOW_DESTRUCTIVE_MIGRATIONS: "platform/160_retirar_asistente.sql, otra.sql" })
    .has("platform/160_retirar_asistente.sql"),
);
comprobar(
  "el mensaje dice qué se pierde y cómo autorizarlo",
  (() => {
    const texto = mensajeDeBloqueo("platform/160.sql", [
      { operacion: "DROP TABLE", objeto: "cliente", motivo: "la tabla tiene filas" },
    ]);
    return texto.includes("cliente")
      && texto.includes("respaldo")
      && texto.includes('ALLOW_DESTRUCTIVE_MIGRATIONS="platform/160.sql"');
  })(),
);

console.log(fallos === 0 ? "\nGuarda verificada." : `\n${fallos} comprobaciones fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
