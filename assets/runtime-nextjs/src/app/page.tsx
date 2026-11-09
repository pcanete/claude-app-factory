import { recordAccessForUser } from "@/lib/record-access";
import Link from "next/link";
import { canViewAudit, hasPermission, hasViewAccess, requireUser } from "@/lib/auth";
import { countRecords } from "@/lib/repository";
import { localPreviewAuthEnabled } from "@/lib/runtime-access";
import { getEntity, runtimeSpec } from "@/lib/spec";
import { USER_SCOPES } from "@/platform/mcp/store";
import { misPendientes, motorDisponible } from "@/platform/processes/engine";
import { comoSeguirEnElPanel } from "@/platform/processes/pending-text";

export const dynamic = "force-dynamic";

const ENTIDADES_DE_PROCESO = new Set(["proceso", "instancia", "evento"]);

/**
 * Por dónde empezar. Antes era un conteo de registros por entidad, que no decía qué hacer.
 * Ahora dice primero lo que la persona tiene pendiente, después dónde está cada cosa, y el
 * conteo queda al final para quien viene a cargar o buscar datos.
 */
export default async function HomePage() {
  const user = await requireUser();
  const access = recordAccessForUser(user);
  const motor = motorDisponible();
  const rol = runtimeSpec.roles.find((role) => role.key === user.roleKey)?.label ?? user.roleKey;
  const nombre = user.displayName.split(" ")[0] || user.displayName;

  const pendientes = motor && hasPermission(user, "instancia", "read")
    ? await misPendientes({ id: user.id, name: user.displayName, roleKey: user.roleKey, scopes: [...USER_SCOPES], kind: "user" })
    : null;

  const vistas = runtimeSpec.views
    .filter((view) => view.navigation && ["table", "kanban", "calendar", "dashboard"].includes(view.type))
    .filter((view) => hasViewAccess(user, view))
    .filter((view) => !(motor && view.entity && ENTIDADES_DE_PROCESO.has(view.entity)));
  const descripcion = (view: (typeof vistas)[number]) =>
    view.description ?? (view.entity ? getEntity(view.entity)?.description : undefined) ?? "";

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

      {pendientes && (
        <section className="work-section first">
          <h2>Tu trabajo</h2>
          <p className="subtitle">{comoSeguirEnElPanel(pendientes)}</p>
          <div className="grid">
            <article className="card">
              <div className="card-label">Para decidir</div>
              <div className="metric">{pendientes.para_revisar.length}</div>
              <div className="table-secondary">Elegir o aprobar: el caso no avanza hasta que decidas</div>
            </article>
            <article className="card">
              <div className="card-label">Para seguir</div>
              <div className="metric">{pendientes.para_seguir.length}</div>
              <div className="table-secondary">Tomados, esperando algo o devueltos</div>
            </article>
            <article className="card">
              <div className="card-label">Disponibles</div>
              <div className="metric">{pendientes.disponibles.length}</div>
              <div className="table-secondary">En la cola de etapas que podés tomar</div>
            </article>
          </div>
          <p><Link className="card-link" href="/pendientes">Ver mis pendientes →</Link></p>
        </section>
      )}

      {motor && canViewAudit(user) && (
        <section className="work-section">
          <h2>Cómo viene el trabajo</h2>
          <p className="subtitle">
            Cuánto tarda cada etapa, cuánto vuelve en la revisión y dónde se frena cada proceso.
          </p>
          <p><Link className="card-link" href="/trabajo">Abrir el tablero del trabajo →</Link></p>
        </section>
      )}

      {vistas.length > 0 && (
        <section className="work-section">
          <h2>Dónde está cada cosa</h2>
          <div className="grid">
            {vistas.map((view) => (
              <article className="card" key={view.key}>
                <div className="card-label">{view.label}</div>
                <p className="subtitle">{descripcion(view)}</p>
                <Link className="card-link" href={`/views/${view.key}`}>Abrir →</Link>
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
