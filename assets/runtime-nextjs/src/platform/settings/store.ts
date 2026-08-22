import "server-only";
import type { PoolClient } from "pg";
import { sql, transactionSql } from "@/lib/db";

/**
 * Configuración del sistema: pares clave/valor con alcance global o por usuario.
 *
 * Es una primitiva deliberadamente abierta —el valor es JSON, así que admite
 * escalares, objetos y listas— pero con una frontera clara: **es para configuración,
 * no para datos de negocio**. Lo que pertenece al dominio va como entidad de la
 * AppSpec, donde tiene tipos, permisos, reglas y auditoría por registro.
 *
 * No hay carga automática de todas las opciones: se leen las que se piden. Cargar
 * todo en cada request es lo que convierte una tabla como esta en el cuello de
 * botella de la aplicación.
 */

const NOMBRE = /^[a-z][a-z0-9_.-]{0,63}$/;
const MAXIMO_BYTES = 256 * 1024;

export type Setting = {
  namespace: string;
  key: string;
  value: unknown;
  updated_at: string;
  updated_by: string | null;
  updated_by_agent: string | null;
  updated_by_name: string | null;
};

/**
 * Quién dejó un valor. Una persona y un agente son actores distintos y viven en
 * tablas distintas, así que no comparten columna: mezclarlos obligaba a guardar
 * `NULL` cada vez que escribía un agente, y con eso se perdía el autor.
 */
export type ActorDeConfiguracion = { kind: "user" | "agent"; id: string };

/**
 * Convierte lo que la persona escribió en un nombre válido.
 *
 * Decir "usá minúsculas, dígitos, punto, guion o guion bajo" y devolver el texto
 * rechazado obliga a traducir la regla a mano. Mostrar la versión que sí sirve
 * convierte el rechazo en una respuesta.
 */
function sugerirNombre(valor: string) {
  const sugerencia = valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, 64)
    .replace(/_+$/, "");
  return NOMBRE.test(sugerencia) ? sugerencia : null;
}

function validarNombre(namespace: string, key: string) {
  for (const [etiqueta, valor] of [["El espacio", namespace], ["La clave", key]] as const) {
    if (NOMBRE.test(valor)) continue;
    const sugerencia = sugerirNombre(valor);
    throw new Error(
      sugerencia
        ? `${etiqueta} "${valor}" no es un nombre válido. Probá con: ${sugerencia}`
        : `${etiqueta} debe empezar con una letra y usar sólo minúsculas, dígitos, punto, guion o guion bajo.`,
    );
  }
}

function serializar(value: unknown) {
  if (value === undefined) throw new Error("El valor no puede estar vacío: usá null si querés registrar la ausencia.");
  const texto = JSON.stringify(value);
  if (texto === undefined) throw new Error("El valor no es serializable como JSON.");
  // Un límite explícito evita que la configuración se convierta en almacenamiento.
  if (Buffer.byteLength(texto, "utf8") > MAXIMO_BYTES) {
    throw new Error("El valor supera 256 KB. La configuración no es el lugar para guardar contenido.");
  }
  return texto;
}

/** Opciones globales, opcionalmente acotadas a un espacio de nombres. */
export async function listSettings(namespace?: string) {
  const filtrado = typeof namespace === "string";
  if (filtrado) validarNombre(namespace, "x");
  return sql<Setting>(
    `SELECT s.namespace,
            s.key,
            s.value,
            s.updated_at,
            s.updated_by,
            s.updated_by_agent,
            COALESCE(actor.display_name, agente.name) AS updated_by_name
       FROM app_setting AS s
       LEFT JOIN app_user AS actor ON actor.id = s.updated_by
       LEFT JOIN app_agent AS agente ON agente.id = s.updated_by_agent
      ${filtrado ? "WHERE s.namespace = $1" : ""}
      ORDER BY s.namespace ASC, s.key ASC`,
    filtrado ? [namespace] : [],
  );
}

export async function getSetting(namespace: string, key: string) {
  validarNombre(namespace, key);
  const filas = await sql<Setting>(
    `SELECT s.namespace, s.key, s.value, s.updated_at, s.updated_by, s.updated_by_agent,
            COALESCE(actor.display_name, agente.name) AS updated_by_name
       FROM app_setting AS s
       LEFT JOIN app_user AS actor ON actor.id = s.updated_by
       LEFT JOIN app_agent AS agente ON agente.id = s.updated_by_agent
      WHERE s.namespace = $1 AND s.key = $2
      LIMIT 1`,
    [namespace, key],
  );
  return filas[0] ?? null;
}

export async function setSetting(
  client: PoolClient,
  input: { namespace: string; key: string; value: unknown; actor?: ActorDeConfiguracion | null },
) {
  validarNombre(input.namespace, input.key);
  const actor = input.actor ?? null;
  const filas = await transactionSql<Setting>(
    client,
    `INSERT INTO app_setting (namespace, key, value, updated_by, updated_by_agent, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, now())
     ON CONFLICT (namespace, key)
     DO UPDATE SET value = EXCLUDED.value,
                   updated_by = EXCLUDED.updated_by,
                   updated_by_agent = EXCLUDED.updated_by_agent,
                   updated_at = now()
     RETURNING namespace, key, value, updated_at, updated_by, updated_by_agent,
               NULL::text AS updated_by_name`,
    [
      input.namespace,
      input.key,
      serializar(input.value),
      actor?.kind === "user" ? actor.id : null,
      actor?.kind === "agent" ? actor.id : null,
    ],
  );
  return filas[0];
}

export async function deleteSetting(client: PoolClient, namespace: string, key: string) {
  validarNombre(namespace, key);
  const filas = await transactionSql<{ namespace: string; key: string; value: unknown }>(
    client,
    `DELETE FROM app_setting WHERE namespace = $1 AND key = $2
     RETURNING namespace, key, value`,
    [namespace, key],
  );
  return filas[0] ?? null;
}

/** Preferencias del usuario que las carga. No las ve nadie más. */
export async function listUserSettings(userId: string, namespace?: string) {
  const filtrado = typeof namespace === "string";
  if (filtrado) validarNombre(namespace, "x");
  return sql<{ namespace: string; key: string; value: unknown; updated_at: string }>(
    `SELECT namespace, key, value, updated_at
       FROM app_user_setting
      WHERE user_id = $1 ${filtrado ? "AND namespace = $2" : ""}
      ORDER BY namespace ASC, key ASC`,
    filtrado ? [userId, namespace] : [userId],
  );
}

export async function setUserSetting(
  client: PoolClient,
  input: { userId: string; namespace: string; key: string; value: unknown },
) {
  validarNombre(input.namespace, input.key);
  const filas = await transactionSql<{ namespace: string; key: string; value: unknown }>(
    client,
    `INSERT INTO app_user_setting (user_id, namespace, key, value, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (user_id, namespace, key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     RETURNING namespace, key, value`,
    [input.userId, input.namespace, input.key, serializar(input.value)],
  );
  return filas[0];
}

export async function deleteUserSetting(client: PoolClient, userId: string, namespace: string, key: string) {
  validarNombre(namespace, key);
  const filas = await transactionSql<{ namespace: string; key: string }>(
    client,
    `DELETE FROM app_user_setting WHERE user_id = $1 AND namespace = $2 AND key = $3
     RETURNING namespace, key`,
    [userId, namespace, key],
  );
  return filas[0] ?? null;
}
