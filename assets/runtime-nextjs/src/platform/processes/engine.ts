import "server-only";
import type { PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { generatedCapabilities } from "@/generated/permissions";
import {
  contentTypeAllowed,
  countAttachments,
  deleteAttachmentsForRecord,
  insertAttachment,
  listAttachments,
  lockAttachmentSet,
  resolveAttachmentPolicy,
} from "@/lib/attachments";
import { recordAuditEvent } from "@/lib/audit";
import { sql, withTransaction } from "@/lib/db";
import { enParalelo } from "@/lib/en-paralelo";
import { recordAccessForAgent, type RecordAccessContext } from "@/lib/record-access";
import { deleteRecord, getRecord, insertRecord, listRecords, recordInputFromObject, updateRecord } from "@/lib/repository";
import { revalidateAfterWrite } from "@/lib/revalidation";
import { applyRules } from "@/lib/rules";
import { getEntity, relationFields, requireEntity } from "@/lib/spec";
import type { AgentPrincipal } from "@/platform/mcp/store";
import {
  almacenConfigurado,
  consultarObjeto,
  direccionDeDescarga,
  direccionDeSubida,
  leerObjeto,
  MAXIMO_POR_ARCHIVO,
} from "@/platform/storage/almacen";
import {
  descartarVersion,
  insertarVersionPendiente,
  marcarPublicada,
  versionDeRecurso,
  versionesVigentes,
} from "@/platform/storage/recursos";
import {
  archivoPorId,
  archivosDelRegistro,
  borrarDelAlmacen,
  contarDelRegistro,
  descartarPendiente,
  marcarGuardado,
  reservarSubida,
  soltarDelRegistro,
  soltarProducido,
  vistaPreviaActual,
  type ArchivoGuardado,
} from "@/platform/storage/archivos";
import { separarRepetidos } from "@/platform/storage/repetidos";
import { porNombre, vistaPreviaQueFalta } from "@/platform/storage/vista-previa";
import {
  claveDeNombre,
  destinoDeRecurso,
  esCarpetaDeDropbox,
  NOMBRE_DE_RECURSO,
  TIPOS_DE_RECURSO,
  faltasDeFicha,
  faltasDeIteracion,
  faltasParaCompletar,
  familiaDe,
  guiaDeProceso,
  iteracionIncompleta,
  mensajeDeRegistro,
  nombreDeFamilia,
  quienesSaben,
  resumenCorto,
  skillDeIteracion,
  validarDefinicion,
  type Definicion,
  type Ficha,
  type RecursoParaInstalar,
  type TipoRecurso,
  type Receta,
  type Reproduccion,
} from "@/platform/processes/definition";

/**
 * Procesos e iteraciones sobre las entidades `proceso` e `iteracion`.
 *
 * El sistema hace una sola cosa: guardar con fidelidad cómo alguien hizo algo en su máquina,
 * para que otra persona lo repita en otra. El proceso dice qué hace falta y qué hay que dejar
 * registrado; la iteración es cada vez que se hizo, con lo producido en Dropbox. No hay
 * etapas, colas ni aprobaciones.
 *
 * Los datos son registros de la AppSpec: se ven en el panel, dejan auditoría y quien
 * administra los edita y los borra. Registrar una iteración pasa por acá porque es lo que
 * valida que esté completa; editarla o borrarla después es como con cualquier registro.
 */

const REQUISITOS: Record<string, { campos: string[]; relaciones: string[]; opciones?: Record<string, string[]> }> = {
  proceso: { campos: ["nombre", "estado", "definicion"], relaciones: [], opciones: { estado: ["publicado", "retirado"] } },
  iteracion: {
    campos: ["titulo", "carpeta", "archivos", "datos", "receta", "skill", "conversacion", "origen", "salio_igual", "que_falto", "autor"],
    relaciones: ["proceso"],
    opciones: { origen: ["original", "reproduccion"] },
  },
};

let faltantesCache: string[] | null = null;

/** Qué le falta a la AppSpec para que procesos funcione. Vacío: está disponible. */
export function faltantesDelMotor() {
  if (faltantesCache) return faltantesCache;
  const faltan: string[] = [];
  for (const [clave, requisito] of Object.entries(REQUISITOS)) {
    const entidad = getEntity(clave);
    if (!entidad) {
      faltan.push(`la entidad ${clave}`);
      continue;
    }
    for (const campo of requisito.campos) {
      if (!entidad.fields.some((field) => field.key === campo)) faltan.push(`el campo ${clave}.${campo}`);
    }
    for (const relacion of requisito.relaciones) {
      if (!relationFields(entidad).some((r) => r.key === relacion)) faltan.push(`la relación ${clave}.${relacion}`);
    }
    for (const [campo, opciones] of Object.entries(requisito.opciones ?? {})) {
      const definidas = new Set(entidad.fields.find((field) => field.key === campo)?.options?.map((o) => o.key) ?? []);
      for (const opcion of opciones) {
        if (!definidas.has(opcion)) faltan.push(`la opción «${opcion}» en ${clave}.${campo}`);
      }
    }
  }
  faltantesCache = faltan;
  return faltan;
}

export function motorDisponible() {
  return faltantesDelMotor().length === 0;
}

function rolesQueAdministran() {
  if (!generatedCapabilities) return [];
  return Object.entries(generatedCapabilities)
    .filter(([, capacidades]) => (capacidades as readonly string[]).includes("manage_users"))
    .map(([rol]) => rol);
}

type Identidad = {
  persona: string;
  administra: boolean;
  access: RecordAccessContext | undefined;
};

/**
 * Quién opera. Una credencial de agente registra a nombre de la persona que responde por
 * ella; una sin responsable no registra, porque cada iteración tiene que tener a alguien.
 */
function identidad(agent: AgentPrincipal): Identidad {
  const persona = agent.kind === "user" ? agent.id : agent.ownerUserId;
  if (!persona) {
    throw new Error("Esta credencial no tiene una persona que responda por ella. Pedile a quien administra que le asigne una.");
  }
  const roles = agent.kind === "user" ? [agent.roleKey] : [...new Set([agent.roleKey, agent.ownerRoleKey ?? agent.roleKey])];
  const administradores = rolesQueAdministran();
  return {
    persona,
    administra: roles.every((rol) => administradores.includes(rol)),
    access: recordAccessForAgent(agent),
  };
}

function exigirAlcance(agent: AgentPrincipal, alcance: "records:read" | "records:write") {
  if (!agent.scopes.includes(alcance)) {
    throw new Error(alcance === "records:write" ? "La credencial es de sólo lectura." : "La credencial no tiene alcance para leer registros.");
  }
}

function exigirQueAdministre(quien: Identidad) {
  if (!quien.administra) throw new Error("Esto lo hace quien administra.");
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
}

type Escritura = { agent: AgentPrincipal; agentEventId?: string; quien: Identidad; client: PoolClient };

function autoria(escritura: Escritura) {
  return escritura.agent.kind === "user"
    ? { actorId: escritura.agent.id }
    : { agentId: escritura.agent.id, agentEventId: escritura.agentEventId || undefined };
}

async function crear(escritura: Escritura, entidad: "proceso" | "iteracion", valores: Record<string, unknown>, origen: string) {
  const normalizados = recordInputFromObject(requireEntity(entidad), valores, "create");
  const evaluados = applyRules({ entityKey: entidad, event: "before_create", values: normalizados });
  const id = await insertRecord(entidad, evaluados.values, escritura.client, escritura.quien.access);
  const despues = await getRecord(entidad, id, escritura.client, false, escritura.quien.access);
  await recordAuditEvent(escritura.client, {
    ...autoria(escritura),
    entityKey: entidad,
    recordId: id,
    action: "create",
    changes: { after: despues, rules: evaluados.applied, source: origen },
  });
  return id;
}

async function actualizarProceso(escritura: Escritura, antes: Record<string, unknown>, valores: Record<string, unknown>) {
  const id = String(antes.id);
  const normalizados = recordInputFromObject(requireEntity("proceso"), valores, "update");
  const evaluados = applyRules({ entityKey: "proceso", event: "before_update", values: normalizados, before: antes });
  await updateRecord("proceso", id, evaluados.values, escritura.client, escritura.quien.access);
  const despues = await getRecord("proceso", id, escritura.client, false, escritura.quien.access);
  await recordAuditEvent(escritura.client, {
    ...autoria(escritura),
    entityKey: "proceso",
    recordId: id,
    action: "update",
    changes: { before: antes, after: despues, rules: evaluados.applied, source: "panel:procesos" },
  });
}

// ---------------------------------------------------------------------------------------
// Procesos
// ---------------------------------------------------------------------------------------

async function todosLosProcesos(quien: Identidad) {
  return listRecords("proceso", { sort: "updated_at", direction: "desc", limit: 500, access: quien.access });
}

/** Los registros de un proceso. Antes de la 1.12 cada versión era un registro aparte. */
async function procesosDeLaFamilia(familia: string, quien: Identidad) {
  return (await todosLosProcesos(quien)).filter((proceso) => familiaDe(proceso) === familia);
}

/** El registro que vale: el publicado más reciente, o el más reciente si están todos retirados. */
function vigente(procesos: Record<string, unknown>[]) {
  const ordenados = [...procesos].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return ordenados.find((p) => p.estado !== "retirado") ?? ordenados[0] ?? null;
}

async function familiaPedida(proceso: string, quien: Identidad) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proceso)) {
    const registro = await getRecord("proceso", proceso, undefined, false, quien.access);
    if (!registro) throw new Error("Ese proceso no existe o no está a tu alcance.");
    return familiaDe(registro);
  }
  return claveDeNombre(proceso);
}

