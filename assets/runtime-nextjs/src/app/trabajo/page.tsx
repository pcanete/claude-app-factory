import Link from "next/link";
import { requireAuditAccess } from "@/lib/auth";
import { DIAS_POR_DEFECTO, listarProcesos, tableroDeProceso } from "@/platform/processes/dashboard";
import type { Tiempos } from "@/platform/processes/metrics";

export const dynamic = "force-dynamic";

/**
 * El tablero del trabajo: cómo rinde cada proceso, según la bitácora.
 *
 * Es la misma medición que devuelve `tablero_de_trabajo` por MCP: la pantalla es para quien
 * prefiere mirarla, no una fuente distinta. La ve quien ve toda la actividad.
 */
const PERIODOS = [30, 90, 180, 365];
const ESTADOS: Record<string, string> = {
  en_cola: "en cola",
  tomada: "tomados",
  esperando: "esperando",
  en_revision: "en revisión",
  devuelta: "devueltos",
};
const MOTIVOS: Record<string, string> = { esperando: "Espera", devuelta: "Devolución", liberada: "Liberación" };
const TRABAS: Record<string, string> = { esperas: "esperas", devoluciones: "devoluciones", liberaciones: "liberaciones" };

function horas(valor: number | null) {
  if (valor === null) return "—";
  if (valor < 1) return `${Math.round(valor * 60)} min`;
  if (valor < 48) return `${valor.toLocaleString("es-AR")} h`;
  return `${(Math.round((valor / 24) * 10) / 10).toLocaleString("es-AR")} d`;
}

function tiempo(t: Tiempos) {
  if (!t.casos) return <span className="table-secondary">—</span>;
  return (
    <>
      <div>{horas(t.mediana_horas)}</div>
      <div className="table-secondary">p90 {horas(t.p90_horas)} · {t.casos}</div>
    </>
  );
}

function porcentaje(valor: number | null) {
  return valor === null ? "—" : `${Math.round(valor * 100)} %`;
}

