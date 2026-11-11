import Link from "next/link";
import { notFound } from "next/navigation";
import { Copiar } from "@/components/copiar";
import { Receta } from "@/components/process-output";
import { SubirLaminas } from "@/components/subir-laminas";
import { cancelarCasoAction } from "../actions";
import { canViewAudit, hasPermission, requireUser } from "@/lib/auth";
import { USER_SCOPES } from "@/platform/mcp/store";
import { tableroDeProceso } from "@/platform/processes/dashboard";
import { comoSeHace, iteracionesDeProceso, motorDisponible } from "@/platform/processes/engine";

export const dynamic = "force-dynamic";

const fecha = (valor: unknown) => (valor
  ? new Date(String(valor)).toLocaleDateString("es-AR", { day: "numeric", month: "short" })
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

const horas = (valor: number | null) => {
  if (valor === null) return "—";
  if (valor < 24) return `${Math.round(valor)} h`;
  return `${Math.round(valor / 24)} días`;
};

/**
 * Todo lo de un proceso en un solo lugar: cómo se hace, los casos que están en curso, las
 * veces que se hizo y, para quien administra, cómo rinde y su definición. Antes eran cuatro
 * entradas del menú —casos en curso, bitácora, definiciones, tablero— que mostraban cómo
 * está guardado el trabajo y no lo que alguien viene a hacer.
 */
export default async function ProcesoPage({
  params,
  searchParams,
}: {
  params: Promise<{ familia: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!motorDisponible() || !hasPermission(user, "proceso", "list")) notFound();
  const { familia } = await params;
  const consulta = await searchParams;
  const aviso = typeof consulta.hecho === "string" ? consulta.hecho : null;
  const fallo = typeof consulta.error === "string" ? consulta.error : null;
  const persona = { id: user.id, name: user.displayName, roleKey: user.roleKey, scopes: [...USER_SCOPES], kind: "user" as const };

  let datos: Awaited<ReturnType<typeof iteracionesDeProceso>>;
  try {
    datos = await iteracionesDeProceso(persona, familia);
  } catch {
    notFound();
  }
  const guia = await comoSeHace(persona, familia).catch(() => null);
  const administra = canViewAudit(user);
  const rendimiento = administra ? await tableroDeProceso(String(datos.vigente.id)).catch(() => null) : null;
  const ficha = datos.ficha;
  const pedido = ficha?.pedido_ejemplo ?? `Hacé ${datos.nombre}`;
  const reproducciones = datos.iteraciones.filter((it) => it.origen === "reproduccion");
  const fallidas = reproducciones.filter((it) => it.reproduccion?.salio_igual === false).length;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow"><Link className="record-link" href="/procesos">Procesos</Link></p>
          <h1>{datos.nombre}</h1>
          {datos.resumen && <p className="subtitle">{datos.resumen}</p>}
        </div>
      </div>

      {aviso && <div className="notice success">{aviso}</div>}
      {fallo && <div className="notice error">{fallo}</div>}

      <section className="process-sheet" aria-label="Cómo lo hace el equipo">
        <div className="sheet-grid">
          <div className="sheet-item">
            <div className="card-label">Cómo se hace</div>
            {ficha?.skill ? (
              <>
                <div className="sheet-value">skill {ficha.skill.nombre}{ficha.skill.version ? ` v${ficha.skill.version}` : ""}</div>
                {ficha.skill.repo && <a className="record-link" href={ficha.skill.repo} rel="noreferrer" target="_blank">Ver en GitHub</a>}
              </>
            ) : (
              <div className="sheet-value">Guía del proceso, versión {datos.vigente.version}</div>
            )}
          </div>
          {ficha?.entrada && (
            <div className="sheet-item">
              <div className="card-label">Qué hay que darle</div>
              <div className="sheet-value">{ficha.entrada}</div>
            </div>
          )}
          {ficha?.entrega && (
            <div className="sheet-item">
              <div className="card-label">Qué entrega</div>
              <div className="sheet-value">{ficha.entrega}</div>
            </div>
          )}
          {ficha?.necesita?.length ? (
            <div className="sheet-item">
              <div className="card-label">Necesita</div>
              <div className="sheet-value">{ficha.necesita.join(", ")}</div>
            </div>
          ) : null}
        </div>
        <div className="sheet-ask">
          <span><span className="table-secondary">Pedíselo a tu IA:</span> <code>{pedido}</code></span>
          <Copiar texto={pedido} />
        </div>
        <p className="sheet-foot">
          {datos.saben.length > 0 && <>Lo {datos.saben.length === 1 ? "sabe" : "saben"} hacer: {datos.saben.join(", ")} · </>}
          versión {datos.vigente.version}{datos.vigente.estado !== "publicado" ? ` (${String(datos.vigente.estado)})` : ""}
          {datos.versiones.length > 1 ? ` de ${datos.versiones.length}` : ""}
          {reproducciones.length
            ? ` · ${reproducciones.length === 1 ? "1 reproducción" : `${reproducciones.length} reproducciones`}${fallidas ? `, ${fallidas} sin salir igual` : ""}`
            : ""}
        </p>
        {guia && (
          <details className="process-guide">
            <summary>Leer la guía completa</summary>
            <pre>{guia.guia}</pre>
          </details>
        )}
      </section>

      {datos.en_curso.length > 0 && (
        <section className="work-section">
          <h2>En curso · {datos.en_curso.length}</h2>
          <ul className="case-list">
            {datos.en_curso.map((caso) => (
              <li key={caso.caso}>
                <Link className="record-link" href={`/records/instancia/${caso.caso}`}>{caso.titulo}</Link>
                <span className="table-secondary">
                  Etapa {caso.etapa} · {caso.estado}{caso.quien ? ` · lo tiene ${caso.quien}` : ""}
                </span>
                {administra && (
                  <details className="case-cancel">
                    <summary>Cancelar</summary>
                    <form action={cancelarCasoAction}>
                      <input name="caso" type="hidden" value={caso.caso} />
                      <input name="familia" type="hidden" value={familia} />
                      <input className="control" maxLength={1000} name="motivo" placeholder="Por qué ya no se hace" required />
                      <button className="button danger" type="submit">Cancelar el caso</button>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="work-section">
        <h2>Iteraciones{datos.iteraciones.length ? ` · ${datos.iteraciones.length}` : ""}</h2>
        {datos.iteraciones.length === 0 && (
          <div className="empty compact">Todavía no se registró ninguna. Al terminar una pieza, pedile a tu IA «registrá esto en Operaciones».</div>
        )}
        <div className="iteration-grid">
          {datos.iteraciones.map((it) => (
            <article className="iteration" key={it.iteracion}>
              <div className={`process-cover${it.imagenes.length ? "" : " empty-cover"}`}>
                {it.imagenes.length
                  ? it.imagenes.slice(0, 3).map((imagen) => (
                    // eslint-disable-next-line @next/next/no-img-element -- adjunto privado, servido con permisos
                    <img alt="" key={imagen.id} loading="lazy" src={`/attachments/${imagen.id}?ver=1`} />
                  ))
                  : <span>Sin imágenes</span>}
              </div>
              <div className="iteration-body">
                <h3>{it.titulo}</h3>
                <div className="process-meta">
                  <span>
                    {fecha(it.fecha)}{it.quien ? ` · ${it.quien}` : ""}
                    {it.skill ? ` · ${it.skill}` : ` · v${it.version}`}
                    {it.imagenes.length ? ` · ${it.imagenes.length} ${it.imagenes.length === 1 ? "imagen" : "imágenes"}` : ""}
                  </span>
                  {it.origen === "reproduccion" && <Origen origen={it.origen} reproduccion={it.reproduccion} />}
                  {it.estado === "en_revision" && <span className="badge warn">Para aprobar</span>}
                </div>
                {it.reproduccion && !it.reproduccion.salio_igual && it.reproduccion.que_falto && (
                  <p className="iteration-missing">Qué faltó: {it.reproduccion.que_falto}</p>
                )}
                <div className="iteration-links">
                  {it.resultado && <a className="record-link" href={it.resultado} rel="noreferrer" target="_blank">Carpeta</a>}
                  {it.conversacion && <a className="record-link" href={it.conversacion} rel="noreferrer" target="_blank">Conversación</a>}
                  {administra && <Link className="record-link" href={`/records/instancia/${it.iteracion}`}>Registro</Link>}
                </div>
                <details className="iteration-recipe">
                  <summary>
                    {it.imagenes.length > 3 ? `Ver las ${it.imagenes.length} imágenes y cómo se hizo` : "Ver cómo se hizo"}
                  </summary>
                  {it.imagenes.length > 0 && (
                    <div className="iteration-gallery">
                      {it.imagenes.map((imagen) => (
                        <a href={`/attachments/${imagen.id}?ver=1`} key={imagen.id} rel="noreferrer" target="_blank" title={imagen.nombre}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- adjunto privado, servido con permisos */}
                          <img alt={imagen.nombre} loading="lazy" src={`/attachments/${imagen.id}?ver=1`} />
                        </a>
                      ))}
                    </div>
                  )}
                  {it.receta && <Receta receta={it.receta} />}
                  {(administra || it.persona === user.id) && it.imagenes.length < 20 && <SubirLaminas caso={it.iteracion} />}
                </details>
              </div>
            </article>
          ))}
        </div>
      </section>

      {administra && (
        <section className="work-section">
          <h2>Cómo rinde</h2>
          {rendimiento && rendimiento.tablero.casos > 0 ? (
            <>
              <div className="grid">
                <article className="card">
                  <div className="card-label">Casos</div>
                  <div className="metric">{rendimiento.tablero.casos}</div>
                  <div className="table-secondary">{rendimiento.tablero.entregados} entregados, en los últimos {rendimiento.dias} días</div>
                </article>
                <article className="card">
                  <div className="card-label">De punta a punta</div>
                  <div className="metric">{horas(rendimiento.tablero.ciclo.mediana_horas)}</div>
                  <div className="table-secondary">la mitad de los casos tarda menos que esto</div>
                </article>
                <article className="card">
                  <div className="card-label">Dónde se traba</div>
                  <div className="metric small">{rendimiento.tablero.traba ? rendimiento.tablero.traba.nombre : "—"}</div>
                  <div className="table-secondary">{rendimiento.tablero.traba ? `por ${rendimiento.tablero.traba.motivo}` : "Todavía no hay datos"}</div>
                </article>
              </div>
              <p className="iteration-links">
                <Link className="record-link" href={`/trabajo?proceso=${String(datos.vigente.id)}`}>Ver el detalle por etapa y por persona</Link>
              </p>
            </>
          ) : (
            <div className="empty compact">Todavía no hay casos de la versión vigente para medir.</div>
          )}
          <p className="iteration-links">
            <Link className="record-link" href={`/records/proceso/${String(datos.vigente.id)}`}>Ver la definición de la versión {datos.vigente.version}</Link>
          </p>
        </section>
      )}
    </>
  );
}