/** La definición tal como se puede usar. Una vieja con errores no rompe la lectura: se usa lo que hay. */
function definicionDe(proceso: Record<string, unknown>): Definicion {
  const validacion = validarDefinicion(proceso.definicion);
  if (validacion.ok) return validacion.definicion;
  const cruda = esObjeto(proceso.definicion) ? proceso.definicion : {};
  return { ...(esObjeto(cruda.ficha) ? { ficha: cruda.ficha as Ficha } : {}), requisitos: [], registro: [] };
}

function resumenDe(proceso: Record<string, unknown>) {
  const definicion = esObjeto(proceso.definicion) ? proceso.definicion : {};
  const ficha = esObjeto(definicion.ficha) ? definicion.ficha : {};
  return typeof ficha.resumen === "string" && ficha.resumen.trim()
    ? ficha.resumen
    : resumenCorto(proceso.descripcion ?? definicion.proposito, 200);
}

// ---------------------------------------------------------------------------------------
// Iteraciones
// ---------------------------------------------------------------------------------------

type Imagen = { id: string; nombre: string; tipo: string };
export type Producido = { id: string; nombre: string; tipo: string; tamano: number; guardado: unknown };

/**
 * Cuánto cuenta como producido para decidir si una iteración está completa. Con almacén, lo
 * guardado en él; pero una iteración registrada con su carpeta de Dropbox y la lista de
 * archivos comprobados —todas las de antes del almacén— ya cumplió con lo que se pedía y no
 * pasa a estar incompleta por encender el almacén. Sin almacén, no cuenta (undefined).
 */
function producidoQueCuenta(producido: Producido[] | null, registro: Record<string, unknown>) {
  if (!producido) return undefined;
  if (producido.length) return producido.length;
  const archivos = Array.isArray(registro.archivos) ? registro.archivos.filter((a) => typeof a === "string" && a.trim()) : [];
  return esCarpetaDeDropbox(registro.carpeta) && archivos.length ? archivos.length : 0;
}

async function producidoDe(iteracion: string): Promise<Producido[]> {
  const archivos = await archivosDelRegistro("iteracion", iteracion).catch(() => []);
  return archivos.map((a) => ({ id: a.id, nombre: a.original_name, tipo: a.content_type, tamano: a.size_bytes, guardado: a.stored_at }));
}

async function imagenesDe(iteracion: string): Promise<Imagen[]> {
  const adjuntos = await listAttachments("iteracion", iteracion).catch(() => []);
  // En orden natural de nombre (slide-07 antes que slide-08 aunque se haya adjuntado después),
  // y a igual nombre, por fecha.
  return adjuntos
    .filter((adjunto) => adjunto.content_type.startsWith("image/"))
    .sort((a, b) => porNombre(a, b) || String(a.created_at).localeCompare(String(b.created_at)))
    .map((adjunto) => ({ id: adjunto.id, nombre: adjunto.original_name, tipo: adjunto.content_type }));
}

async function nombresDePersonas(ids: unknown[]) {
  const validos = [...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0))];
  if (!validos.length) return new Map<string, string>();
  const filas = await sql<{ id: string; display_name: string | null; email: string | null }>(
    "SELECT id, display_name, email FROM app_user WHERE id = ANY($1::uuid[])",
    [validos],
  );
  return new Map(filas.map((fila) => [fila.id, fila.display_name || fila.email || fila.id]));
}

export type Iteracion = {
  iteracion: string;
  titulo: string;
  fecha: unknown;
  quien: string | null;
  persona: string | null;
  responsable: string | null;
  estado: string | null;
  origen: string;
  salio_igual: boolean | null;
  que_falto: string | null;
  carpeta: string | null;
  archivos: string[];
  datos: Record<string, unknown>;
  skill: string | null;
  conversacion: string | null;
  receta: Record<string, unknown> | null;
  imagenes: Imagen[];
  /** Lo producido guardado en el almacén de la aplicación. Null si la aplicación no tiene almacén. */
  producido: Producido[] | null;
  /** Sin imágenes adjuntas, o sin lo producido si hay almacén: el panel la marca y la IA sabe qué falta. */
  incompleta: boolean;
  falta: string[];
};

async function iteracionesDe(procesos: Record<string, unknown>[], quien: Identidad, limite = 100): Promise<Iteracion[]> {
  const registros = (await Promise.all(procesos.map((proceso) => listRecords("iteracion", {
    filters: { proceso_id: String(proceso.id) },
    sort: "created_at",
    direction: "desc",
    limit: limite,
    access: quien.access,
  })))).flat()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limite);
  const nombres = await nombresDePersonas(registros.flatMap((r) => [r.autor, r.responsable]));
  const almacen = almacenConfigurado();
  return Promise.all(registros.map(async (r) => {
    const imagenes = await imagenesDe(String(r.id));
    const producido = almacen ? await producidoDe(String(r.id)) : null;
    return {
      iteracion: String(r.id),
      titulo: String(r.titulo),
      fecha: r.created_at,
      quien: typeof r.autor === "string" ? nombres.get(r.autor) ?? null : null,
      persona: typeof r.autor === "string" ? r.autor : null,
      responsable: typeof r.responsable === "string" ? nombres.get(r.responsable) ?? null : null,
      estado: typeof r.estado === "string" ? r.estado : null,
      origen: String(r.origen ?? "original"),
      salio_igual: typeof r.salio_igual === "boolean" ? r.salio_igual : null,
      que_falto: typeof r.que_falto === "string" ? r.que_falto : null,
      carpeta: typeof r.carpeta === "string" ? r.carpeta : null,
      archivos: Array.isArray(r.archivos) ? r.archivos.filter((a): a is string => typeof a === "string") : [],
      datos: esObjeto(r.datos) ? r.datos : {},
      skill: skillDeIteracion(r),
      conversacion: typeof r.conversacion === "string" && r.conversacion ? r.conversacion : null,
      receta: esObjeto(r.receta) ? r.receta : null,
      imagenes,
      producido,
      incompleta: iteracionIncompleta(imagenes.length, producidoQueCuenta(producido, r)),
      falta: faltasParaCompletar(imagenes.length, producidoQueCuenta(producido, r)),
    };
  }));
}

/**
 * Registra una vez que se hizo un proceso. Si el proceso no existe y quien registra
 * administra, lo crea en el mismo paso con la ficha completa: el agente que acaba de hacerlo
 * es el que sabe qué hace falta. Quien no administra no crea procesos.
 */