export default async function TrabajoPage({
  searchParams,
}: {
  searchParams: Promise<{ proceso?: string; dias?: string }>;
}) {
  await requireAuditAccess();
  const requested = await searchParams;
  const procesos = await listarProcesos();
  const dias = PERIODOS.includes(Number(requested.dias)) ? Number(requested.dias) : DIAS_POR_DEFECTO;
  const elegido = procesos.find((proceso) => proceso.id === requested.proceso)
    ?? procesos.find((proceso) => proceso.estado === "publicado")
    ?? procesos[0];
  const detalle = elegido ? await tableroDeProceso(elegido.id, dias) : null;
  const tablero = detalle?.tablero;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Control interno</p>
          <h1>Trabajo</h1>
          <p className="subtitle">
            Cómo rinde cada proceso, según lo que quedó en la bitácora: cuánto tarda cada etapa,
            cuánto vuelve, qué IA se usó y dónde se frena. Sirve para decidir qué cambiar en la
            próxima versión del proceso. No muestra conversaciones: sólo lo que se registró.
          </p>
        </div>
      </div>

      {!procesos.length ? (
        <div className="empty">
          Todavía no hay procesos. El tablero se arma con los casos que pasan por el motor de procesos.
        </div>
      ) : (
        <form className="toolbar">
          <select aria-label="Proceso" className="control audit-filter" defaultValue={elegido?.id} name="proceso">
            {procesos.map((proceso) => (
              <option key={proceso.id} value={proceso.id}>
                {proceso.nombre}{proceso.estado === "publicado" ? "" : ` (${proceso.estado})`}
              </option>
            ))}
          </select>
          <select aria-label="Período" className="control audit-filter" defaultValue={String(dias)} name="dias">
            {PERIODOS.map((periodo) => <option key={periodo} value={periodo}>Últimos {periodo} días</option>)}
          </select>
          <button className="button secondary" type="submit">Ver</button>
        </form>
      )}

      {tablero && detalle && (
        <>
          <div className="grid">
            <article className="card"><div className="card-label">Casos</div><div className="metric">{tablero.casos}</div></article>
            <article className="card"><div className="card-label">Entregados</div><div className="metric">{tablero.entregados}</div></article>
            <article className="card">
              <div className="card-label">Ciclo completo (mediana)</div>
              <div className="metric">{horas(tablero.ciclo.mediana_horas)}</div>
            </article>
            <article className="card">
              <div className="card-label">Dónde se traba</div>
              <div className="metric">{tablero.traba ? `Etapa ${tablero.traba.orden}` : "—"}</div>
              {tablero.traba && (
                <div className="table-secondary">{tablero.traba.nombre}, por {TRABAS[tablero.traba.motivo]}</div>
              )}
            </article>
          </div>
          {detalle.recortado && (
            <div className="notice">Hay más casos de los que entran en un tablero: se midieron los más recientes.</div>
          )}

          <section className="work-section">
            <h2>Por etapa</h2>
            <p className="subtitle">
              Mediana, percentil 90 y cuántos casos se midieron. La cola es lo que espera alguien
              que la tome; la espera, lo que frena a quien la tiene, incluida la vuelta de una devolución.
            </p>
            <div className="table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Etapa</th><th>Ahora</th><th>En cola</th><th>Trabajando</th><th>Esperando</th>
                    <th>En revisión</th><th>Devolución</th>
                  </tr>
                </thead>
                <tbody>
                  {tablero.etapas.map((etapa) => (
                    <tr key={etapa.orden}>
                      <td data-label="Etapa">{etapa.orden}. {etapa.nombre}</td>
                      <td data-label="Ahora">
                        {Object.keys(etapa.ahora).length
                          ? Object.entries(etapa.ahora).map(([estado, cantidad]) => (
                            <div key={estado}>{cantidad} {ESTADOS[estado] ?? estado}</div>
                          ))
                          : <span className="table-secondary">—</span>}
                      </td>
                      <td data-label="En cola">{tiempo(etapa.cola)}</td>
                      <td data-label="Trabajando">{tiempo(etapa.trabajo)}</td>
                      <td data-label="Esperando">{tiempo(etapa.espera)}</td>
                      <td data-label="En revisión">{tiempo(etapa.revision)}</td>
                      <td data-label="Devolución">
                        <div>{porcentaje(etapa.tasa_devolucion)}</div>
                        <div className="table-secondary">{etapa.devueltas} de {etapa.revisiones} revisiones</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="work-section">
            <h2>Modelo y resultado</h2>
            <p className="subtitle">
              Qué IA declaró cada cierre en su receta y qué pasó después en la revisión. Con pocos
              cierres, la diferencia entre modelos no dice nada todavía.
            </p>
            <div className="table-wrap">
              {tablero.etapas.some((etapa) => etapa.modelos.length) ? (
                <table className="audit-table">
                  <thead>
                    <tr><th>Etapa</th><th>Modelo</th><th>Cierres</th><th>Aprobados</th><th>Devueltos</th><th>Sin revisión</th><th>Pendientes</th></tr>
                  </thead>
                  <tbody>
                    {tablero.etapas.flatMap((etapa) => etapa.modelos.map((modelo) => (
                      <tr key={`${etapa.orden}:${modelo.modelo}`}>
                        <td data-label="Etapa">{etapa.orden}. {etapa.nombre}</td>
                        <td data-label="Modelo">{modelo.modelo}</td>
                        <td data-label="Cierres">{modelo.cierres}</td>
                        <td data-label="Aprobados">{modelo.aprobadas}</td>
                        <td data-label="Devueltos">{modelo.devueltas}</td>
                        <td data-label="Sin revisión">{modelo.sin_revision}</td>
                        <td data-label="Pendientes">{modelo.pendientes}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              ) : <div className="empty">Todavía no se cerró ninguna etapa en este período.</div>}
            </div>
          </section>

          <section className="work-section">
            <h2>Por qué se frena</h2>
            <p className="subtitle">
              Los últimos motivos de espera, devolución y liberación de cada etapa. Si se repiten,
              lo que falta suele estar en las instrucciones o en los insumos que pide el proceso.
            </p>
            <div className="table-wrap">
              {tablero.etapas.some((etapa) => etapa.motivos.length) ? (
                <table className="audit-table">
                  <thead><tr><th>Etapa</th><th>Fecha</th><th>Qué</th><th>Motivo</th></tr></thead>
                  <tbody>
                    {tablero.etapas.flatMap((etapa) => etapa.motivos.map((motivo, indice) => (
                      <tr key={`${etapa.orden}:${indice}`}>
                        <td data-label="Etapa">{etapa.orden}. {etapa.nombre}</td>
                        <td data-label="Fecha">{new Date(motivo.fecha).toLocaleDateString("es-AR")}</td>
                        <td data-label="Qué">{MOTIVOS[motivo.tipo]}</td>
                        <td data-label="Motivo">{motivo.texto || <span className="table-secondary">sin motivo</span>}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              ) : <div className="empty">Ninguna etapa se frenó en este período.</div>}
            </div>
          </section>

          {tablero.detenidos.length > 0 && (
            <section className="work-section">
              <h2>Casos detenidos</h2>
              <p className="subtitle">Sin movimiento hace tres días o más.</p>
              <div className="table-wrap">
                <table className="audit-table">
                  <thead><tr><th>Caso</th><th>Etapa</th><th>Estado</th><th>Días quieto</th></tr></thead>
                  <tbody>
                    {tablero.detenidos.map((caso) => (
                      <tr key={caso.caso}>
                        <td data-label="Caso"><Link className="record-link" href={`/records/instancia/${caso.caso}`}>{caso.titulo}</Link></td>
                        <td data-label="Etapa">{caso.etapa}</td>
                        <td data-label="Estado">{ESTADOS[caso.estado] ?? caso.estado}</td>
                        <td data-label="Días quieto">{caso.dias}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="work-section">
            <h2>Por persona</h2>
            <p className="subtitle">
              Cuántas etapas cerró cada una y cuántas le devolvieron. Es para ver dónde ayudar o
              qué explicar mejor, no para comparar a la gente: los casos difíciles no se reparten parejo.
            </p>
            <div className="table-wrap">
              {tablero.personas.length ? (
                <table className="audit-table">
                  <thead><tr><th>Persona</th><th>Cierres</th><th>Devueltos</th><th>Devolución</th></tr></thead>
                  <tbody>
                    {tablero.personas.map((persona) => (
                      <tr key={persona.persona}>
                        <td data-label="Persona">{persona.persona}</td>
                        <td data-label="Cierres">{persona.cierres}</td>
                        <td data-label="Devueltos">{persona.devueltas}</td>
                        <td data-label="Devolución">{porcentaje(persona.tasa_devolucion)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="empty">Nadie cerró una etapa en este período.</div>}
            </div>
          </section>
        </>
      )}
    </>
  );
}
