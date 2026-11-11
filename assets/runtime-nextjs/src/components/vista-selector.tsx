import Link from "next/link";

/**
 * Elegir cómo se ve un listado (tarjetas o lista) sin perder los filtros: es un enlace que
 * cambia sólo `vista` en la dirección.
 */
export function VistaSelector({ base, consulta, actual, opciones }: {
  base: string;
  consulta: Record<string, string | undefined>;
  actual: string;
  opciones: Array<{ valor: string; etiqueta: string }>;
}) {
  const enlace = (vista: string) => {
    const params = new URLSearchParams();
    for (const [clave, valor] of Object.entries(consulta)) if (valor && clave !== "vista" && clave !== "hecho" && clave !== "error") params.set(clave, valor);
    params.set("vista", vista);
    return `${base}?${params.toString()}`;
  };
  return (
    <div className="view-switch" role="group" aria-label="Cómo se ve">
      {opciones.map((opcion) => (
        <Link
          aria-current={opcion.valor === actual ? "true" : undefined}
          className={opcion.valor === actual ? "active" : undefined}
          href={enlace(opcion.valor)}
          key={opcion.valor}
        >
          {opcion.etiqueta}
        </Link>
      ))}
    </div>
  );
}
