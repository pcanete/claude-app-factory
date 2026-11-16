import "server-only";
import type { PoolClient } from "pg";
import { sql, transactionSql } from "@/lib/db";
import { almacenConfigurado, borrarObjeto } from "@/platform/storage/almacen";

/**
 * Qué hay en el almacén y de qué registro es (`app_stored_file`). Los bytes viven en el
 * almacén; acá queda el nombre, el tamaño, el MD5 y si ya se comprobó que llegó.
 */

export type ArchivoGuardado = {
  id: string;
  entity_key: string;
  record_id: string;
  object_key: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  md5: string;
  status: "pendiente" | "guardado";
  created_by: string | null;
  created_at: Date;
  stored_at: Date | null;
};

const COLUMNAS = "id, entity_key, record_id, object_key, original_name, content_type, size_bytes, md5, status, created_by, created_at, stored_at";

// `size_bytes` es bigint: pg lo devuelve como texto.
function normalizar(fila: ArchivoGuardado): ArchivoGuardado {
  return { ...fila, size_bytes: Number(fila.size_bytes) };
}

export async function insertarPendiente(client: PoolClient, archivo: {
  id: string;
  entityKey: string;
  recordId: string;
  objectKey: string;
  nombre: string;
  tipo: string;
  tamano: number;
  md5: string;
  persona: string | null;
}) {
  await transactionSql(
    client,
    `INSERT INTO app_stored_file (id, entity_key, record_id, object_key, original_name, content_type, size_bytes, md5, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [archivo.id, archivo.entityKey, archivo.recordId, archivo.objectKey, archivo.nombre, archivo.tipo, archivo.tamano, archivo.md5, archivo.persona],
  );
}

export async function contarDelRegistro(client: PoolClient, entityKey: string, recordId: string) {
  const [fila] = await transactionSql<{ total: string }>(
    client,
    "SELECT count(*)::text AS total FROM app_stored_file WHERE entity_key = $1 AND record_id = $2",
    [entityKey, recordId],
  );
  return Number(fila?.total ?? 0);
}

export async function archivosDelRegistro(entityKey: string, recordId: string, soloGuardados = true) {
  const filas = await sql<ArchivoGuardado>(
    `SELECT ${COLUMNAS} FROM app_stored_file
      WHERE entity_key = $1 AND record_id = $2 ${soloGuardados ? "AND status = 'guardado'" : ""}
      ORDER BY original_name, created_at`,
    [entityKey, recordId],
  );
  return filas.map(normalizar);
}

export async function archivoPorId(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [fila] = await sql<ArchivoGuardado>(`SELECT ${COLUMNAS} FROM app_stored_file WHERE id = $1`, [id]);
  return fila ? normalizar(fila) : null;
}

export async function marcarGuardado(client: PoolClient, id: string) {
  await transactionSql(client, "UPDATE app_stored_file SET status = 'guardado', stored_at = now() WHERE id = $1 AND status = 'pendiente'", [id]);
}

/** Borra la fila de un archivo que nunca llegó, para que se pueda volver a pedir. */
export async function descartarPendiente(client: PoolClient, id: string) {
  const [fila] = await transactionSql<{ object_key: string }>(
    client,
    "DELETE FROM app_stored_file WHERE id = $1 AND status = 'pendiente' RETURNING object_key",
    [id],
  );
  return fila?.object_key ?? null;
}

/**
 * Borra las filas de un registro dentro de su transacción y devuelve las claves, para borrar
 * los objetos con `borrarDelAlmacen` recién cuando la transacción se confirmó: si se borraran
 * antes y la transacción fallara, el registro quedaría apuntando a archivos que ya no existen.
 */
export async function soltarDelRegistro(client: PoolClient, entityKey: string, recordId: string) {
  // Sin la tabla (una aplicación que todavía no aplicó la migración) no hay nada que soltar.
  const [existe] = await transactionSql<{ existe: boolean }>(client, "SELECT to_regclass('app_stored_file') IS NOT NULL AS existe", []);
  if (!existe?.existe) return [] as Array<{ id: string; object_key: string; original_name: string; size_bytes: number }>;
  const filas = await transactionSql<{ id: string; object_key: string; original_name: string; size_bytes: number }>(
    client,
    "DELETE FROM app_stored_file WHERE entity_key = $1 AND record_id = $2 RETURNING id, object_key, original_name, size_bytes",
    [entityKey, recordId],
  );
  return filas.map((fila) => ({ ...fila, size_bytes: Number(fila.size_bytes) }));
}

/** Borra objetos del almacén sin frenar a quien borró: lo que no se pudo queda en el log. */
export async function borrarDelAlmacen(claves: string[]) {
  if (!claves.length || !almacenConfigurado()) return;
  const resultados = await Promise.allSettled(claves.map((clave) => borrarObjeto(clave)));
  resultados.forEach((resultado, indice) => {
    if (resultado.status === "rejected") console.error("No se pudo borrar del almacén", claves[indice], resultado.reason);
  });
}
