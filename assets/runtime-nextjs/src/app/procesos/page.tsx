import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireUser } from "@/lib/auth";
import { USER_SCOPES } from "@/platform/mcp/store";
import { familiasDeProcesos, motorDisponible } from "@/platform/processes/engine";

export const dynamic = "force-dynamic";

const fecha = (valor: unknown) => (valor ? new Date(String(valor)).toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : null);

/**
 * Lo que la organización sabe hacer. Cada tarjeta se lee de un vistazo: lo último que salió,
 * qué hace en una línea, con qué skill y cuántas veces se hizo. La guía completa, que está
 * escrita para la IA, no va acá.
 */
export default async function ProcesosPage() {
  const user = await requireUser();
  if (!motorDisponible() || !hasPermission(user, "proceso", "list")) notFound();
  const familias = await familiasDeProcesos({
    id: user.id,
    name: user.displayName,
    roleKey: user.roleKey,
    scopes: [...USER_SCOPES],
    kind: "user",
  });

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Procesos</p>
          <h1>Lo que sabemos hacer</h1>
          <p className="subtitle">Cada proceso es algo que ya salió bien: cómo se hace, y las veces que se hizo.</p>
        </div>
      </div>
      {familias.length === 0 ? (
        <div className="empty">
          Todavía no hay procesos. Cuando algo te quede bien, pedile a tu IA «registrá esto en Operaciones».
        </div>
      ) : (
        <div className="process-grid">
          {familias.map((familia) => (
            <Link className="process-card" href={`/procesos/${familia.familia}`} key={familia.familia}>
              <div className={`process-cover${familia.miniaturas.length ? "" : " empty-cover"}`}>
                {familia.miniaturas.length
                  ? familia.miniaturas.map((imagen) => (
                    // eslint-disable-next-line @next/next/no-img-element -- adjunto privado, servido con permisos
                    <img alt="" key={imagen.id} loading="lazy" src={`/attachments/${imagen.id}?ver=1`} />
                  ))
                  : <span>Sin piezas todavía</span>}
              </div>
              <div className="process-card-body">
                <h3 className="process-name">{familia.nombre}</h3>
                {familia.resumen && <p className="process-summary">{familia.resumen}</p>}
                <div className="process-meta">
                  {familia.skill
                    ? <span className="badge accent">skill{familia.skill.version ? ` v${familia.skill.version}` : ""}</span>
                    : <span className="badge">v{familia.version}</span>}
                  {familia.estado !== "publicado" && <span className="badge warn">{familia.estado}</span>}
                  <span>
                    {familia.iteraciones === 1 ? "1 iteración" : `${familia.iteraciones} iteraciones`}
                    {familia.ultima ? ` · ${fecha(familia.ultima)}` : ""}
                    {familia.en_curso ? ` · ${familia.en_curso} en curso` : ""}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