export async function registrarIteracion(agent: AgentPrincipal, entrada: {
  proceso?: string;
  nuevo_proceso?: DatosDeProceso;
  titulo: string;
  carpeta?: string;
  archivos?: string[];
  datos?: Record<string, unknown>;
  receta: Receta;
  skill?: string;
  conversacion?: string;
  reproduccion?: Reproduccion;
  estado?: string;
  responsable?: string;
}, agentEventId?: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  if (!entrada.proceso && !entrada.nuevo_proceso) throw new Error("Falta proceso: el id o el nombre del proceso, o nuevo_proceso si es la primera vez.");
  if (entrada.proceso && entrada.nuevo_proceso) throw new Error("proceso y nuevo_proceso: es uno u otro.");
  if (entrada.reproduccion && entrada.nuevo_proceso) throw new Error("Sólo se reproduce un proceso que ya existe.");

  let proceso: Record<string, unknown> | null = null;
  if (entrada.proceso) {
    const procesos = await procesosDeLaFamilia(await familiaPedida(entrada.proceso, quien), quien);
    proceso = vigente(procesos);
    if (!proceso) throw new Error(`No hay ningún proceso «${entrada.proceso}». Si es la primera vez, usá nuevo_proceso.`);
  } else {
    if (!quien.administra) {
      throw new Error("Este proceso no existe, y crearlo lo hace quien administra. Pedile que lo cree, desde el panel o con su agente; lo producido se registra cuando exista.");
    }
    const familia = claveDeNombre(entrada.nuevo_proceso!.nombre);
    const existente = vigente(await procesosDeLaFamilia(familia, quien));
    if (existente) throw new Error(`Ya existe «${nombreDeFamilia(existente.nombre)}»: registralo con proceso «${nombreDeFamilia(existente.nombre)}».`);
  }

  const definicionNueva = entrada.nuevo_proceso ? definicionDesdeDatos(claveDeNombre(entrada.nuevo_proceso.nombre), entrada.nuevo_proceso) : null;
  const definicion: Definicion = proceso ? definicionDe(proceso) : (definicionNueva as Definicion);
  const almacen = almacenConfigurado();
  const faltas = faltasDeIteracion(definicion, entrada, { almacen });
  if (faltas.length) throw new Error(["No se registró. Falta:", ...faltas.map((falta) => `- ${falta}`)].join("\n"));

  const resultado = await withTransaction(async (client) => {
    const escritura: Escritura = { agent, agentEventId, quien, client };
    let procesoId = proceso ? String(proceso.id) : "";
    if (!proceso) {
      const nuevo = entrada.nuevo_proceso!;
      procesoId = await crear(escritura, "proceso", {
        nombre: nuevo.nombre.trim(),
        estado: "publicado",
        descripcion: nuevo.ficha.resumen ?? "",
        definicion: definicionNueva,
      }, "mcp:procesos");
    }
    const id = await crear(escritura, "iteracion", {
      titulo: entrada.titulo,
      proceso: procesoId,
      carpeta: entrada.carpeta?.trim() || null,
      archivos: entrada.archivos ?? [],
      datos: entrada.datos ?? {},
      receta: entrada.receta,
      skill: entrada.skill?.trim() || skillDeIteracion({ receta: entrada.receta }) || null,
      conversacion: entrada.conversacion || null,
      origen: entrada.reproduccion ? "reproduccion" : "original",
      salio_igual: entrada.reproduccion ? entrada.reproduccion.salio_igual : null,
      que_falto: entrada.reproduccion?.que_falto ?? null,
      autor: quien.persona,
      ...(entrada.responsable ? { responsable: entrada.responsable } : {}),
      ...(entrada.estado ? { estado: entrada.estado } : {}),
    }, "mcp:procesos");
    return { iteracion: id, proceso: procesoId };
  });
  revalidateAfterWrite("iteracion", resultado.iteracion);
  revalidateAfterWrite("proceso", resultado.proceso);
  // Recién creada no tiene imágenes ni, con almacén, lo producido: la respuesta lo dice, para
  // que el agente no se quede en «quedó registrada» y deje la iteración a medias.
  const imagenes = 0;
  const guardados = almacen ? 0 : undefined;
  return {
    ...resultado,
    incompleta: iteracionIncompleta(imagenes, guardados),
    falta: faltasParaCompletar(imagenes, guardados),
    mensaje: mensajeDeRegistro({ iteracion: resultado.iteracion, procesoNuevo: Boolean(entrada.nuevo_proceso), imagenes, guardados }),
  };
}

/** Adjunta archivos livianos a una iteración: las láminas de un carrusel, la portada de un video. */
export async function adjuntarAIteracion(agent: AgentPrincipal, iteracion: string, archivos: Array<{ nombre: string; tipo: string; contenido: Buffer }>) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  const politica = resolveAttachmentPolicy(requireEntity("iteracion"));
  if (!politica) throw new Error("Esta aplicación no admite archivos en las iteraciones. Hay que habilitarlos en la AppSpec.");
  if (!archivos.length) throw new Error("No llegó ningún archivo.");
  for (const archivo of archivos) {
    const nombre = archivo.nombre.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!nombre || nombre.length > 255) throw new Error("Cada archivo necesita un nombre de hasta 255 caracteres.");
    if (!archivo.contenido.length) throw new Error(`«${nombre}» está vacío.`);
    if (archivo.contenido.length > politica.maxSizeBytes) {
      throw new Error(`«${nombre}» supera el máximo de ${Math.floor(politica.maxSizeBytes / 1024 / 1024)} MB por archivo.`);
    }
    if (!contentTypeAllowed(archivo.tipo.toLowerCase(), politica.allowedTypes)) {
      throw new Error(`«${nombre}» es ${archivo.tipo}, y se admite: ${politica.allowedTypes.join(", ")}.`);
    }
    archivo.nombre = nombre;
  }
  const ids = await withTransaction(async (client) => {
    const registro = await getRecord("iteracion", iteracion, client, true, quien.access);
    if (!registro) throw new Error("Esa iteración no existe o no está a tu alcance.");
    const propia = registro.autor === quien.persona || registro.responsable === quien.persona;
    if (!propia && !quien.administra) throw new Error("Adjunta quien la hizo, quien responde por ella o quien administra.");
    await lockAttachmentSet(client, "iteracion", iteracion);
    const actuales = await countAttachments(client, "iteracion", iteracion);
    if (actuales + archivos.length > politica.maxFiles) {
      throw new Error(`Una iteración admite hasta ${politica.maxFiles} archivos y esta ya tiene ${actuales}.`);
    }
    const escritura: Escritura = { agent, quien, client };
    const nuevos: string[] = [];
    for (const archivo of archivos) {
      const sha256 = createHash("sha256").update(archivo.contenido).digest("hex");
      const id = await insertAttachment(client, {
        entityKey: "iteracion",
        recordId: iteracion,
        originalName: archivo.nombre,
        contentType: archivo.tipo.toLowerCase(),
        content: archivo.contenido,
        sha256,
        actorId: quien.persona,
      });
      await recordAuditEvent(client, {
        ...autoria(escritura),
        entityKey: "iteracion",
        recordId: iteracion,
        action: "attachment_create",
        changes: { attachment: { id, originalName: archivo.nombre, contentType: archivo.tipo, sizeBytes: archivo.contenido.length, sha256 }, source: "mcp:procesos" },
      });
      nuevos.push(id);
    }
    return nuevos;
  });
  revalidateAfterWrite("iteracion", iteracion);
  return { iteracion, adjuntados: ids.length, archivos: ids, mensaje: `Quedaron ${ids.length} archivo${ids.length === 1 ? "" : "s"} en la iteración.` };
}

// ---------------------------------------------------------------------------------------
// Lo producido, en el almacén de la aplicación
// ---------------------------------------------------------------------------------------

/** Cuántos archivos de lo producido admite una iteración, contando los pendientes. */
const MAXIMO_PRODUCIDO_POR_ITERACION = 200;

/** El MD5 en hexadecimal o en base64, como lo dé la herramienta de quien sube. */
function md5Normalizado(valor: string) {
  const texto = valor.trim();
  if (/^[0-9a-f]{32}$/i.test(texto)) return { hex: texto.toLowerCase(), base64: Buffer.from(texto, "hex").toString("base64") };
  if (/^[A-Za-z0-9+/]{22}==$/.test(texto)) return { hex: Buffer.from(texto, "base64").toString("hex"), base64: texto };
  return null;
}

