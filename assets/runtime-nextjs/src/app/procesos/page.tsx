import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireUser } from "@/lib/auth";
import { USER_SCOPES } from "@/platform/mcp/store";
import { familiasDeProcesos, motorDisponible } from "@/platform/processes/engine";

export const dynamic = "force-dynamic";

const fecha = (valor: unknown) => (valor ? new Date(String(valor)).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" }) : null);

/**
 * Lo que la organización sabe hacer: cada proceso con su versión vigente y cuántas veces
 * se hizo. Es la memoria del método: lo que salió bien queda acá, con cómo se hizo.
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
          <p className="subtitle">
            Cada proceso es cómo se hace algo que ya salió bien, y sus iteraciones son las veces que se hizo.
            Para sumar uno, pedile a tu IA «registrá esto en Operaciones» al terminar algo que te quedó bien.
          </p>
        </div>
      </div>
      {familias.length === 0 ? (
        <div className="empty">Todavía no hay procesos registrados.</div>
      ) : (
        <div className="grid">
          {familias.map((familia) => (
            <article className="card" key={familia.familia}>
              <div className="card-label">v{familia.version}{familia.estado !== "publicado" ? ` · ${familia.estado}` : ""}</div>
              <h3 className="process-name">{familia.nombre}</h3>
              {familia.proposito && <p className="subtitle process-purpose">{familia.proposito}</p>}
              <div className="table-secondary">
                {familia.iteraciones === 1 ? "1 iteración" : `${familia.iteraciones} iteraciones`}
                {familia.ultima ? ` · la última, ${fecha(familia.ultima)}` : ""}
              </div>
              <Link className="card-link" href={`/procesos/${familia.familia}`}>Ver iteraciones →</Link>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
