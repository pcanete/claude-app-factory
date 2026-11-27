/**
 * Cómo se reparte la ficha de un registro en dos columnas, al estilo de las herramientas de
 * trabajo diario: a la izquierda lo que se lee (los textos largos y lo relacionado, como una
 * línea de tiempo); a la derecha lo que se consulta de un vistazo y se cambia en el lugar
 * (las propiedades).
 *
 * Sin dependencias a propósito: `scripts/test-record-layout.mjs` prueba este mismo archivo.
 */

type Campo = { key: string; label: string; type: string };
type Relacion = { key: string; label: string; type: string; target: string };
type Entidad = { key: string; label: string; label_plural?: string; title_field: string; fields: Campo[]; relationships?: Relacion[] };

const LARGOS = new Set(["long_text", "json", "file"]);

/** Los textos largos van a la columna principal; el resto, a las propiedades. El título no se repite. */
export function repartirCampos<C extends Campo>(entidad: { title_field: string; fields: C[] }) {
  const campos = entidad.fields.filter((campo) => campo.key !== entidad.title_field);
  return {
    principales: campos.filter((campo) => LARGOS.has(campo.type)),
    propiedades: campos.filter((campo) => !LARGOS.has(campo.type)),
  };
}

/** Las propiedades que se cambian en el lugar: las de opciones y las de sí o no. */
export function seEditaEnElLugar(campo: { type: string }) {
  return campo.type === "enum" || campo.type === "boolean";
}

export type EntidadHija<E> = { entidad: E; relacion: Relacion };

/**
 * Las entidades que apuntan a esta con una relación `belongs_to`: lo relacionado que se
 * muestra como línea de tiempo. En un compromiso, sus actividades; en un cliente, sus
 * compromisos e interacciones. Una entidad que se apunta a sí misma no cuenta.
 */
export function entidadesHijas<E extends Entidad>(entidades: E[], clave: string): Array<EntidadHija<E>> {
  return entidades.flatMap((entidad) => entidad.key === clave
    ? []
    : (entidad.relationships ?? [])
        .filter((relacion) => relacion.type === "belongs_to" && relacion.target === clave)
        .map((relacion) => ({ entidad, relacion })));
}

/**
 * Qué mostrar de cada registro en la línea de tiempo: el título, la primera opción (el
 * tipo o el estado), la primera persona (quién), el primer texto largo (el detalle) y la
 * primera fecha propia, si no la de creación.
 */
export function camposDeLinea(entidad: { title_field: string; fields: Campo[] }) {
  const primero = (tipos: string[]) => entidad.fields.find((campo) => campo.key !== entidad.title_field && tipos.includes(campo.type))?.key ?? null;
  return {
    titulo: entidad.title_field,
    etiqueta: primero(["enum"]),
    persona: primero(["person"]),
    detalle: primero(["long_text"]),
    fecha: primero(["datetime", "date"]),
  };
}