/** Un nombre de archivo sin carpetas ni caracteres de control: la carpeta la pone la aplicación. */
function nombreDeArchivo(valor: string) {
  return valor.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]+/g, "_").trim();
}

function exigirAlmacen() {
  if (!almacenConfigurado()) {
    throw new Error("Esta aplicación no tiene almacén propio: lo producido va a la carpeta de Dropbox del proceso.");
  }
}

/** Sube lo producido quien hizo la iteración, quien responde por ella o quien administra. */
async function exigirIteracionPropia(iteracion: string, quien: Identidad, client?: PoolClient) {
  const registro = await getRecord("iteracion", iteracion, client, Boolean(client), quien.access);
  if (!registro) throw new Error("Esa iteración no existe o no está a tu alcance.");
  const propia = registro.autor === quien.persona || registro.responsable === quien.persona;
  if (!propia && !quien.administra) throw new Error("Sube lo producido quien hizo la iteración, quien responde por ella o quien administra.");
  return registro;
}

/**
 * Prepara la subida de lo producido: por cada archivo, una dirección firmada que vale una
 * hora y sirve sólo para ese archivo. Quien sube no necesita ninguna cuenta: el PUT va
 * directo al almacén, sin pasar el archivo por el chat ni por este servidor. El Content-MD5
 * va dentro de la firma, así que el almacén rechaza un archivo distinto del declarado.
 *
 * Repetir el pedido no duplica: un archivo con el mismo nombre y el mismo MD5 que ya está
 * guardado en la iteración se reutiliza (`ya_guardado`), y uno pendiente igual se reemplaza.
 * La lista de subidas sigue alineada con la de archivos, una por archivo, para que un script
 * que sube todo de nuevo después de un error siga andando: la dirección de un archivo ya
 * guardado apunta al mismo objeto y, con el MD5 firmado, sólo puede escribir los mismos bytes.
 */
export async function subirProducido(agent: AgentPrincipal, iteracion: string, archivos: Array<{ nombre: string; tipo: string; tamano: number; md5: string }>) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirAlmacen();
  if (!archivos.length) throw new Error("No llegó ningún archivo.");
  const preparados = archivos.map((archivo) => {
    const nombre = nombreDeArchivo(archivo.nombre);
    if (!nombre || nombre.length > 255) throw new Error("Cada archivo necesita un nombre de hasta 255 caracteres.");
    const tipo = archivo.tipo.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(tipo) || tipo.length > 127) {
      throw new Error(`«${nombre}»: el tipo tiene que ser un tipo MIME, por ejemplo video/mp4 o image/jpeg.`);
    }
    if (!Number.isInteger(archivo.tamano) || archivo.tamano <= 0) throw new Error(`«${nombre}»: el tamaño va en bytes, mayor que cero.`);
    if (archivo.tamano > MAXIMO_POR_ARCHIVO) throw new Error(`«${nombre}» supera los 5 GB que admite una subida.`);
    const md5 = md5Normalizado(archivo.md5);
    if (!md5) throw new Error(`«${nombre}»: el MD5 va en hexadecimal (32 caracteres) o en base64.`);
    const id = randomUUID();
    return { id, nombre, tipo, tamano: archivo.tamano, md5, clave: `iteracion/${iteracion}/${id}/${nombre}` };
  });
  const { reservas, soltados } = await withTransaction(async (client) => {
    await exigirIteracionPropia(iteracion, quien, client);
    await lockAttachmentSet(client, "iteracion", iteracion);
    const reservas: Array<Awaited<ReturnType<typeof reservarSubida>>> = [];
    for (const archivo of preparados) {
      reservas.push(await reservarSubida(client, {
        id: archivo.id,
        entityKey: "iteracion",
        recordId: iteracion,
        objectKey: archivo.clave,
        nombre: archivo.nombre,
        tipo: archivo.tipo,
        tamano: archivo.tamano,
        md5: archivo.md5.hex,
        persona: quien.persona,
      }));
    }
    // Se cuenta después de reservar: lo que se reutilizó no ocupa un lugar nuevo.
    const actuales = await contarDelRegistro(client, "iteracion", iteracion);
    if (actuales > MAXIMO_PRODUCIDO_POR_ITERACION) {
      throw new Error(`Una iteración admite hasta ${MAXIMO_PRODUCIDO_POR_ITERACION} archivos de lo producido; con estos serían ${actuales}.`);
    }
    return { reservas, soltados: reservas.flatMap((reserva) => reserva.soltados) };
  });
  await borrarDelAlmacen(soltados);
  const segun = (estado: string) => [...new Set(preparados.filter((_, i) => reservas[i].estado === estado).map((a) => a.nombre))];
  const yaGuardados = segun("ya_guardado");
  const reemplazados = segun("reemplazado");
  return {
    iteracion,
    subidas: preparados.map((archivo, i) => {
      const reserva = reservas[i];
      const direccion = direccionDeSubida(reserva.objectKey, { md5Base64: archivo.md5.base64, tipo: reserva.tipo });
      return {
        id: reserva.id,
        nombre: archivo.nombre,
        metodo: "PUT",
        url: direccion.url,
        cabeceras: direccion.cabeceras,
        vence: direccion.vence,
        ...(reserva.estado === "ya_guardado" ? { ya_guardado: true } : {}),
      };
    }),
    ya_guardados: yaGuardados,
    reemplazados,
    como: [
      "Subí cada archivo con un PUT a su url, con esas cabeceras exactas y el archivo como cuerpo, desde un script o una terminal de esta máquina: no lo pases por el chat.",
      "Por ejemplo: curl -sS --fail -X PUT -H \"Content-MD5: <md5 en base64>\" -H \"Content-Type: <tipo>\" --upload-file \"<archivo>\" \"<url>\"",
      yaGuardados.length
        ? `Ya estaban guardados, con el mismo nombre y el mismo MD5, y no se duplican: ${yaGuardados.join(", ")}. No hace falta volver a subirlos; si se suben, quedan iguales.`
        : "",
      "Cuando terminen, llamá confirmar_producido con la iteración: la aplicación comprueba en el almacén que cada archivo llegó entero. Las direcciones vencen en una hora; si vence, pedí otra.",
    ].filter(Boolean).join(" "),
  };
}

/**
 * Comprueba en el almacén lo que se pidió subir: lo que llegó con el tamaño y el MD5
 * declarados queda guardado; lo que todavía no llegó sigue pendiente. Es la aplicación la
 * que comprueba: no hace falta preguntarle a nadie si lo ve.
 */
