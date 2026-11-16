import "server-only";
import { sql } from "@/lib/db";

/**
 * Las versiones de los recursos (`app_resource`): skills y carpetas de archivos que un
 * proceso trae. Los bytes viven en el almacén; acá queda qué versión hay y si ya se comprobó.
 */
export type VersionDeRecurso = {
  id: string;
  nombre: string;
  tipo: "skill" | "archivos";
  version: string;
  object_key: string;
  size_bytes: number;
  md5: string;
  sha256: string;
  status: "pendiente" | "publicado";
  published_at: Date | null;
};

const COLUMNAS = "id, nombre, tipo, version, object_key, size_bytes, md5, sha256, status, published_at";
const normalizar = (fila: VersionDeRecurso): VersionDeRecurso => ({ ...fila, size_bytes: Number(fila.size_bytes) });

export async function versionDeRecurso(nombre: string, version: string) {
  const [fila] = await sql<VersionDeRecurso>(`SELECT ${COLUMNAS} FROM app_resource WHERE nombre = $1 AND version = $2`, [nombre, version]);
  return fila ? normalizar(fila) : null;
}

/** La versión vigente de cada nombre pedido: la última publicada. Los que no tienen ninguna no vuelven. */
export async function versionesVigentes(nombres: readonly string[]) {
  if (!nombres.length) return new Map<string, VersionDeRecurso>();
  const existe = await sql<{ existe: boolean }>("SELECT to_regclass('app_resource') IS NOT NULL AS existe");
  if (!existe[0]?.existe) return new Map<string, VersionDeRecurso>();
  const filas = await sql<VersionDeRecurso>(
    `SELECT DISTINCT ON (nombre) ${COLUMNAS} FROM app_resource
      WHERE status = 'publicado' AND nombre = ANY($1::text[])
      ORDER BY nombre, published_at DESC`,
    [nombres],
  );
  return new Map(filas.map((fila) => [fila.nombre, normalizar(fila)]));
}

export async function insertarVersionPendiente(entrada: {
  nombre: string;
  tipo: "skill" | "archivos";
  version: string;
  objectKey: string;
  tamano: number;
  md5: string;
  sha256: string;
  persona: string | null;
}) {
  // Una versión pendiente que nunca llegó se puede volver a pedir: se reemplaza.
  await sql("DELETE FROM app_resource WHERE nombre = $1 AND version = $2 AND status = 'pendiente'", [entrada.nombre, entrada.version]);
  await sql(
    `INSERT INTO app_resource (nombre, tipo, version, object_key, size_bytes, md5, sha256, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [entrada.nombre, entrada.tipo, entrada.version, entrada.objectKey, entrada.tamano, entrada.md5, entrada.sha256, entrada.persona],
  );
}

export async function marcarPublicada(id: string) {
  await sql("UPDATE app_resource SET status = 'publicado', published_at = now() WHERE id = $1 AND status = 'pendiente'", [id]);
}

export async function descartarVersion(id: string) {
  await sql("DELETE FROM app_resource WHERE id = $1 AND status = 'pendiente'", [id]);
}
