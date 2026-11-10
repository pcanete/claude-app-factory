import Link from "next/link";
import { notFound } from "next/navigation";
import { Receta } from "@/components/process-output";
import { hasPermission, requireUser } from "@/lib/auth";
import { USER_SCOPES } from "@/platform/mcp/store";
import { comoSeHace, iteracionesDeProceso, motorDisponible } from "@/platform/processes/engine";

export const dynamic = "force-dynamic";

const fecha = (valor: unknown) => (valor
  ? new Date(String(valor)).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "");

function Origen({ origen, reproduccion }: { origen: string; reproduccion: { salio_igual: boolean; que_falto?: string } | null }) {
  if (origen === "reproduccion" && reproduccion) {
    return reproduccion.salio_igual
      ? <span className="badge ok">Reproducción · salió igual</span>
      : <span className="badge warn">Reproducción · no salió igual</span>;
  }
  if (origen === "descubrimiento") return <span className="badge">Así se hizo</span>;
  return <span className="badge">Caso</span>;
}

/**
 * Un proceso y sus iteraciones: la versión vigente arriba, y abajo cada vez que se hizo,
 * con el resultado, la conversación donde se hizo y la receta. Las reproducciones que no
 * salieron igual dicen qué faltó: es lo que mejora la versión siguiente.
 */
export default async function ProcesoPage({ params }: { params: Promise<{ familia: string }> }) {
  const user = await requireUser();
  if (!motorDisponible() || !hasPermission(user, "proceso", "list")) notFound();
  const { familia } = await params;
  const persona = { id: user.id, name: user.displayName, roleKey: user.roleKey, scopes: [...USER_SCOPES], kind: "user" as const };

  let datos: Awaited<ReturnType<typeof iteracionesDeProceso>>;
  try {
    datos = await iteracionesDeProceso(persona, familia);
  } catch {
    notFound();
  }
  const guia = await comoSeHace(persona, familia).catch(() => null);
  const reproducciones = datos.iteraciones.filter((it) => it.origen === "reproduccion");
  const fallidas = reproducciones.filter((it) => it.reproduccion?.salio_igual === false).length;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow"><Link className="record-link" href="/procesos">Procesos</Link> · v{datos.vigente.version}{datos.vigente.estado !== "publicado" ? ` · ${String(datos.vigente.estado)}` : ""}</p>
          <h1>{datos.nombre}</h1>
          <p className="subtitle">
            {datos.iteraciones.length === 1 ? "1 iteración" : `${datos.iteraciones.length} iteraciones`}
            {reproducciones.length
              ? ` · ${reproducciones.length === 1 ? "1 reproducción" : `${reproducciones.length} reproducciones`}${fallidas ? `, ${fallidas} sin salir igual` : ", todas salieron igual"}`
              : ""}
            {datos.versiones.length > 1 ? ` · ${datos.versiones.length} versiones` : ""}
          </p>
        </div>
      </div>

      <div className="notice">
        Para hacerlo desde cualquier IA conectada a esta aplicación, pedile «hacé {datos.nombre}»: recibe esta receta.
        Para mejorarlo: «mirá las iteraciones de {datos.nombre} y proponé la versión siguiente».
      </div>

      {guia && (
        <details className="process-guide">
          <summary>Cómo se hace · versión {guia.version}</summary>
          <pre>{guia.guia}</pre>
        </details>
      )}

      <section className="work-section">
        <h2>Iteraciones</h2>
        {datos.iteraciones.length === 0 && <div className="empty compact">Todavía no se registró ninguna.</div>}
        {datos.iteraciones.map((it) => (
          <article className="iteration" key={it.iteracion}>
            <div className="decision-head">
              <div>
                <div className="card-label">v{it.version} · {fecha(it.fecha)}{it.quien ? ` · ${it.quien}` : ""}</div>
                <h3>{it.titulo}</h3>
              </div>
              <div className="iteration-badges">
                <Origen origen={it.origen} reproduccion={it.reproduccion} />
                {it.estado === "en_revision" && <span className="badge warn">Para aprobar</span>}
              </div>
            </div>
            {it.reproduccion && !it.reproduccion.salio_igual && it.reproduccion.que_falto && (
              <p className="iteration-missing">Qué faltó: {it.reproduccion.que_falto}</p>
            )}
            <div className="iteration-links">
              {it.resultado && <a className="record-link" href={it.resultado} rel="noreferrer" target="_blank">Resultado</a>}
              {it.conversacion
                ? <a className="record-link" href={it.conversacion} rel="noreferrer" target="_blank">Conversación</a>
                : <span className="table-secondary">Sin conversación registrada</span>}
              <Link className="record-link" href={`/records/instancia/${it.iteracion}`}>Ver el caso</Link>
            </div>
            {it.receta && (
              <details className="iteration-recipe">
                <summary>Cómo se hizo{typeof it.receta.modelo === "string" ? ` · ${it.receta.modelo}` : ""}</summary>
                <Receta receta={it.receta} />
              </details>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