export async function confirmarProducido(agent: AgentPrincipal, iteracion: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirAlmacen();
  await exigirIteracionPropia(iteracion, quien);
  const todos = await archivosDelRegistro("iteracion", iteracion, false);
  const confirmados: string[] = [];
  const noLlegaron: string[] = [];
  const distintos: string[] = [];
  const sinComprobar: string[] = [];
  // Las consultas al almacén van en paralelo y las escrituras en una sola transacción.
  // Antes era un HEAD y una transacción por archivo, en serie: once láminas tardaban unos
  // siete segundos, y en un plan con límite de duración de funciones eso es lo que se paga.
  // Un pendiente que repite un archivo ya guardado (o a otro pendiente igual) se descarta
  // sin consultar el almacén: guardarlo dejaría el mismo archivo dos veces en lo producido.
  const { unicos: pendientes, repetidos } = separarRepetidos(
    todos.filter((a) => a.status === "guardado"),
    todos.filter((a) => a.status === "pendiente"),
  );
  const nombresRepetidos = [...new Set(repetidos.map((a) => a.original_name))];
  const consultas = await enParalelo(pendientes, 8, (archivo) => consultarObjeto(archivo.object_key));
  const guardar: typeof pendientes = [];
  const descartar: Array<{ archivo: (typeof pendientes)[number]; objeto: { tamano: number; etag: string } }> = [];
  pendientes.forEach((archivo, i) => {
    const objeto = consultas[i];
    if (!objeto) {
      noLlegaron.push(archivo.original_name);
      return;
    }
    // Una respuesta comprimida no describe los bytes guardados: no prueba que el archivo
    // sea otro, así que no se descarta. Queda pendiente y se dice por qué.
    if (objeto.alterada) {
      sinComprobar.push(archivo.original_name);
      return;
    }
    // En una subida de una vez el ETag es el MD5. Con Content-MD5 firmado no debería
    // diferir nunca; si difiere, el objeto no es el declarado y no se da por guardado.
    const mismo = objeto.tamano === archivo.size_bytes && (objeto.etag === archivo.md5 || objeto.etag.includes("-"));
    if (mismo) guardar.push(archivo);
    else descartar.push({ archivo, objeto });
  });
  const clavesRepetidas: string[] = [];
  if (guardar.length || descartar.length || repetidos.length) {
    await withTransaction(async (client) => {
      for (const { archivo } of descartar) await descartarPendiente(client, archivo.id);
      for (const archivo of repetidos) {
        const clave = await descartarPendiente(client, archivo.id);
        if (clave) clavesRepetidas.push(clave);
      }
      for (const archivo of guardar) {
        await marcarGuardado(client, archivo.id);
        await recordAuditEvent(client, {
          ...autoria({ agent, quien, client }),
          entityKey: "iteracion",
          recordId: iteracion,
          action: "attachment_create",
          changes: {
            stored: { id: archivo.id, originalName: archivo.original_name, contentType: archivo.content_type, sizeBytes: archivo.size_bytes, md5: archivo.md5 },
            source: "mcp:procesos",
          },
        });
      }
    });
  }
  confirmados.push(...guardar.map((archivo) => archivo.original_name));
  for (const { archivo, objeto } of descartar) {
    distintos.push(`${archivo.original_name} (se declararon ${archivo.size_bytes} bytes y MD5 ${archivo.md5}; el almacén tiene ${objeto.tamano} bytes y ETag ${objeto.etag || "vacía"})`);
  }
  if (descartar.length || clavesRepetidas.length) await borrarDelAlmacen([...descartar.map(({ archivo }) => archivo.object_key), ...clavesRepetidas]);
  const archivosGuardados = await archivosDelRegistro("iteracion", iteracion);
  const vistaPrevia = await vistaPreviaDesdeProducido({ agent, quien, iteracion, archivos: archivosGuardados });
  revalidateAfterWrite("iteracion", iteracion);
  const guardados = archivosGuardados.map((a) => a.original_name);
  const imagenes = (await imagenesDe(iteracion)).length;
  const falta = faltasParaCompletar(imagenes, guardados.length);
  const partes = [
    confirmados.length ? `Quedaron guardados ${confirmados.length}: ${confirmados.join(", ")}.` : "No se guardó nada nuevo.",
    nombresRepetidos.length ? `Se descartaron pedidos de subida viejos que repetían archivos ya guardados: ${nombresRepetidos.join(", ")}. Esos archivos siguen guardados una sola vez.` : "",
    noLlegaron.length ? `Todavía no llegaron: ${noLlegaron.join(", ")}. Subilos y volvé a confirmar.` : "",
    distintos.length ? `No coinciden con lo declarado y se descartaron: ${distintos.join(", ")}. Pedí la subida de nuevo con subir_producido.` : "",
    sinComprobar.length ? `No se pudieron comprobar porque el almacén respondió comprimido: ${sinComprobar.join(", ")}. Siguen pendientes; avisá a quien mantiene la aplicación.` : "",
    vistaPrevia.length ? `Quedaron como vista previa en el panel: ${vistaPrevia.join(", ")}. No hace falta adjuntarlas.` : "",
    falta.length ? `Para que la iteración quede completa falta ${falta.join(" y ")}.` : "La iteración quedó completa.",
  ];
  return { iteracion, confirmados, repetidos: nombresRepetidos, no_llegaron: noLlegaron, descartados: distintos, sin_comprobar: sinComprobar, vista_previa: vistaPrevia, guardados, falta, mensaje: partes.filter(Boolean).join(" ") };
}

/**
 * Completa la vista previa con las imágenes de lo producido que le faltan.
 *
 * Sin imágenes, toma las de lo producido. Con imágenes, sólo completa si la vista previa
 * salió de lo producido (cada imagen es copia de un archivo guardado): si se borró un archivo
 * y se volvió a subir, su lámina vuelve (2.5.6). Una vista previa elegida a mano —una
 * portada que no está en lo producido— no se toca: lo que alguien adjuntó a propósito manda.
 *
 * Antes había que mandar las láminas dos veces: con subir_producido y con
 * adjuntar_a_iteracion. El segundo paso necesita una credencial de agente guardada en la
 * máquina, que quien se conecta con su propia cuenta no tiene: subía todo y la iteración
 * quedaba incompleta igual. Las imágenes ya están en el almacén; la aplicación las copia.
 *
 * Si falla (el almacén no responde, la política no admite imágenes), no rompe la
 * confirmación: lo producido quedó guardado igual y la iteración dice qué le falta.
 */
async function vistaPreviaDesdeProducido(entrada: { agent: AgentPrincipal; quien: Identidad; iteracion: string; archivos: ArchivoGuardado[] }) {
  const politica = resolveAttachmentPolicy(requireEntity("iteracion"));
  if (!politica) return [];
  const antes = await vistaPreviaActual(null, "iteracion", entrada.iteracion);
  const elegidos = vistaPreviaQueFalta(entrada.archivos, antes.imagenes, antes.total, politica);
  if (!elegidos.length) return [];
  try {
    const contenidos = await enParalelo(elegidos, 8, (archivo) => leerObjeto(archivo.object_key));
    return await withTransaction(async (client) => {
      await lockAttachmentSet(client, "iteracion", entrada.iteracion);
      // Otra llamada pudo adjuntar mientras se bajaban: se vuelve a decidir con lo que hay ahora.
      const ahora = await vistaPreviaActual(client, "iteracion", entrada.iteracion);
      const siguenFaltando = new Set(vistaPreviaQueFalta(entrada.archivos, ahora.imagenes, ahora.total, politica).map((a) => a.id));
      const nombres: string[] = [];
      for (const [i, archivo] of elegidos.entries()) {
        if (!siguenFaltando.has(archivo.id)) continue;
        const contenido = contenidos[i];
        const sha256 = createHash("sha256").update(contenido).digest("hex");
        const id = await insertAttachment(client, {
          entityKey: "iteracion",
          recordId: entrada.iteracion,
          originalName: archivo.original_name,
          contentType: archivo.content_type.toLowerCase(),
          content: contenido,
          sha256,
          actorId: entrada.quien.persona,
        });
        await recordAuditEvent(client, {
          ...autoria({ agent: entrada.agent, quien: entrada.quien, client }),
          entityKey: "iteracion",
          recordId: entrada.iteracion,
          action: "attachment_create",
          changes: {
            attachment: { id, originalName: archivo.original_name, contentType: archivo.content_type, sizeBytes: contenido.length, sha256 },
            source: "mcp:procesos:vista-previa",
            from_stored_file: archivo.id,
          },
        });
        nombres.push(archivo.original_name);
      }
      return nombres;
    });
  } catch (error) {
    console.error("No se pudo armar la vista previa desde lo producido", entrada.iteracion, error);
    return [];
  }
}

/** Una dirección para bajar un archivo de lo producido, que vale una hora. */
export async function descargarProducido(agent: AgentPrincipal, id: string) {
  exigirAlcance(agent, "records:read");
  const quien = identidad(agent);
  exigirAlmacen();
  const archivo = await archivoPorId(id);
  // Lo que no se puede entregar responde igual que lo que no existe: no confirma que existe.
  const noEsta = new Error("Ese archivo no existe o no está a tu alcance.");
  if (!archivo || archivo.status !== "guardado") throw noEsta;
  const padre = await getRecord(archivo.entity_key, archivo.record_id, undefined, false, quien.access);
  if (!padre) throw noEsta;
  const direccion = direccionDeDescarga(archivo.object_key, { nombre: archivo.original_name, tipo: archivo.content_type });
  return { id: archivo.id, nombre: archivo.original_name, tipo: archivo.content_type, tamano: archivo.size_bytes, url: direccion.url, vence: direccion.vence };
}

/**
 * Borra un archivo de lo producido de una iteración: su fila, su objeto en el almacén y, si
 * había quedado como vista previa, el adjunto que es su copia (salvo que quede otro archivo
 * guardado igual, que sigue representándolo). Lo borra quien puede subir lo producido de esa
 * iteración: quien la hizo, quien responde por ella o quien administra. El objeto se borra
 * del almacén recién cuando la transacción se confirmó.
 */
