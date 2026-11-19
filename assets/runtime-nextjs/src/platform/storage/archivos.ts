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

/**
 * Reserva el lugar de un archivo que se va a subir, sin duplicar: si en ese registro ya hay
 * uno con el mismo nombre y el mismo MD5, se usa ese.
 *
 *   - `ya_guardado`: el archivo ya está. No se crea nada; la dirección que se entregue apunta
 *     al mismo objeto, con su tipo, y como el Content-MD5 va firmado, subirlo otra vez escribe
 *     los mismos bytes. Un script que sube todo de nuevo después de un error no rompe nada.
 *   - `reemplazado`: había uno pendiente igual (una subida que no terminó). Se reutiliza su
 *     lugar y su clave, a nombre de quien sube ahora, y los otros pendientes iguales se sueltan.
 *   - `nuevo`: no había ninguno.
 *
 * Va dentro de la transacción de quien pide la subida, con el registro bloqueado: dos pedidos
 * a la vez no pueden reservar el mismo archivo dos veces. Devuelve las claves de pendientes
 * soltados para borrarlas del almacén después de confirmar la transacción.
 */
export async function reservarSubida(client: PoolClient, archivo: {
  id: string;
  entityKey: string;
  recordId: string;
  objectKey: string;
  nombre: string;
  tipo: string;
  tamano: number;
  md5: string;
  persona: string | null;
}): Promise<{ id: string; objectKey: string; tipo: string; estado: "nuevo" | "reemplazado" | "ya_guardado"; soltados: string[] }> {
  const iguales = await transactionSql<{ id: string; object_key: string; content_type: string; status: "pendiente" | "guardado" }>(
    client,
    `SELECT id, object_key, content_type, status FROM app_stored_file
      WHERE entity_key = $1 AND record_id = $2 AND original_name = $3 AND md5 = $4
      ORDER BY (status = 'guardado') DESC, created_at, id`,
    [archivo.entityKey, archivo.recordId, archivo.nombre, archivo.md5],
  );
  const guardado = iguales.find((fila) => fila.status === "guardado");
  if (guardado) return { id: guardado.id, objectKey: guardado.object_key, tipo: guardado.content_type, estado: "ya_guardado", soltados: [] };
  const [pendiente, ...sobrantes] = iguales;
  if (pendiente) {
    await transactionSql(
      client,
      "UPDATE app_stored_file SET content_type = $2, size_bytes = $3, created_by = $4, created_at = now() WHERE id = $1",
      [pendiente.id, archivo.tipo, archivo.tamano, archivo.persona],
    );
    const soltados: string[] = [];
    for (const sobrante of sobrantes) {
      const clave = await descartarPendiente(client, sobrante.id);
      if (clave) soltados.push(clave);
    }
    return { id: pendiente.id, objectKey: pendiente.object_key, tipo: archivo.tipo, estado: "reemplazado", soltados };
  }
  await transactionSql(
    client,
    `INSERT INTO app_stored_file (id, entity_key, record_id, object_key, original_name, content_type, size_bytes, md5, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [archivo.id, archivo.entityKey, archivo.recordId, archivo.objectKey, archivo.nombre, archivo.tipo, archivo.tamano, archivo.md5, archivo.persona],
  );
  return { id: archivo.id, objectKey: archivo.objectKey, tipo: archivo.tipo, estado: "nuevo", soltados: [] };
}

export type AdjuntoSoltado = { id: string; original_name: string; content_type: string; size_bytes: number; sha256: string };

/**
 * Borra un archivo de lo producido de un registro y, si había quedado como vista previa, el
 * adjunto que es su copia: el de ese registro con el mismo nombre y los mismos bytes (el MD5
 * del contenido). Si queda otro archivo guardado igual —un duplicado que se está limpiando—
 * el adjunto se queda, porque sigue representando lo producido.
 *
 * Va dentro de una transacción; devuelve el archivo para borrar su objeto con
 * `borrarDelAlmacen` recién cuando la transacción se confirmó. Null si el archivo no es de
 * ese registro.
 */
export async function soltarProducido(client: PoolClient, entityKey: string, recordId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [archivo] = await transactionSql<ArchivoGuardado>(
    client,
    `DELETE FROM app_stored_file WHERE id = $1 AND entity_key = $2 AND record_id = $3 RETURNING ${COLUMNAS}`,
    [id, entityKey, recordId],
  );
  if (!archivo) return null;
  const adjuntos = archivo.status !== "guardado" ? [] : await transactionSql<AdjuntoSoltado>(
    client,
    `DELETE FROM app_attachment AS adjunto
      WHERE adjunto.entity_key = $1 AND adjunto.record_id = $2 AND adjunto.original_name = $3
        AND md5(adjunto.content) = $4
        AND NOT EXISTS (
          SELECT 1 FROM app_stored_file AS gemelo
           WHERE gemelo.entity_key = $1 AND gemelo.record_id = $2 AND gemelo.original_name = $3
             AND gemelo.md5 = $4 AND gemelo.status = 'guardado')
      RETURNING adjunto.id, adjunto.original_name, adjunto.content_type, adjunto.size_bytes, adjunto.sha256`,
    [entityKey, recordId, archivo.original_name, archivo.md5],
  );
  return { archivo: normalizar(archivo), adjuntos };
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
