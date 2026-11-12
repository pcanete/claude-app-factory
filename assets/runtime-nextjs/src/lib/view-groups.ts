/**
 * Agrupa las vistas del menú por lo que muestran.
 *
 * Una tabla, un calendario y un kanban de los mismos compromisos son tres formas de ver una
 * sola cosa. Listados como tres entradas del menú, con tres nombres («Compromisos»,
 * «Agenda», «Tablero»), parecen tres cosas distintas. Agrupadas, son una entrada —el nombre
 * de la entidad— con tres pestañas.
 *
 * Sin dependencias a propósito: `scripts/test-view-groups.mjs` prueba este mismo archivo.
 */

export type VistaParaAgrupar = { key: string; label: string; type: string; entity?: string };

export type PestanaDeVista = { key: string; label: string; href: string; type: string };

export type GrupoDeVistas = {
  /** `entidad:<clave>` o `vista:<clave>` para las que no son de una entidad. */
  key: string;
  label: string;
  /** Adónde lleva la entrada del menú: la primera pestaña. */
  href: string;
  entity?: string;
  vistas: PestanaDeVista[];
};

/**
 * Una entrada por entidad, en el orden en que aparece su primera vista; una entrada por
 * cada vista que no es de una entidad (un panorama, por ejemplo).
 *
 * Dentro de cada entidad la tabla va primero y se llama «Lista»: es la forma base de ver
 * los datos, y el nombre de la entidad ya está en la entrada. El resto conserva su nombre y
 * el orden de la AppSpec.
 */
export function agruparVistas(vistas: readonly VistaParaAgrupar[], etiquetaDeEntidad: (clave: string) => string | undefined): GrupoDeVistas[] {
  const grupos: GrupoDeVistas[] = [];
  const porEntidad = new Map<string, GrupoDeVistas>();
  for (const vista of vistas) {
    if (!vista.entity) {
      const pestana = { key: vista.key, label: vista.label, href: `/views/${vista.key}`, type: vista.type };
      grupos.push({ key: `vista:${vista.key}`, label: vista.label, href: pestana.href, vistas: [pestana] });
      continue;
    }
    let grupo = porEntidad.get(vista.entity);
    if (!grupo) {
      grupo = { key: `entidad:${vista.entity}`, label: etiquetaDeEntidad(vista.entity) ?? vista.label, href: "", entity: vista.entity, vistas: [] };
      porEntidad.set(vista.entity, grupo);
      grupos.push(grupo);
    }
    grupo.vistas.push({ key: vista.key, label: vista.label, href: `/views/${vista.key}`, type: vista.type });
  }
  for (const grupo of porEntidad.values()) {
    const tabla = grupo.vistas.findIndex((v) => v.type === "table");
    if (tabla > 0) grupo.vistas.unshift(...grupo.vistas.splice(tabla, 1));
    if (tabla >= 0) grupo.vistas[0] = { ...grupo.vistas[0], label: "Lista" };
    grupo.href = grupo.vistas[0].href;
  }
  return grupos;
}

/** El grupo al que pertenece una vista, para mostrar sus pestañas hermanas. */
export function grupoDeVista(grupos: readonly GrupoDeVistas[], claveDeVista: string) {
  return grupos.find((grupo) => grupo.vistas.some((vista) => vista.key === claveDeVista)) ?? null;
}