export async function borrarProducido(agent: AgentPrincipal, id: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirAlmacen();
  // Lo que no se puede borrar responde igual que lo que no existe: no confirma que existe.
  const noEsta = new Error("Ese archivo no existe o no está a tu alcance.");
  const archivo = await archivoPorId(id);
  if (!archivo || archivo.entity_key !== "iteracion") throw noEsta;
  const iteracion = archivo.record_id;
  const soltado = await withTransaction(async (client) => {
    if (!(await getRecord("iteracion", iteracion, client, true, quien.access))) throw noEsta;
    await exigirIteracionPropia(iteracion, quien, client);
    await lockAttachmentSet(client, "iteracion", iteracion);
    const resultado = await soltarProducido(client, "iteracion", iteracion, id);
    if (!resultado) throw noEsta;
    await recordAuditEvent(client, {
      ...autoria({ agent, quien, client }),
      entityKey: "iteracion",
      recordId: iteracion,
      action: "attachment_delete",
      changes: {
        stored: {
          id: resultado.archivo.id,
          originalName: resultado.archivo.original_name,
          contentType: resultado.archivo.content_type,
          sizeBytes: resultado.archivo.size_bytes,
          md5: resultado.archivo.md5,
          status: resultado.archivo.status,
        },
        attachments: resultado.adjuntos.map((a) => ({ id: a.id, originalName: a.original_name, contentType: a.content_type, sizeBytes: Number(a.size_bytes), sha256: a.sha256 })),
        source: "procesos:borrar-producido",
      },
    });
    return resultado;
  });
  await borrarDelAlmacen([soltado.archivo.object_key]);
  revalidateAfterWrite("iteracion", iteracion);
  const nombre = soltado.archivo.original_name;
  const guardados = await archivosDelRegistro("iteracion", iteracion);
  const imagenes = (await imagenesDe(iteracion)).length;
  const falta = faltasParaCompletar(imagenes, guardados.length);
  return {
    iteracion,
    borrado: { id: soltado.archivo.id, nombre },
    vista_previa_quitada: soltado.adjuntos.map((a) => a.original_name),
    falta,
    mensaje: [
      soltado.adjuntos.length ? `Se borró «${nombre}» de lo producido y de la vista previa.` : `Se borró «${nombre}» de lo producido.`,
      falta.length ? `Para que la iteración quede completa falta ${falta.join(" y ")}.` : "",
    ].filter(Boolean).join(" "),
  };
}

// ---------------------------------------------------------------------------------------
// Recursos: lo que un proceso trae para que otra persona lo repita
// ---------------------------------------------------------------------------------------

/** Hasta 1 GB por recurso: una skill pesa kilobytes; una carpeta de modelos, decenas de megas. */
const MAXIMO_POR_RECURSO = 1024 * 1024 * 1024;

/** La versión vigente de cada recurso, con una dirección de descarga que vale una hora. */
async function recursosParaInstalar(nombres: readonly string[]) {
  if (!nombres.length || !almacenConfigurado()) return { recursos: [] as RecursoParaInstalar[], faltantes: [...nombres] };
  const vigentes = await versionesVigentes(nombres);
  const recursos: RecursoParaInstalar[] = [];
  const faltantes: string[] = [];
  for (const nombre of nombres) {
    const version = vigentes.get(nombre);
    if (!version) {
      faltantes.push(nombre);
      continue;
    }
    const descarga = direccionDeDescarga(version.object_key, { nombre: `${nombre}-${version.version}.zip`, tipo: "application/zip" });
    recursos.push({
      nombre,
      tipo: version.tipo,
      version: version.version,
      sha256: version.sha256,
      tamano: version.size_bytes,
      destino: destinoDeRecurso(version.tipo, nombre),
      url: descarga.url,
      vence: descarga.vence,
    });
  }
  return { recursos, faltantes };
}

/** Para mostrar: qué versión de cada recurso está publicada, sin direcciones de descarga. */
async function recursosPublicados(nombres: readonly string[]) {
  const vigentes = almacenConfigurado() ? await versionesVigentes(nombres).catch(() => new Map()) : new Map();
  return nombres.map((nombre) => {
    const version = vigentes.get(nombre);
    return version
      ? { nombre, tipo: version.tipo as TipoRecurso, version: version.version, tamano: version.size_bytes, publicado: version.published_at as unknown }
      : { nombre, tipo: null, version: null, tamano: null, publicado: null };
  });
}

/**
 * Prepara la publicación de una versión de un recurso: una dirección firmada para subir el
 * .zip. Sólo quien administra publica. La versión la elige quien publica —el commit de una
 * skill, un resumen del contenido de una carpeta— y no se pisa: una versión publicada es fija.
 */
export async function publicarRecurso(agent: AgentPrincipal, entrada: {
  nombre: string;
  tipo: string;
  version: string;
  tamano: number;
  md5: string;
  sha256: string;
}) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  exigirAlmacen();
  if (!NOMBRE_DE_RECURSO.test(entrada.nombre)) throw new Error("El nombre va en minúsculas, sin espacios: «carousel-builder».");
  if (!TIPOS_DE_RECURSO.includes(entrada.tipo as TipoRecurso)) throw new Error(`El tipo es ${TIPOS_DE_RECURSO.join(" o ")}.`);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(entrada.version)) throw new Error("La versión va sin espacios: un commit («ad5df58») o una fecha.");
  if (!Number.isInteger(entrada.tamano) || entrada.tamano <= 0 || entrada.tamano > MAXIMO_POR_RECURSO) throw new Error("El tamaño va en bytes, hasta 1 GB.");
  const md5 = md5Normalizado(entrada.md5);
  if (!md5) throw new Error("El MD5 va en hexadecimal (32 caracteres) o en base64.");
  const sha256 = entrada.sha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("El SHA-256 va en hexadecimal (64 caracteres).");
  const existente = await versionDeRecurso(entrada.nombre, entrada.version);
  // La versión identifica el contenido (el commit de una skill, un resumen de una carpeta); el
  // .zip de la misma versión puede diferir en fechas de archivo. Una versión publicada no se pisa.
  if (existente?.status === "publicado") {
    return { nombre: entrada.nombre, version: entrada.version, ya_publicada: true, mensaje: `La versión ${entrada.version} ya está publicada y no se pisa: no hay nada que subir. Si el contenido cambió, publicalo con otra versión.` };
  }
  const clave = `recursos/${entrada.nombre}/${entrada.version}/${entrada.nombre}.zip`;
  await insertarVersionPendiente({
    nombre: entrada.nombre,
    tipo: entrada.tipo as TipoRecurso,
    version: entrada.version,
    objectKey: clave,
    tamano: entrada.tamano,
    md5: md5.hex,
    sha256,
    persona: quien.persona,
  });
  const subida = direccionDeSubida(clave, { md5Base64: md5.base64, tipo: "application/zip" });
  return {
    nombre: entrada.nombre,
    version: entrada.version,
    ya_publicada: false,
    subida: { metodo: "PUT", url: subida.url, cabeceras: subida.cabeceras, vence: subida.vence },
    mensaje: "Subí el .zip con un PUT a esa url y esas cabeceras, y después llamá confirmar_recurso.",
  };
}

/** Comprueba en el almacén que la versión llegó entera y la deja publicada: desde ahí, es la vigente. */
export async function confirmarRecurso(agent: AgentPrincipal, nombre: string, version: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  exigirAlmacen();
  const fila = await versionDeRecurso(nombre, version);
  if (!fila) throw new Error(`No hay ninguna versión ${version} de «${nombre}». Pedila con publicar_recurso.`);
  if (fila.status === "publicado") return { nombre, version, publicado: true, mensaje: "Ya estaba publicada." };
  const objeto = await consultarObjeto(fila.object_key);
  if (!objeto) return { nombre, version, publicado: false, mensaje: "Todavía no llegó: subila y volvé a confirmar." };
  if (objeto.alterada) return { nombre, version, publicado: false, mensaje: "No se pudo comprobar: el almacén respondió comprimido. Sigue pendiente; avisá a quien mantiene la aplicación." };
  if (objeto.tamano !== fila.size_bytes || (objeto.etag !== fila.md5 && !objeto.etag.includes("-"))) {
    await descartarVersion(fila.id);
    await borrarDelAlmacen([fila.object_key]);
    throw new Error("Lo que llegó no coincide con lo declarado y se descartó. Volvé a pedirla con publicar_recurso.");
  }
  await marcarPublicada(fila.id);
  revalidateAfterWrite("proceso");
  return { nombre, version, publicado: true, mensaje: `«${nombre}» ${version} quedó publicada: es la versión que se instala desde ahora.` };
}

