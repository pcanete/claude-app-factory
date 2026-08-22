/**
 * Guarda contra migraciones que borran datos durante un despliegue.
 *
 * El runner de migraciones corre dentro del build. Eso está bien mientras las
 * migraciones sólo agreguen: una columna nueva no le hace daño a nadie y evitar el
 * paso manual es la mitad del valor de la fábrica. Pero significa que un `git push`
 * ejecuta lo que diga el SQL, y si el SQL dice `DROP TABLE`, la tabla se va sin que
 * nadie lo haya decidido en ese momento.
 *
 * La guarda no prohíbe destruir: prohíbe destruir *en silencio*. Y lo decide mirando
 * la base, no el texto. `DROP TABLE IF EXISTS ai_conversation` sobre una base donde
 * esa tabla nunca existió no borra nada, y frenar ahí sería puro ruido en cada
 * aplicación nueva y en cada corrida de CI. Frena cuando el objeto existe y tiene
 * datos: ahí sí hay algo que perder y la decisión es de una persona.
 */

const IDENTIFICADOR = /^[a-z_][a-z0-9_$]*$/i;

/** Quita comentarios para no confundir una explicación con una sentencia. */
export function sinComentarios(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function limpiarObjeto(bruto) {
  return bruto
    .replace(/\b(cascade|restrict)\b/gi, "")
    .replace(/"/g, "")
    .trim();
}

/** Nombre calificado -> { esquema, tabla } listo para consultar, o null si es raro. */
function partirNombre(nombre) {
  const partes = nombre.split(".").map((parte) => parte.trim()).filter(Boolean);
  if (partes.length === 1 && IDENTIFICADOR.test(partes[0])) {
    return { esquema: "public", tabla: partes[0] };
  }
  if (partes.length === 2 && partes.every((parte) => IDENTIFICADOR.test(parte))) {
    return { esquema: partes[0], tabla: partes[1] };
  }
  return null;
}

/**
 * Encuentra las operaciones que pueden perder datos.
 * Devuelve descriptores; todavía no sabe si hay algo que perder.
 */
export function operacionesDestructivas(sql) {
  const limpio = sinComentarios(sql);
  const hallazgos = [];

  for (const coincidencia of limpio.matchAll(/\bdrop\s+table\s+(?:if\s+exists\s+)?([^;]+)/gi)) {
    for (const bruto of coincidencia[1].split(",")) {
      const objeto = limpiarObjeto(bruto);
      if (objeto) hallazgos.push({ operacion: "DROP TABLE", objeto });
    }
  }

  for (const coincidencia of limpio.matchAll(/\btruncate\s+(?:table\s+)?([^;]+)/gi)) {
    for (const bruto of coincidencia[1].split(",")) {
      const objeto = limpiarObjeto(bruto);
      if (objeto) hallazgos.push({ operacion: "TRUNCATE", objeto });
    }
  }

  // Un solo ALTER TABLE puede soltar varias columnas.
  for (const coincidencia of limpio.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?([^\s;]+)([\s\S]*?)(?=;|$)/gi)) {
    const objeto = limpiarObjeto(coincidencia[1]);
    for (const columna of coincidencia[2].matchAll(/\bdrop\s+column\s+(?:if\s+exists\s+)?([^\s,;]+)/gi)) {
      hallazgos.push({ operacion: "DROP COLUMN", objeto, columna: limpiarObjeto(columna[1]) });
    }
  }

  // Un DELETE sin WHERE vacía la tabla; con WHERE es trabajo de datos, no de esquema.
  for (const coincidencia of limpio.matchAll(/\bdelete\s+from\s+([^\s;]+)([^;]*)/gi)) {
    if (!/\bwhere\b/i.test(coincidencia[2])) {
      hallazgos.push({ operacion: "DELETE sin WHERE", objeto: limpiarObjeto(coincidencia[1]) });
    }
  }

  for (const coincidencia of limpio.matchAll(/\bdrop\s+(schema|database)\s+(?:if\s+exists\s+)?([^\s;]+)/gi)) {
    hallazgos.push({
      operacion: `DROP ${coincidencia[1].toUpperCase()}`,
      objeto: limpiarObjeto(coincidencia[2]),
      siempreGrave: true,
    });
  }

  return hallazgos;
}

/**
 * De las operaciones encontradas, cuáles perderían datos reales en ESTA base.
 * Ante cualquier duda -- un nombre que no se puede analizar, una consulta que falla --
 * se asume que hay algo que perder.
 */
export async function operacionesConDatos(client, hallazgos) {
  const graves = [];

  for (const hallazgo of hallazgos) {
    if (hallazgo.siempreGrave) {
      graves.push({ ...hallazgo, motivo: "alcanza objetos que no se pueden inspeccionar de a uno" });
      continue;
    }

    const partido = partirNombre(hallazgo.objeto);
    if (!partido) {
      graves.push({ ...hallazgo, motivo: "no se pudo interpretar el nombre del objeto" });
      continue;
    }

    const referencia = `${partido.esquema}.${partido.tabla}`;
    try {
      const existe = await client.query("SELECT to_regclass($1) AS oid", [referencia]);
      if (!existe.rows[0]?.oid) continue; // No existe: no hay nada que perder.

      if (hallazgo.columna) {
        if (!IDENTIFICADOR.test(hallazgo.columna)) {
          graves.push({ ...hallazgo, motivo: "no se pudo interpretar el nombre de la columna" });
          continue;
        }
        const columna = await client.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
          [partido.esquema, partido.tabla, hallazgo.columna],
        );
        if (!columna.rowCount) continue; // La columna ya no está.
        const conValores = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM "${partido.esquema}"."${partido.tabla}"
              WHERE "${hallazgo.columna}" IS NOT NULL LIMIT 1
           ) AS hay`,
        );
        if (conValores.rows[0]?.hay) {
          graves.push({ ...hallazgo, motivo: "la columna tiene valores" });
        }
        continue;
      }

      // `LIMIT 1` en lugar de `count(*)`: alcanza saber si hay algo, y no cuesta
      // recorrer una tabla grande durante un despliegue.
      const conFilas = await client.query(
        `SELECT EXISTS (SELECT 1 FROM "${partido.esquema}"."${partido.tabla}" LIMIT 1) AS hay`,
      );
      if (conFilas.rows[0]?.hay) {
        graves.push({ ...hallazgo, motivo: "la tabla tiene filas" });
      }
    } catch (error) {
      graves.push({ ...hallazgo, motivo: `no se pudo verificar: ${error.message}` });
    }
  }

  return graves;
}

/** Migraciones que una persona autorizó por nombre, vía variable de entorno. */
export function migracionesAutorizadas(entorno = process.env) {
  return new Set(
    String(entorno.ALLOW_DESTRUCTIVE_MIGRATIONS ?? "")
      .split(",")
      .map((nombre) => nombre.trim())
      .filter(Boolean),
  );
}

export function mensajeDeBloqueo(nombreMigracion, graves) {
  const detalle = graves
    .map((g) => `  - ${g.operacion} sobre ${g.objeto}${g.columna ? `.${g.columna}` : ""}: ${g.motivo}`)
    .join("\n");
  return [
    `La migración ${nombreMigracion} borra datos que existen en esta base:`,
    detalle,
    "",
    "No se aplica sola durante un despliegue. Antes de autorizarla:",
    "  1. Tomá un respaldo y comprobá que se puede restaurar.",
    "  2. Si el objetivo es dejar de usar algo, primero desacoplá el código y",
    "     desplegá; borrar los datos es un paso posterior y separado.",
    "",
    "Para autorizarla, nombrala explícitamente:",
    `  ALLOW_DESTRUCTIVE_MIGRATIONS="${nombreMigracion}"`,
  ].join("\n");
}
