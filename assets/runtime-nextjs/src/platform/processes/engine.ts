import "server-only";
import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
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
import { recordAccessForAgent, type RecordAccessContext } from "@/lib/record-access";
import { deleteRecord, getRecord, insertRecord, listRecords, recordInputFromObject, updateRecord } from "@/lib/repository";
import { revalidateAfterWrite } from "@/lib/revalidation";
import { applyRules } from "@/lib/rules";
import { getEntity, relationFields, requireEntity } from "@/lib/spec";
import type { AgentPrincipal } from "@/platform/mcp/store";
import {
  claveDeNombre,
  faltasDeFicha,
  faltasDeIteracion,
  familiaDe,
  guiaDeProceso,
  nombreDeFamilia,
  resumenCorto,
  skillDeIteracion,
  validarDefinicion,
  type Definicion,
  type Ficha,
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

async function imagenesDe(iteracion: string): Promise<Imagen[]> {
  const adjuntos = await listAttachments("iteracion", iteracion).catch(() => []);
  return adjuntos
    .filter((adjunto) => adjunto.content_type.startsWith("image/"))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.original_name.localeCompare(b.original_name))
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
  return Promise.all(registros.map(async (r) => ({
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
    imagenes: await imagenesDe(String(r.id)),
  })));
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
  carpeta: string;
  archivos: string[];
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
      throw new Error("Este proceso no existe, y crearlo lo hace quien administra. Pedile que lo cree, desde el panel o con su agente; lo producido ya está en Dropbox y se registra cuando exista.");
    }
    const familia = claveDeNombre(entrada.nuevo_proceso!.nombre);
    const existente = vigente(await procesosDeLaFamilia(familia, quien));
    if (existente) throw new Error(`Ya existe «${nombreDeFamilia(existente.nombre)}»: registralo con proceso «${nombreDeFamilia(existente.nombre)}».`);
  }

  const definicionNueva = entrada.nuevo_proceso ? definicionDesdeDatos(claveDeNombre(entrada.nuevo_proceso.nombre), entrada.nuevo_proceso) : null;
  const definicion: Definicion = proceso ? definicionDe(proceso) : (definicionNueva as Definicion);
  const faltas = faltasDeIteracion(definicion, entrada);
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
      carpeta: entrada.carpeta.trim(),
      archivos: entrada.archivos,
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
  return {
    ...resultado,
    mensaje: entrada.nuevo_proceso
      ? "Quedó registrada, y el proceso quedó creado con su ficha."
      : "Quedó registrada.",
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

/** Borra una iteración y sus archivos adjuntos. Lo que está en Dropbox no se toca. */
export async function borrarIteracion(agent: AgentPrincipal, iteracion: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  await withTransaction(async (client) => {
    const antes = await getRecord("iteracion", iteracion, client, true, quien.access);
    if (!antes) throw new Error("Esa iteración ya no existe.");
    const adjuntos = await deleteAttachmentsForRecord(client, "iteracion", iteracion);
    await deleteRecord("iteracion", iteracion, client, quien.access);
    await recordAuditEvent(client, {
      ...autoria({ agent, quien, client }),
      entityKey: "iteracion",
      recordId: iteracion,
      action: "delete",
      changes: { before: antes, attachments: adjuntos, source: "panel:procesos" },
    });
  });
  revalidateAfterWrite("iteracion");
  return { mensaje: "Iteración borrada. Lo que estaba en Dropbox sigue ahí." };
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
    // Quién ya lo hizo: a quién preguntarle.
    saben: [...new Set(iteraciones
      .filter((it) => it.salio_igual !== false && it.quien)
      .map((it) => it.quien as string))],
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
    .filter((it) => it.salio_igual !== false && it.receta)
    .slice(0, 3);
  return {
    proceso: String(actual.id),
    nombre: nombreDeFamilia(actual.nombre),
    requisitos: definicion.requisitos ?? [],
    registro: definicion.registro ?? [],
    carpeta: definicion.carpeta ?? null,
    skill: definicion.ficha?.skill ?? null,
    guia: guiaDeProceso({
      nombre: nombreDeFamilia(actual.nombre),
      definicion,
      recientes: recientes.map((it) => ({ titulo: it.titulo, skill: it.skill, receta: it.receta, carpeta: it.carpeta, imagenes: it.imagenes })),
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
    for (const it of propias.slice(0, 5)) {
      miniaturas = (await imagenesDe(String(it.id))).slice(0, 3);
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
  };
  const validacion = validarDefinicion(definicion);
  if (!validacion.ok) throw new Error(validacion.errores.join(" "));
  const faltas = faltasDeFicha(validacion.definicion);
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
  await withTransaction(async (client) => {
    const escritura: Escritura = { agent, quien, client };
    for (const proceso of procesos) {
      const iteraciones = await listRecords("iteracion", { filters: { proceso_id: String(proceso.id) }, limit: 500, access: quien.access });
      for (const it of iteraciones) {
        const idIteracion = String(it.id);
        const adjuntos = await deleteAttachmentsForRecord(client, "iteracion", idIteracion);
        await deleteRecord("iteracion", idIteracion, client, quien.access);
        await recordAuditEvent(client, { ...autoria(escritura), entityKey: "iteracion", recordId: idIteracion, action: "delete", changes: { before: it, attachments: adjuntos, source: "panel:procesos" } });
      }
      const idProceso = String(proceso.id);
      await deleteRecord("proceso", idProceso, client, quien.access);
      await recordAuditEvent(client, { ...autoria(escritura), entityKey: "proceso", recordId: idProceso, action: "delete", changes: { before: proceso, source: "panel:procesos" } });
    }
  });
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