/** Borra una iteración, sus adjuntos y lo producido en el almacén. Lo que está en Dropbox no se toca. */
export async function borrarIteracion(agent: AgentPrincipal, iteracion: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  const claves = await withTransaction(async (client) => {
    const antes = await getRecord("iteracion", iteracion, client, true, quien.access);
    if (!antes) throw new Error("Esa iteración ya no existe.");
    const adjuntos = await deleteAttachmentsForRecord(client, "iteracion", iteracion);
    const guardados = await soltarDelRegistro(client, "iteracion", iteracion);
    await deleteRecord("iteracion", iteracion, client, quien.access);
    await recordAuditEvent(client, {
      ...autoria({ agent, quien, client }),
      entityKey: "iteracion",
      recordId: iteracion,
      action: "delete",
      changes: { before: antes, attachments: adjuntos, stored: guardados, source: "panel:procesos" },
    });
    return guardados.map((g) => g.object_key);
  });
  await borrarDelAlmacen(claves);
  revalidateAfterWrite("iteracion");
  return { mensaje: claves.length ? "Iteración borrada, con lo producido que tenía guardado." : "Iteración borrada. Lo que estaba en Dropbox sigue ahí." };
}

// ---------------------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------------------

async function cargarFamilia(agent: AgentPrincipal, proceso: string) {
  exigirAlcance(agent, "records:read");
  const quien = identidad(agent);
  const familia = await familiaPedida(proceso, quien);
  const procesos = await procesosDeLaFamilia(familia, quien);
  const actual = vigente(procesos);
  if (!actual) throw new Error(`No hay ningún proceso «${proceso}».`);
  return { quien, familia, procesos, actual, definicion: definicionDe(actual) };
}

/** Los nombres de quienes saben hacer el proceso, mirando todas sus iteraciones. */
async function quienesSabenDe(procesos: Record<string, unknown>[], quien: Identidad) {
  const registros = (await Promise.all(procesos.map((proceso) => listRecords("iteracion", {
    filters: { proceso_id: String(proceso.id) },
    sort: "created_at",
    direction: "asc",
    limit: 1000,
    access: quien.access,
  })))).flat().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const ids = quienesSaben(registros);
  const nombres = await nombresDePersonas(ids);
  return [...new Set(ids.map((id) => nombres.get(id)).filter((n): n is string => Boolean(n)))];
}

/** Todo lo de un proceso: ficha, requisitos, qué se registra, carpeta y las veces que se hizo. */
export async function iteracionesDeProceso(agent: AgentPrincipal, proceso: string, limite = 50) {
  const { quien, familia, procesos, actual, definicion } = await cargarFamilia(agent, proceso);
  const iteraciones = await iteracionesDe(procesos, quien, limite);
  return {
    familia,
    proceso: String(actual.id),
    nombre: nombreDeFamilia(actual.nombre),
    estado: String(actual.estado),
    resumen: resumenDe(actual),
    ficha: definicion.ficha ?? null,
    metodo: definicion.metodo ?? null,
    requisitos: definicion.requisitos ?? [],
    registro: definicion.registro ?? [],
    carpeta: definicion.carpeta ?? null,
    recursos: await recursosPublicados(definicion.recursos ?? []),
    // Quién ya lo hizo: a quién preguntarle. Sobre todas las iteraciones, no sobre la página.
    saben: await quienesSabenDe(procesos, quien),
    iteraciones,
  };
}

/**
 * Cómo se hace un proceso, para la IA que lo va a repetir: qué comprobar en la máquina,
 * cómo se hace, dónde guardar, qué registrar y las últimas veces que se hizo.
 */
export async function comoSeHace(agent: AgentPrincipal, proceso: string) {
  const { quien, procesos, actual, definicion } = await cargarFamilia(agent, proceso);
  if (actual.estado === "retirado") throw new Error(`«${nombreDeFamilia(actual.nombre)}» está retirado.`);
  const recientes = (await iteracionesDe(procesos, quien, 10))
    .filter((it) => !(it.origen === "reproduccion" && it.salio_igual === false) && it.receta)
    .slice(0, 3);
  const { recursos, faltantes } = await recursosParaInstalar(definicion.recursos ?? []);
  return {
    proceso: String(actual.id),
    nombre: nombreDeFamilia(actual.nombre),
    requisitos: definicion.requisitos ?? [],
    registro: definicion.registro ?? [],
    carpeta: definicion.carpeta ?? null,
    skill: definicion.ficha?.skill ?? null,
    recursos,
    recursos_faltantes: faltantes,
    guia: guiaDeProceso({
      nombre: nombreDeFamilia(actual.nombre),
      definicion,
      recientes: recientes.map((it) => ({ titulo: it.titulo, skill: it.skill, receta: it.receta, carpeta: it.carpeta, imagenes: it.imagenes })),
      almacen: almacenConfigurado(),
      recursos,
      recursosFaltantes: faltantes,
    }),
    referencias: recientes
      .filter((it) => it.imagenes.length)
      .map((it) => ({ iteracion: it.iteracion, titulo: it.titulo, imagenes: it.imagenes.map(({ id, nombre }) => ({ id, nombre })) })),
  };
}

/** Los procesos, para el panel: qué hacen, con qué skill, cuántas veces y las imágenes de la última. */
export async function familiasDeProcesos(agent: AgentPrincipal) {
  exigirAlcance(agent, "records:read");
  const quien = identidad(agent);
  const familias = new Map<string, Record<string, unknown>[]>();
  for (const proceso of await todosLosProcesos(quien)) {
    const clave = familiaDe(proceso);
    familias.set(clave, [...(familias.get(clave) ?? []), proceso]);
  }
  const iteraciones = await listRecords("iteracion", { sort: "created_at", direction: "desc", limit: 500, access: quien.access });
  return Promise.all([...familias.entries()].map(async ([clave, registros]) => {
    const actual = vigente(registros)!;
    const ids = new Set(registros.map((r) => String(r.id)));
    const propias = iteraciones.filter((it) => ids.has(String(it.proceso_id)));
    let miniaturas: Imagen[] = [];
    // Si la última iteración quedó sin imágenes, la tarjeta lo dice: es una iteración incompleta.
    let ultimaIncompleta = false;
    for (const [indice, it] of propias.slice(0, 5).entries()) {
      miniaturas = (await imagenesDe(String(it.id))).slice(0, 3);
      if (indice === 0) {
        const guardados = producidoQueCuenta(almacenConfigurado() ? await producidoDe(String(it.id)) : null, it);
        ultimaIncompleta = iteracionIncompleta(miniaturas.length, guardados);
      }
      if (miniaturas.length) break;
    }
    const definicion = definicionDe(actual);
    return {
      familia: clave,
      nombre: nombreDeFamilia(actual.nombre),
      resumen: resumenDe(actual),
      skill: definicion.ficha?.skill ?? null,
      requisitos: (definicion.requisitos ?? []).length,
      estado: String(actual.estado),
      actualizado: actual.updated_at ?? null,
      iteraciones: propias.length,
      ultima: propias[0]?.created_at ?? null,
      ultimaIncompleta,
      miniaturas,
    };
  }));
}

// ---------------------------------------------------------------------------------------
// Alta, modificación y baja de procesos
// ---------------------------------------------------------------------------------------

export type DatosDeProceso = {
  nombre: string;
  ficha: Ficha;
  metodo?: string;
  requisitos: Definicion["requisitos"];
  registro: Definicion["registro"];
  carpeta?: string;
  recursos?: string[];
};

