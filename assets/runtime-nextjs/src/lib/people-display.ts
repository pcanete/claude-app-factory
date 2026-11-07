import "server-only";
import { sql } from "@/lib/db";
import type { EntitySpec } from "@/lib/spec";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Los registros listos para mostrar, con el nombre de la persona en vez de su id.
 *
 * Un campo de tipo persona guarda el id de `app_user`, y las tablas, el kanban y la ficha lo
 * mostraban tal cual: una columna «Autor» llena de `5ff2c6ea-…`. Esto devuelve copias con el
 * nombre (o el correo, si no tiene nombre) para mostrar, nunca para guardar: los formularios
 * siguen recibiendo el registro original con el id.
 *
 * Una sola consulta por página, sólo si la entidad tiene campos de persona.
 */
export async function conNombresDePersonas<T extends Record<string, unknown>>(entity: EntitySpec, records: T[]): Promise<T[]> {
  const campos = entity.fields.filter((field) => field.type === "person").map((field) => field.key);
  if (!campos.length || !records.length) return records;
  const ids = [...new Set(records.flatMap((record) => campos.map((campo) => record[campo])))]
    .filter((valor): valor is string => typeof valor === "string" && UUID.test(valor));
  if (!ids.length) return records;
  const filas = await sql<{ id: string; display_name: string | null; email: string | null }>(
    "SELECT id, display_name, email FROM app_user WHERE id = ANY($1::uuid[])",
    [ids],
  );
  const nombres = new Map(filas.map((fila) => [fila.id, fila.display_name?.trim() || fila.email || "Persona sin nombre"]));
  return records.map((record) => {
    const copia: Record<string, unknown> = { ...record };
    for (const campo of campos) {
      const valor = record[campo];
      if (typeof valor === "string" && UUID.test(valor)) copia[campo] = nombres.get(valor) ?? "Persona eliminada";
    }
    return copia as T;
  });
}
