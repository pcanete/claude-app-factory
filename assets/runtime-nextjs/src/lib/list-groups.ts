/**
 * Una lista agrupada por un campo de opciones, como la de las herramientas de trabajo
 * diario: los registros de cada estado juntos, en el orden en que el AppSpec declara las
 * opciones, con cuántos hay en cada grupo.
 *
 * Sin dependencias a propósito: `scripts/test-list-groups.mjs` prueba este mismo archivo.
 */

export type OpcionDeLista = { key: string; label: string };
export type CampoAgrupable = { key: string; label: string; options?: OpcionDeLista[] };
export type GrupoDeLista<R> = { key: string; label: string; records: R[] };

/** Clave del grupo de los registros sin valor, o con un valor que ya no es una opción. */
export const SIN_VALOR = "__sin_valor";

/**
 * Los grupos en el orden de las opciones. Los vacíos no se muestran: una lista con siete
 * encabezados y cuatro vacíos se lee peor que una con tres. Lo que no tiene valor, o tiene
 * uno que ya no existe, va al final y no se pierde.
 */
export function agruparPorOpcion<R extends Record<string, unknown>>(records: R[], campo: CampoAgrupable): Array<GrupoDeLista<R>> {
  const opciones = campo.options ?? [];
  const porClave = new Map<string, R[]>(opciones.map((opcion) => [opcion.key, []]));
  const sinValor: R[] = [];
  for (const record of records) {
    const valor = record[campo.key];
    const grupo = valor === null || valor === undefined ? undefined : porClave.get(String(valor));
    if (grupo) grupo.push(record);
    else sinValor.push(record);
  }
  const grupos = opciones
    .map((opcion) => ({ key: opcion.key, label: opcion.label, records: porClave.get(opcion.key) ?? [] }))
    .filter((grupo) => grupo.records.length > 0);
  if (sinValor.length) grupos.push({ key: SIN_VALOR, label: `Sin ${campo.label.toLowerCase()}`, records: sinValor });
  return grupos;
}

type CampoConTipo = { key: string; type: string };

/**
 * El campo de persona que define «míos» en una vista: el dueño que declara la política de
 * acceso, si es de persona; si no, el primer campo de persona que la vista muestra; si no,
 * el primero de la entidad. Sin ningún campo de persona, la vista no ofrece «míos».
 */
export function campoDeMios(
  entidad: { fields: CampoConTipo[]; record_access?: { owner_field?: string } },
  camposDeLaVista: string[] = [],
): string | null {
  const personas = entidad.fields.filter((campo) => campo.type === "person").map((campo) => campo.key);
  if (!personas.length) return null;
  const dueno = entidad.record_access?.owner_field;
  if (dueno && personas.includes(dueno)) return dueno;
  return camposDeLaVista.find((clave) => personas.includes(clave)) ?? personas[0];
}