function definicionDesdeDatos(familia: string, datos: DatosDeProceso, anterior: Record<string, unknown> = {}) {
  // Lo que traía una definición vieja (etapas, propósito) se descarta: ya no se usa.
  void anterior;
  const definicion = {
    proceso: familia,
    ficha: datos.ficha,
    ...(datos.metodo?.trim() ? { metodo: datos.metodo.trim() } : {}),
    requisitos: datos.requisitos ?? [],
    registro: datos.registro ?? [],
    ...(datos.carpeta?.trim() ? { carpeta: datos.carpeta.trim() } : {}),
    ...(datos.recursos?.length ? { recursos: datos.recursos } : {}),
  };
  const validacion = validarDefinicion(definicion);
  if (!validacion.ok) throw new Error(validacion.errores.join(" "));
  const faltas = faltasDeFicha(validacion.definicion, { almacen: almacenConfigurado() });
  if (faltas.length) throw new Error(`Al proceso le falta: ${faltas.join("; ")}.`);
  return definicion;
}

/**
 * Por qué un registro de procesos no se escribe con las herramientas genéricas
 * (create_record, update_record, delete_record o el formulario de cualquier entidad), o
 * null si se puede. Esas herramientas no saben qué tiene que tener un proceso completo ni
 * una iteración: el motor sí. Editar o borrar una iteración ya registrada sigue siendo
 * como con cualquier registro.
 */
export function motivoParaNoEscribirAMano(entidad: string, accion: "create" | "update" | "delete"): string | null {
  if (!motorDisponible()) return null;
  if (entidad === "proceso") {
    return "Los procesos no se escriben a mano: se crean con registrar_iteracion (nuevo_proceso) o desde Procesos en el panel, y se cambian con editar_proceso o desde el panel. Así quedan completos.";
  }
  if (entidad === "iteracion" && accion === "create") {
    return "Las iteraciones se registran con registrar_iteracion: es lo que comprueba que estén completas.";
  }
  return null;
}

/** Si quien opera —una persona o su agente— puede crear y cambiar procesos. */
export function administraProcesos(agent: AgentPrincipal) {
  try {
    return agent.scopes.includes("records:write") && identidad(agent).administra;
  } catch {
    return false;
  }
}

/**
 * Cambia lo que se indica de un proceso y deja el resto como está. Es lo que usa el agente
 * de quien administra para mejorarlo; el resultado tiene que quedar completo igual.
 */
export async function mejorarProceso(agent: AgentPrincipal, proceso: string, cambios: Partial<Omit<DatosDeProceso, "ficha">> & { ficha?: Partial<Ficha> }) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  const familia = await familiaPedida(proceso, quien);
  const actual = vigente(await procesosDeLaFamilia(familia, quien));
  if (!actual) throw new Error(`No hay ningún proceso «${proceso}».`);
  const definicion = definicionDe(actual);
  return editarProceso(agent, familia, {
    nombre: cambios.nombre ?? nombreDeFamilia(actual.nombre),
    ficha: { ...(definicion.ficha ?? {}), ...(cambios.ficha ?? {}) },
    metodo: cambios.metodo ?? definicion.metodo,
    requisitos: cambios.requisitos ?? definicion.requisitos,
    registro: cambios.registro ?? definicion.registro,
    carpeta: cambios.carpeta ?? definicion.carpeta,
    recursos: cambios.recursos ?? definicion.recursos,
  });
}

export async function crearProceso(agent: AgentPrincipal, datos: DatosDeProceso) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  const nombre = datos.nombre.trim();
  if (nombre.length < 3) throw new Error("El proceso necesita un nombre.");
  const familia = claveDeNombre(nombre);
  if (vigente(await procesosDeLaFamilia(familia, quien))) throw new Error(`Ya hay un proceso «${nombre}». Para cambiarlo, editalo.`);
  const definicion = definicionDesdeDatos(familia, datos);
  const id = await withTransaction((client) => crear({ agent, quien, client }, "proceso", {
    nombre,
    estado: "publicado",
    descripcion: datos.ficha.resumen ?? "",
    definicion,
  }, "panel:procesos"));
  revalidateAfterWrite("proceso", id);
  return { proceso: id, familia, mensaje: `«${nombre}» quedó creado.` };
}

/** Cambia un proceso en el lugar. El historial del método está en su skill, no acá. */
export async function editarProceso(agent: AgentPrincipal, familia: string, datos: DatosDeProceso) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  const actual = vigente(await procesosDeLaFamilia(familia, quien));
  if (!actual) throw new Error("Ese proceso no existe.");
  const definicion = definicionDesdeDatos(familia, datos, esObjeto(actual.definicion) ? actual.definicion : {});
  await withTransaction((client) => actualizarProceso({ agent, quien, client }, actual, {
    nombre: datos.nombre.trim() || nombreDeFamilia(actual.nombre),
    descripcion: datos.ficha.resumen ?? "",
    definicion,
  }));
  revalidateAfterWrite("proceso", String(actual.id));
  return { proceso: String(actual.id), mensaje: "Proceso guardado." };
}

/** Lo saca de la lista de vigentes. No borra nada: las iteraciones siguen a la vista. */
export async function retirarProceso(agent: AgentPrincipal, familia: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  const activos = (await procesosDeLaFamilia(familia, quien)).filter((p) => p.estado !== "retirado");
  if (!activos.length) throw new Error("Ya está retirado.");
  await withTransaction(async (client) => {
    for (const proceso of activos) await actualizarProceso({ agent, quien, client }, proceso, { estado: "retirado" });
  });
  revalidateAfterWrite("proceso");
  return { mensaje: `«${nombreDeFamilia(activos[0].nombre)}» quedó retirado.` };
}

export async function reactivarProceso(agent: AgentPrincipal, familia: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  const ultimo = vigente(await procesosDeLaFamilia(familia, quien));
  if (!ultimo) throw new Error("Ese proceso no existe.");
  if (ultimo.estado !== "retirado") throw new Error("No está retirado.");
  await withTransaction((client) => actualizarProceso({ agent, quien, client }, ultimo, { estado: "publicado" }));
  revalidateAfterWrite("proceso", String(ultimo.id));
  return { mensaje: `«${nombreDeFamilia(ultimo.nombre)}» volvió a estar publicado.` };
}

/**
 * Borra un proceso con todas sus iteraciones y sus archivos adjuntos. No se deshace. Lo que
 * está en Dropbox no se toca.
 */
export async function borrarProceso(agent: AgentPrincipal, familia: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  const procesos = await procesosDeLaFamilia(familia, quien);
  if (!procesos.length) throw new Error("Ese proceso no existe.");
  const nombre = nombreDeFamilia(vigente(procesos)!.nombre);
  const claves = await withTransaction(async (client) => {
    const escritura: Escritura = { agent, quien, client };
    const soltadas: string[] = [];
    for (const proceso of procesos) {
      const iteraciones = await listRecords("iteracion", { filters: { proceso_id: String(proceso.id) }, limit: 500, access: quien.access });
      for (const it of iteraciones) {
        const idIteracion = String(it.id);
        const adjuntos = await deleteAttachmentsForRecord(client, "iteracion", idIteracion);
        const guardados = await soltarDelRegistro(client, "iteracion", idIteracion);
        soltadas.push(...guardados.map((g) => g.object_key));
        await deleteRecord("iteracion", idIteracion, client, quien.access);
        await recordAuditEvent(client, { ...autoria(escritura), entityKey: "iteracion", recordId: idIteracion, action: "delete", changes: { before: it, attachments: adjuntos, stored: guardados, source: "panel:procesos" } });
      }
      const idProceso = String(proceso.id);
      await deleteRecord("proceso", idProceso, client, quien.access);
      await recordAuditEvent(client, { ...autoria(escritura), entityKey: "proceso", recordId: idProceso, action: "delete", changes: { before: proceso, source: "panel:procesos" } });
    }
    return soltadas;
  });
  await borrarDelAlmacen(claves);
  revalidateAfterWrite("proceso");
  revalidateAfterWrite("iteracion");
  return { mensaje: `«${nombre}» quedó borrado, con sus iteraciones. Lo que estaba en Dropbox sigue ahí.` };
}

export function validarProceso(definicion: unknown) {
  const validacion = validarDefinicion(definicion);
  return validacion.ok
    ? { valido: true, mensaje: "La definición es válida." }
    : { valido: false, errores: validacion.errores };
}
