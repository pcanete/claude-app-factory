import { recordAccessForUser } from "@/lib/record-access";
import Link from "next/link";
import { hasPermission, hasViewAccess, requireUser } from "@/lib/auth";
import { countRecords } from "@/lib/repository";
import { localPreviewAuthEnabled } from "@/lib/runtime-access";
import { getEntity, runtimeSpec } from "@/lib/spec";
import { agruparVistas } from "@/lib/view-groups";
import { motorDisponible } from "@/platform/processes/engine";

export const dynamic = "force-dynamic";

const ENTIDADES_DE_PROCESO = new Set(["proceso", "iteracion"]);

/**
 * Por dónde empezar: los procesos, si la aplicación los tiene, después dónde está cada cosa,
 * y el conteo al final para quien viene a cargar o buscar datos.
 */
export default async function HomePage() {
  const user = await requireUser();
  const access = recordAccessForUser(user);
  const motor = motorDisponible();
  const rol = runtimeSpec.roles.find((role) => role.key === user.roleKey)?.label ?? user.roleKey;
  const nombre = user.displayName.split(" ")[0] || user.displayName;

  const vistas = runtimeSpec.views
    .filter((view) => view.navigation && ["table", "kanban", "calendar", "dashboard"].includes(view.type))
    .filter((view) => hasViewAccess(user, view))
    .filter((view) => !(motor && view.entity && ENTIDADES_DE_PROCESO.has(view.entity)));
  const descripcion = (view: (typeof vistas)[number]) =>
    view.description ?? (view.entity ? getEntity(view.entity)?.description : undefined) ?? "";
  const grupos = agruparVistas(vistas, (clave) => getEntity(clave)?.label_plural).map((grupo) => {
    const primera = vistas.find((view) => view.key === grupo.vistas[0].key)!;
    return {
      ...grupo,
      descripcion: grupo.entity ? getEntity(grupo.entity)?.description ?? descripcion(primera) : descripcion(primera),
    };
  });

  const visibles = runtimeSpec.entities
    .filter((entity) => hasPermission(user, entity.key, "list"))
    .filter((entity) => !(motor && ENTIDADES_DE_PROCESO.has(entity.key)));
  const counts = await Promise.all(
    visibles.map(async (entity) => ({ entity, count: await countRecords(entity.key, access) })),
  );

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Por dónde empezar · {rol}</p>
          <h1>Hola, {nombre}</h1>
          <p className="subtitle">{runtimeSpec.app.description}</p>
        </div>
      </div>
      {localPreviewAuthEnabled() && (
        <div className="notice">
          Sesión local de desarrollo con el rol {rol}. Esta vía queda bloqueada automáticamente en producción.
        </div>
      )}

      {motor && hasPermission(user, "proceso", "list") && (
        <section className="work-section first">
          <h2>Procesos</h2>
          <p className="subtitle">
            Lo que sabemos hacer: cada proceso con lo que necesita, cómo se hace y las veces que se hizo.
          </p>
          <p><Link className="card-link" href="/procesos">Ver los procesos →</Link></p>
        </section>
      )}

      {grupos.length > 0 && (
        <section className="work-section">
          <h2>Dónde está cada cosa</h2>
          <div className="grid">
            {grupos.map((grupo) => (
              <article className="card" key={grupo.key}>
                <div className="card-label">{grupo.label}</div>
                <p className="subtitle">{grupo.descripcion}</p>
                {grupo.vistas.length > 1 && (
                  <p className="table-secondary">{grupo.vistas.map((vista) => vista.label).join(" · ")}</p>
                )}
                <Link className="card-link" href={grupo.href}>Abrir →</Link>
              </article>
            ))}
          </div>
        </section>
      )}

      {counts.length > 0 && (
        <section className="work-section" aria-label="Datos">
          <h2>Datos</h2>
          <p className="subtitle">Para cargar, buscar o exportar registros.</p>
          <div className="grid">
            {counts.map(({ entity, count }) => (
              <article className="card" key={entity.key}>
                <div className="card-label">{entity.label_plural}</div>
                <div className="metric">{count}</div>
                <Link className="card-link" href={`/records/${entity.key}`}>Abrir →</Link>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
