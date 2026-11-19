import Link from "@/components/enlace";
import { notFound } from "next/navigation";
import { Copiar } from "@/components/copiar";
import { Receta, Salidas } from "@/components/process-output";
import { SubirLaminas } from "@/components/subir-laminas";
import { VistaSelector } from "@/components/vista-selector";
import { borrarIteracionAction, borrarProcesoAction, borrarProducidoAction, reactivarProcesoAction, retirarProcesoAction } from "../actions";
import { canManageUsers, hasPermission, requireUser } from "@/lib/auth";
import { USER_SCOPES } from "@/platform/mcp/store";
import { iteracionesDeProceso, motorDisponible, type Iteracion } from "@/platform/processes/engine";
import { almacenConfigurado } from "@/platform/storage/almacen";

export const dynamic = "force-dynamic";

const fecha = (valor: unknown) => (valor
  ? new Date(String(valor)).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })
  : "");

const TIPOS: Record<string, string> = {
  skill: "Skill",
  libreria: "Librería",
  programa: "Programa",
  conector: "Conector",
  variable: "Variable",
  archivo: "Archivo",
};

const ESTADOS: Record<string, string> = { en_curso: "En curso", terminada: "Terminada", publicada: "Publicada" };

function esWeb(valor: string | null) {
  return Boolean(valor && /^https?:\/\//i.test(valor));
}

/** La carpeta como enlace si es una dirección web; si es una ruta de Dropbox, como texto copiable. */
function Carpeta({ carpeta }: { carpeta: string | null }) {
  if (!carpeta) return null;
  return esWeb(carpeta)
    ? <a className="record-link" href={carpeta} rel="noreferrer" target="_blank">Carpeta en Dropbox</a>
    : <span className="table-secondary">Dropbox: <code>{carpeta}</code></span>;
}

function tamano(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Lo producido guardado en la aplicación: cada archivo se baja con los permisos de quien mira.
 * Quien puede subir lo producido de la iteración puede borrar un archivo suelto; si había
 * quedado como vista previa, sale también de ahí. El motor vuelve a comprobar el permiso.
 */
function Producido({ it, familia, puedeBorrar }: { it: Iteracion; familia: string; puedeBorrar: boolean }) {
  if (!it.producido?.length) return null;
  return (
    <ul className="case-list produced-list">
      {it.producido.map((archivo) => (
        <li key={archivo.id}>
          <a className="record-link" href={`/producido/${archivo.id}`}>{archivo.nombre}</a> <span className="table-secondary">{tamano(archivo.tamano)}</span>
          {puedeBorrar && (
            <details className="case-cancel produced-delete">
              <summary>Borrar</summary>
              <form action={borrarProducidoAction}>
                <input name="archivo" type="hidden" value={archivo.id} />
                <input name="familia" type="hidden" value={familia} />
                <button className="button danger" type="submit">Borrar {archivo.nombre}</button>
                <span className="field-help">Sale de lo producido y, si era vista previa, también de ahí. No se deshace.</span>
              </form>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Qué le falta a una iteración incompleta, en palabras de quien mira el panel. */
function queFalta(it: Iteracion) {
  const partes: string[] = [];
  if (it.falta.some((falta) => falta.startsWith("subir"))) partes.push("subir lo producido");
  // Con almacén, las láminas subidas quedan como vista previa al confirmar: el panel dice
  // lo mismo que las faltas, no lo deduce por su cuenta.
  if (it.falta.some((falta) => falta.startsWith("adjuntar la portada"))) partes.push("adjuntar la portada");
  else if (it.falta.some((falta) => falta.startsWith("adjuntar"))) partes.push("adjuntar las láminas");
  return partes.length ? `Incompleta: falta ${partes.join(" y ")}` : "";
}

function Origen({ it }: { it: Iteracion }) {
  if (it.origen !== "reproduccion") return null;
  return it.salio_igual === false
    ? <span className="badge warn">Reproducción · no salió igual</span>
    : <span className="badge ok">Reproducción · salió igual</span>;
}

/**
 * Todo lo de un proceso: qué hace, qué necesita la máquina, qué se registra cada vez, dónde
 * se guarda y las veces que se hizo. Quien administra lo edita, lo retira o lo borra, y
 * borra iteraciones.
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
  const uno = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor) ?? "";
  const aviso = uno(consulta.hecho) || null;
  const fallo = uno(consulta.error) || null;
  const persona = { id: user.id, name: user.displayName, roleKey: user.roleKey, scopes: [...USER_SCOPES], kind: "user" as const };

  let datos: Awaited<ReturnType<typeof iteracionesDeProceso>>;
  try {
    datos = await iteracionesDeProceso(persona, familia, 100);
  } catch {
    notFound();
  }
  const gestiona = canManageUsers(user);
  const almacen = almacenConfigurado();
  const retirado = datos.estado === "retirado";
  const ficha = datos.ficha;
  const filtros = {
    q: uno(consulta.q).trim(),
    quien: uno(consulta.quien),
    origen: uno(consulta.origen),
    vista: uno(consulta.vista) === "lista" ? "lista" : "galeria",
  };
  const personas = [...new Set(datos.iteraciones.map((it) => it.quien).filter((q): q is string => Boolean(q)))];
  const iteraciones = datos.iteraciones
    .filter((it) => !filtros.q || it.titulo.toLowerCase().includes(filtros.q.toLowerCase()))
    .filter((it) => !filtros.quien || it.quien === filtros.quien)
    .filter((it) => !filtros.origen || (filtros.origen === "reproduccion" ? it.origen === "reproduccion" : it.origen !== "reproduccion"));
  const filtrando = Boolean(filtros.q || filtros.quien || filtros.origen);
  const pedido = ficha?.pedido_ejemplo ?? `Hacé ${datos.nombre}`;
  const requisitos = [...datos.requisitos];
  if (ficha?.skill?.nombre && !requisitos.some((r) => r.tipo === "skill" && r.nombre === ficha.skill!.nombre)) {
    requisitos.unshift({ nombre: ficha.skill.nombre, tipo: "skill", verificar: "que esté instalada", ...(ficha.skill.repo ? { instalar: ficha.skill.repo } : {}) });
  }
  const sinCompletar = !datos.requisitos.length || !datos.registro.length || !datos.carpeta;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">
            <Link className="record-link" href="/procesos">Procesos</Link>
            {retirado ? " · retirado" : ""}
          </p>
          <h1>{datos.nombre}</h1>
          {datos.resumen && <p className="subtitle">{datos.resumen}</p>}
        </div>
        {gestiona && (
          <div className="header-actions">
            <Link className="button" href={`/procesos/${familia}/editar`}>Editar</Link>
            {retirado ? (
              <form action={reactivarProcesoAction}>
                <input name="familia" type="hidden" value={familia} />
                <button className="button secondary" type="submit">Reactivar</button>
              </form>
            ) : (
              <form action={retirarProcesoAction}>
                <input name="familia" type="hidden" value={familia} />
                <button className="button secondary" type="submit">Retirar</button>
              </form>
            )}
            <details className="header-danger">
              <summary className="button secondary">Borrar</summary>
              <form action={borrarProcesoAction}>
                <input name="familia" type="hidden" value={familia} />
                <span className="field-help">
                  Borra el proceso y sus {datos.iteraciones.length} iteraciones, con sus imágenes. No se deshace. Lo que está en Dropbox no se toca.
                </span>
                <button className="button danger" type="submit">Borrar definitivamente</button>
              </form>
            </details>
          </div>
        )}
      </div>

      {aviso && <div className="notice success">{aviso}</div>}
      {fallo && <div className="notice error">{fallo}</div>}
      {gestiona && sinCompletar && (
        <div className="notice">
          A este proceso le falta {[!datos.requisitos.length && "decir qué necesita la máquina", !datos.registro.length && "qué se registra cada vez", !almacen && !datos.carpeta && "la carpeta de Dropbox"].filter(Boolean).join(", ")}. Sin eso, quien lo repita no tiene cómo comprobar ni qué dejar. <Link className="record-link" href={`/procesos/${familia}/editar`}>Completarlo</Link>
        </div>
      )}

      <section className="process-sheet" aria-label="Cómo se hace">
        <div className="sheet-grid">
          <div className="sheet-item">
            <div className="card-label">Cómo se hace</div>
            {ficha?.skill ? (
              <>
                <div className="sheet-value">skill {ficha.skill.nombre}</div>
                {ficha.skill.repo && <a className="record-link" href={ficha.skill.repo} rel="noreferrer" target="_blank">Ver el repositorio</a>}
              </>
            ) : (
              <div className="sheet-value">{datos.metodo ? "Método escrito" : "Sin skill ni método"}</div>
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
          <div className="sheet-item">
            <div className="card-label">Dónde se guarda</div>
            <div className="sheet-value">{datos.carpeta ? <code>{datos.carpeta}</code> : "Sin carpeta definida"}</div>
          </div>
        </div>
        <div className="sheet-ask">
          <span><span className="table-secondary">Pedíselo a tu IA:</span> <code>{pedido}</code></span>
          <Copiar texto={pedido} />
        </div>
        {datos.saben.length > 0 && <p className="sheet-foot">Lo {datos.saben.length === 1 ? "sabe" : "saben"} hacer: {datos.saben.join(", ")}</p>}
      </section>

      {datos.recursos.length > 0 && (
        <section className="work-section">
          <h2>Lo que trae</h2>
          <p className="subtitle">Quien repite el proceso lo instala desde la aplicación, con como_se_hace: no necesita acceso al repositorio ni a carpetas compartidas.</p>
          <ul className="case-list">
            {datos.recursos.map((recurso) => (
              <li key={recurso.nombre}>
                <code>{recurso.nombre}</code>{" "}
                <span className="table-secondary">{recurso.version
                  ? `${recurso.tipo === "skill" ? "Skill" : "Archivos"} · versión ${recurso.version} · ${tamano(recurso.tamano ?? 0)}`
                  : "Todavía no publicado"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="work-section">
        <h2>Qué necesita la máquina</h2>
        {requisitos.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Qué</th><th>Tipo</th><th>Cómo se comprueba</th><th>Si falta</th></tr></thead>
              <tbody>
                {requisitos.map((r) => (
                  <tr key={`${r.tipo}:${r.nombre}`}>
                    <td data-label="Qué"><strong>{r.nombre}</strong></td>
                    <td data-label="Tipo">{TIPOS[r.tipo] ?? r.tipo}</td>
                    <td data-label="Cómo se comprueba"><code>{r.verificar}</code></td>
                    <td data-label="Si falta" className="table-secondary">{r.instalar ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty compact">No declara requisitos.</div>}
      </section>

      <section className="work-section">
        <h2>Qué se registra cada vez</h2>
        <p className="subtitle">{almacen
          ? "Además de lo producido, que se sube a la aplicación, la receta, la skill con su commit y la conversación."
          : "Además de la carpeta en Dropbox, los archivos, la receta, la skill con su commit y la conversación."}</p>
        {datos.registro.length ? (
          <ul className="case-list">
            {datos.registro.map((campo) => (
              <li key={campo.clave}>
                <code>{campo.clave}</code> <span className="table-secondary">{campo.descripcion}{campo.requerido === false ? " (opcional)" : ""}</span>
              </li>
            ))}
          </ul>
        ) : <div className="empty compact">No pide datos propios.</div>}
      </section>

      <section className="work-section">
        <h2>Iteraciones{datos.iteraciones.length ? ` · ${filtrando ? `${iteraciones.length} de ${datos.iteraciones.length}` : datos.iteraciones.length}` : ""}</h2>
        {datos.iteraciones.length > 0 && (
          <form className="filter-panel">
            <div className="filter-primary">
              <input className="control search" defaultValue={filtros.q} name="q" placeholder="Buscar por título…" type="search" />
              <select aria-label="Quién" className="control" defaultValue={filtros.quien} name="quien">
                <option value="">Todas las personas</option>
                {personas.map((nombre) => <option key={nombre} value={nombre}>{nombre}</option>)}
              </select>
              <select aria-label="Origen" className="control" defaultValue={filtros.origen} name="origen">
                <option value="">Todo</option>
                <option value="original">Así se hizo</option>
                <option value="reproduccion">Reproducciones</option>
              </select>
              <input name="vista" type="hidden" value={filtros.vista} />
              <button className="button" type="submit">Aplicar</button>
              <Link className="button secondary" href={`/procesos/${familia}?vista=${filtros.vista}`}>Limpiar</Link>
              <VistaSelector
                actual={filtros.vista}
                base={`/procesos/${familia}`}
                consulta={filtros}
                opciones={[{ valor: "galeria", etiqueta: "Galería" }, { valor: "lista", etiqueta: "Lista" }]}
              />
            </div>
          </form>
        )}
        {datos.iteraciones.length === 0 && (
          <div className="empty compact">Todavía no se registró ninguna. Al terminar una pieza, pedile a tu IA «registrá esto en Operación».</div>
        )}
        {datos.iteraciones.length > 0 && iteraciones.length === 0 && (
          <div className="empty compact">Ninguna iteración coincide con estos filtros.</div>
        )}
        {filtros.vista === "lista" && iteraciones.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pieza</th><th>Fecha</th><th>Quién</th><th>Skill</th><th>Estado</th><th>Enlaces</th></tr></thead>
              <tbody>
                {iteraciones.map((it) => (
                  <tr key={it.iteracion}>
                    <td data-label="Pieza">{it.titulo} <Origen it={it} />{it.incompleta && <span className="badge warn" title={queFalta(it)}>incompleta</span>}</td>
                    <td data-label="Fecha">{fecha(it.fecha)}</td>
                    <td data-label="Quién">{it.quien ?? "—"}</td>
                    <td data-label="Skill">{it.skill ?? "—"}</td>
                    <td data-label="Estado">{it.estado ? ESTADOS[it.estado] ?? it.estado : "—"}</td>
                    <td data-label="Enlaces">
                      <span className="iteration-links">
                        <Carpeta carpeta={it.carpeta} />
                        {it.conversacion && esWeb(it.conversacion) && <a className="record-link" href={it.conversacion} rel="noreferrer" target="_blank">Conversación</a>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtros.vista === "galeria" && (
          <div className="iteration-grid">
            {iteraciones.map((it) => (
              <article className="iteration" key={it.iteracion}>
                <div className={`process-cover${it.incompleta ? " empty-cover incomplete-cover" : ""}`}>
                  {it.incompleta
                    ? <span>{queFalta(it)}</span>
                    : it.imagenes.slice(0, 3).map((imagen) => (
                      // eslint-disable-next-line @next/next/no-img-element -- adjunto privado, servido con permisos
                      <img alt="" key={imagen.id} loading="lazy" src={`/attachments/${imagen.id}?ver=1`} />
                    ))}
                </div>
                <div className="iteration-body">
                  <h3>{it.titulo}</h3>
                  <div className="process-meta">
                    <span>
                      {fecha(it.fecha)}{it.quien ? ` · ${it.quien}` : ""}
                      {it.skill ? ` · ${it.skill}` : ""}
                      {it.responsable ? ` · responde ${it.responsable}` : ""}
                    </span>
                    {it.estado && <span className="badge">{ESTADOS[it.estado] ?? it.estado}</span>}
                    <Origen it={it} />
                  </div>
                  {it.salio_igual === false && it.que_falto && <p className="iteration-missing">Qué faltó: {it.que_falto}</p>}
                  <Producido familia={familia} it={it} puedeBorrar={gestiona || it.persona === user.id} />
                  <div className="iteration-links">
                    <Carpeta carpeta={it.carpeta} />
                    {it.conversacion && (esWeb(it.conversacion)
                      ? <a className="record-link" href={it.conversacion} rel="noreferrer" target="_blank">Conversación</a>
                      : <span className="table-secondary" title={it.conversacion}>Conversación en la máquina de {it.quien ?? "quien la hizo"}</span>)}
                  </div>
                  <details className="iteration-recipe">
                    <summary>Ver cómo se hizo{it.imagenes.length > 3 ? ` y las ${it.imagenes.length} imágenes` : ""}</summary>
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
                    {Object.keys(it.datos).length > 0 && <Salidas salidas={it.datos} />}
                    {it.archivos.length > 0 && (
                      <p className="table-secondary">Archivos en la carpeta: {it.archivos.join(", ")}</p>
                    )}
                    {it.receta && <Receta receta={it.receta} />}
                    {(gestiona || it.persona === user.id) && it.imagenes.length < 20 && <SubirLaminas iteracion={it.iteracion} />}
                  </details>
                  {gestiona && (
                    <div className="iteration-links">
                      <Link className="record-link" href={`/records/iteracion/${it.iteracion}`}>Editar</Link>
                      <details className="case-cancel">
                        <summary>Borrar</summary>
                        <form action={borrarIteracionAction}>
                          <input name="iteracion" type="hidden" value={it.iteracion} />
                          <input name="familia" type="hidden" value={familia} />
                          <button className="button danger" type="submit">Borrar esta iteración</button>
                          <span className="field-help">{it.producido?.length ? "Con sus imágenes y lo producido que tiene guardado. No se deshace." : "Con sus imágenes. Lo que está en Dropbox no se toca."}</span>
                        </form>
                      </details>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
