import Link from "next/link";
import { notFound } from "next/navigation";
import { VistaSelector } from "@/components/vista-selector";
import { canManageUsers, hasPermission, requireUser } from "@/lib/auth";
import { USER_SCOPES } from "@/platform/mcp/store";
import { familiasDeProcesos, motorDisponible } from "@/platform/processes/engine";

export const dynamic = "force-dynamic";

const fecha = (valor: unknown) => (valor ? new Date(String(valor)).toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : null);
const uno = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor) ?? "";

const ESTADOS: Record<string, string> = { publicado: "Publicado", borrador: "Borrador", retirado: "Retirado" };

/**
 * Lo que la organización sabe hacer, con el mismo manejo que cualquier listado: buscar,
 * filtrar por estado, ordenar, y verlo como tarjetas o como lista. Quien administra da de
 * alta procesos desde acá.
 */
export default async function ProcesosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!motorDisponible() || !hasPermission(user, "proceso", "list")) notFound();
  const pedido = await searchParams;
  const consulta = {
    q: uno(pedido.q).trim(),
    estado: uno(pedido.estado) || "vigentes",
    orden: uno(pedido.orden) || "ultima",
    vista: uno(pedido.vista) === "lista" ? "lista" : "tarjetas",
  };
  const aviso = uno(pedido.hecho) || null;
  const administra = canManageUsers(user);

  const todas = await familiasDeProcesos({ id: user.id, name: user.displayName, roleKey: user.roleKey, scopes: [...USER_SCOPES], kind: "user" });
  const buscado = consulta.q.toLowerCase();
  const familias = todas
    .filter((f) => consulta.estado === "todos" || (consulta.estado === "vigentes" ? f.estado !== "retirado" : f.estado === consulta.estado))
    .filter((f) => !buscado || `${f.nombre} ${f.resumen} ${f.skill?.nombre ?? ""}`.toLowerCase().includes(buscado))
    .sort((a, b) => consulta.orden === "nombre"
      ? a.nombre.localeCompare(b.nombre, "es")
      : consulta.orden === "iteraciones"
        ? b.iteraciones - a.iteraciones
        // Los que tienen iteraciones primero, de la más reciente a la más vieja; después el resto.
        : (b.ultima ? 1 : 0) - (a.ultima ? 1 : 0)
          || String(b.ultima ?? b.actualizado ?? "").localeCompare(String(a.ultima ?? a.actualizado ?? "")));
  const filtrando = Boolean(consulta.q) || consulta.estado !== "vigentes";

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Procesos</p>
          <h1>Lo que sabemos hacer</h1>
          <p className="subtitle">Cada proceso es algo que ya salió bien: cómo se hace, y las veces que se hizo.</p>
        </div>
        {administra && (
          <div className="header-actions">
            <Link className="button" href="/procesos/nuevo">Nuevo proceso</Link>
          </div>
        )}
      </div>

      {aviso && <div className="notice success">{aviso}</div>}

      <form className="filter-panel">
        <div className="filter-primary">
          <input className="control search" defaultValue={consulta.q} name="q" placeholder="Buscar por nombre, qué hace o skill…" type="search" />
          <select aria-label="Estado" className="control" defaultValue={consulta.estado} name="estado">
            <option value="vigentes">Vigentes</option>
            <option value="publicado">Publicados</option>
            <option value="retirado">Retirados</option>
            <option value="todos">Todos</option>
          </select>
          <select aria-label="Ordenar por" className="control" defaultValue={consulta.orden} name="orden">
            <option value="ultima">Última iteración</option>
            <option value="nombre">Nombre</option>
            <option value="iteraciones">Más iteraciones</option>
          </select>
          <input name="vista" type="hidden" value={consulta.vista} />
          <button className="button" type="submit">Aplicar</button>
          <Link className="button secondary" href={`/procesos?vista=${consulta.vista}`}>Limpiar</Link>
          <VistaSelector
            actual={consulta.vista}
            base="/procesos"
            consulta={consulta}
            opciones={[{ valor: "tarjetas", etiqueta: "Tarjetas" }, { valor: "lista", etiqueta: "Lista" }]}
          />
        </div>
      </form>

      {familias.length === 0 ? (
        <div className="empty">
          {filtrando
            ? "Ningún proceso coincide con estos filtros."
            : "Todavía no hay procesos. Cuando algo te quede bien, pedile a tu IA «registrá esto en Operaciones»."}
        </div>
      ) : consulta.vista === "lista" ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Proceso</th><th>Qué hace</th><th>Skill</th><th>Estado</th><th>Iteraciones</th><th>Última</th></tr>
            </thead>
            <tbody>
              {familias.map((familia) => (
                <tr key={familia.familia}>
                  <td data-label="Proceso"><Link className="record-link" href={`/procesos/${familia.familia}`}>{familia.nombre}</Link></td>
                  <td data-label="Qué hace" className="table-secondary">{familia.resumen}</td>
                  <td data-label="Skill">{familia.skill ? familia.skill.nombre : "guía"}</td>
                  <td data-label="Estado">{ESTADOS[familia.estado] ?? familia.estado}</td>
                  <td data-label="Iteraciones">{familia.iteraciones}</td>
                  <td data-label="Última">{fecha(familia.ultima) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  {familia.skill && <span className="badge accent">skill</span>}
                  {familia.requisitos > 0 && <span className="badge">{familia.requisitos} requisitos</span>}
                  {familia.estado !== "publicado" && <span className="badge warn">{ESTADOS[familia.estado] ?? familia.estado}</span>}
                  <span>
                    {familia.iteraciones === 1 ? "1 iteración" : `${familia.iteraciones} iteraciones`}
                    {familia.ultima ? ` · ${fecha(familia.ultima)}` : ""}
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
