import Link from "next/link";
import { notFound } from "next/navigation";
import { canViewAudit, requireUser } from "@/lib/auth";
import { runtimeSpec } from "@/lib/spec";
import { USER_SCOPES } from "@/platform/mcp/store";
import { misPendientes, motorDisponible } from "@/platform/processes/engine";
import { comoSeguirEnElPanel } from "@/platform/processes/pending-text";

export const dynamic = "force-dynamic";

type Resumen = { caso: string; titulo: string; proceso: string; etapa: string; estado: string; actualizado: unknown };

const ESTADOS: Record<string, string> = {
  en_cola: "En cola",
  tomada: "Tomado",
  esperando: "Esperando",
  en_revision: "En revisión",
  devuelta: "Devuelto",
};

/**
 * Lo que la persona tiene para hacer: la misma respuesta que `mis_pendientes` le da a su IA.
 *
 * Por ahora se mira y se trabaja desde la IA conectada; operar un caso desde acá, para quien
 * no usa IA, es la pieza que sigue.
 */
export default async function PendientesPage() {
  const user = await requireUser();
  if (!motorDisponible()) notFound();
  const pendientes = await misPendientes({
    id: user.id,
    name: user.displayName,
    roleKey: user.roleKey,
    scopes: [...USER_SCOPES],
    kind: "user",
  });
  const grupos: Array<{ clave: string; titulo: string; ayuda: string; casos: Resumen[] }> = [
    {
      clave: "seguir",
      titulo: "Para seguir",
      ayuda: "Los casos que tenés tomados, los que esperan algo y los que te devolvieron. Empezá por acá.",
      casos: pendientes.para_seguir as Resumen[],
    },
    {
      clave: "revisar",
      titulo: "Para revisar",
      ayuda: "Trabajo de otras personas que espera tu aprobación. Mientras no lo revises, ese caso no avanza.",
      casos: pendientes.para_revisar as Resumen[],
    },
    {
      clave: "disponibles",
      titulo: "Disponibles",
      ayuda: "Casos en la cola de una etapa que tu rol puede tomar.",
      casos: pendientes.disponibles as Resumen[],
    },
  ];
  // Sólo le llegan a quien administra: casos cuyo proceso tiene una definición con errores.
  // Nadie puede tomarlos hasta que se corrija, así que no pueden quedar fuera de la vista.
  const conProblemas = ("con_problemas" in pendientes ? pendientes.con_problemas : []) as Array<{ caso: string; titulo: string; problema: string }>;
  const total = grupos.reduce((suma, grupo) => suma + grupo.casos.length, 0) + conProblemas.length;

  const comoSeguir = comoSeguirEnElPanel(pendientes);
  const ejemplo = grupos.flatMap((grupo) => grupo.casos)[0]?.titulo ?? "que elegiste";

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Mi trabajo</p>
          <h1>Mis pendientes</h1>
          <p className="subtitle">
            {comoSeguir}
          </p>
        </div>
      </div>

      <div className="notice">
        Para tomar un caso, trabajarlo o cerrarlo, pedíselo a la IA que conectaste a «{runtimeSpec.app.name}»,
        por ejemplo: «tomá el caso {ejemplo} y seguí la guía». Ella recibe las instrucciones de cada etapa.
        {" "}
        {canViewAudit(user)
          ? <>Si todavía no la conectaste, en <Link className="record-link" href="/agents">Agentes</Link> está cómo.</>
          : "Si todavía no la conectaste, pedile a quien administra la aplicación que te arme la conexión."}
      </div>

      {conProblemas.length > 0 && (
        <section className="work-section">
          <h2>Con problemas · {conProblemas.length}</h2>
          <p className="subtitle">
            Casos trabados porque la definición de su proceso tiene errores: nadie puede tomarlos ni
            revisarlos hasta corregirla. Validala con validar_proceso y publicá una versión nueva.
          </p>
          <div className="table-wrap">
            <table className="audit-table">
              <thead><tr><th>Caso</th><th>Problema</th></tr></thead>
              <tbody>
                {conProblemas.map((caso) => (
                  <tr key={caso.caso}>
                    <td data-label="Caso"><Link className="record-link" href={`/records/instancia/${caso.caso}`}>{caso.titulo}</Link></td>
                    <td data-label="Problema">{caso.problema}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {total === 0 ? (
        <div className="empty">No tenés nada pendiente ahora.</div>
      ) : grupos.filter((grupo) => grupo.casos.length).map((grupo) => (
        <section className="work-section" key={grupo.clave}>
          <h2>{grupo.titulo} · {grupo.casos.length}</h2>
          <p className="subtitle">{grupo.ayuda}</p>
          <div className="table-wrap">
            <table className="audit-table">
              <thead><tr><th>Caso</th><th>Proceso</th><th>Etapa</th><th>Estado</th></tr></thead>
              <tbody>
                {grupo.casos.map((caso) => (
                  <tr key={caso.caso}>
                    <td data-label="Caso"><Link className="record-link" href={`/records/instancia/${caso.caso}`}>{caso.titulo}</Link></td>
                    <td data-label="Proceso">{caso.proceso}</td>
                    <td data-label="Etapa">{caso.etapa}</td>
                    <td data-label="Estado">{ESTADOS[caso.estado] ?? caso.estado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
