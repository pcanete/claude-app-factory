import Link from "next/link";
import { notFound } from "next/navigation";
import { Opcion, Receta, Salidas } from "@/components/process-output";
import { canViewAudit, requireUser } from "@/lib/auth";
import { runtimeSpec } from "@/lib/spec";
import { USER_SCOPES } from "@/platform/mcp/store";
import { decisionesPendientes, misPendientes, motorDisponible } from "@/platform/processes/engine";
import { comoSeguirEnElPanel } from "@/platform/processes/pending-text";
import { decidirAction } from "./actions";

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
 * Lo que la persona tiene para hacer.
 *
 * Primero lo que sólo ella puede hacer: decidir. Cada decisión trae lo que dejó la etapa
 * —las opciones, las imágenes, el enlace— y se resuelve con un botón, sin abrir carpetas
 * ni saber de IA. Lo demás, el trabajo de las etapas, lo hace una IA conectada.
 */
export default async function PendientesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!motorDisponible()) notFound();
  const parametros = await searchParams;
  const aviso = typeof parametros.hecho === "string" ? parametros.hecho : null;
  const error = typeof parametros.error === "string" ? parametros.error : null;
  const persona = {
    id: user.id,
    name: user.displayName,
    roleKey: user.roleKey,
    scopes: [...USER_SCOPES],
    kind: "user" as const,
  };
  const [pendientes, decisiones] = await Promise.all([misPendientes(persona), decisionesPendientes(persona)]);

  const grupos: Array<{ clave: string; titulo: string; ayuda: string; casos: Resumen[] }> = [
    {
      clave: "seguir",
      titulo: "Para seguir",
      ayuda: "Los casos que tenés tomados, los que esperan algo y los que te devolvieron.",
      casos: pendientes.para_seguir as Resumen[],
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
  const trabajo = grupos.reduce((suma, grupo) => suma + grupo.casos.length, 0);
  const total = trabajo + decisiones.length + conProblemas.length;
  const ejemplo = grupos.flatMap((grupo) => grupo.casos)[0]?.titulo ?? "que elegiste";

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Mi trabajo</p>
          <h1>Mis pendientes</h1>
          <p className="subtitle">{comoSeguirEnElPanel(pendientes)}</p>
        </div>
      </div>

      {aviso && <div className="notice success">{aviso}</div>}
      {error && <div className="notice error">{error}</div>}

      {decisiones.length > 0 && (
        <section className="work-section first">
          <h2>Para decidir · {decisiones.length}</h2>
          <p className="subtitle">
            Trabajo que espera tu decisión. Mientras no decidas, ese caso no avanza.
          </p>
          {decisiones.map((decision) => (
            <form action={decidirAction} className="decision" id={decision.caso} key={decision.caso}>
              <input name="caso" type="hidden" value={decision.caso} />
              <div className="decision-head">
                <div>
                  <div className="card-label">{decision.proceso} · {decision.etapa}</div>
                  <h3>{decision.titulo}</h3>
                </div>
                <Link className="record-link" href={`/records/instancia/${decision.caso}`}>Ver el caso</Link>
              </div>
              {decision.resumen && <p className="decision-summary">{decision.resumen}</p>}

              {decision.juzgar.length > 0 && (
                <div className="decision-judge">
                  <div className="card-label">Lo que te toca juzgar</div>
                  <ul>{decision.juzgar.map((texto) => <li key={texto}>{texto}</li>)}</ul>
                </div>
              )}

              {decision.opciones ? (
                <div className="decision-options">
                  {decision.opciones.map((opcion, indice) => (
                    <div className="decision-option" key={indice}>
                      <div className="card-label">Opción {indice + 1}</div>
                      <Opcion valor={opcion} />
                      <button className="button" name="accion" type="submit" value={`elegir:${indice + 1}`}>
                        Elegir esta
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <Salidas salidas={decision.salidas} />
              {decision.receta && (
                <details className="iteration-recipe">
                  <summary>Cómo se hizo{typeof decision.receta.modelo === "string" ? ` · ${decision.receta.modelo}` : ""}</summary>
                  <Receta receta={decision.receta} />
                </details>
              )}
              {decision.enlace && (
                <p><a className="record-link" href={decision.enlace} rel="noreferrer" target="_blank">Abrir el resultado completo</a></p>
              )}

              <label className="decision-comment">
                <span>
                  {decision.opciones ? "Ajustes a la opción que elijas" : "Comentario"}
                  {" "}
                  <span className="table-secondary">(obligatorio para devolver)</span>
                </span>
                <textarea
                  maxLength={2000}
                  name="motivo"
                  placeholder={decision.opciones
                    ? "Por ejemplo: la luz, de mañana temprano. Viaja con la opción a la etapa siguiente."
                    : "Qué cambiar, o una nota para quien sigue"}
                  rows={2}
                />
              </label>
              <div className="decision-actions">
                {!decision.opciones && (
                  <button className="button" name="accion" type="submit" value="aprobar">Aprobar</button>
                )}
                <button className="button secondary" name="accion" type="submit" value="devolver">Devolver</button>
              </div>
            </form>
          ))}
        </section>
      )}

      {conProblemas.length > 0 && (
        <section className="work-section">
          <h2>Con problemas · {conProblemas.length}</h2>
          <p className="subtitle">
            Casos trabados porque la definición de su proceso tiene errores: nadie puede tomarlos ni
            revisarlos hasta corregirla. Pedile a tu IA que la valide y publique una versión nueva.
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

      {trabajo > 0 && (
        <div className="notice">
          Para tomar un caso, trabajarlo o cerrarlo, pedíselo a la IA que conectaste a «{runtimeSpec.app.name}»,
          por ejemplo: «tomá el caso {ejemplo} y seguí la guía». Ella recibe las instrucciones de cada etapa.
          {" "}
          {canViewAudit(user)
            ? <>Si todavía no la conectaste, en <Link className="record-link" href="/agents">Agentes</Link> está cómo.</>
            : "Si todavía no la conectaste, pedile a quien administra la aplicación que te arme la conexión."}
        </div>
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
