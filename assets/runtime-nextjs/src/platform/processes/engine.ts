import "server-only";
import type { PoolClient } from "pg";
import { generatedCapabilities, generatedPermissions } from "@/generated/permissions";
import { createHash } from "node:crypto";
import {
  contentTypeAllowed,
  countAttachments,
  insertAttachment,
  listAttachments,
  lockAttachmentSet,
  resolveAttachmentPolicy,
} from "@/lib/attachments";
import { recordAuditEvent } from "@/lib/audit";
import { sql, withTransaction } from "@/lib/db";
import { recordAccessForAgent, type RecordAccessContext } from "@/lib/record-access";
import { getRecord, insertRecord, listRecords, recordInputFromObject, updateRecord } from "@/lib/repository";
import { revalidateAfterWrite } from "@/lib/revalidation";
import { applyRules } from "@/lib/rules";
import { getEntity, relationFields, requireEntity, runtimeSpec } from "@/lib/spec";
import type { AgentPrincipal } from "@/platform/mcp/store";
import {
  claveDeNombre,
  componerGuia,
  definicionDesdeReceta,
  destinoTrasAprobar,
  destinoTrasCerrar,
  entradasFaltantes,
  etapaPorOrden,
  esEnlaceDeConversacion,
  faltasDeReceta,
  familiaDe,
  guiaDeProceso,
  herramientasQueFaltan,
  nombreDeFamilia,
  opcionesParaElegir,
  resumenCorto,
  skillDeReceta,
  puedeRevisar,
  puedeTomar,
  validarCierre,
  validarDefinicion,
  visiblesParaEtapa,
  type Definicion,
  type Destino,
  type Etapa,
  type Ficha,
  type Receta,
  type RespuestaCriterio,
} from "@/platform/processes/definition";

/**
 * El motor de procesos sobre las entidades `proceso`, `instancia` y `evento`.
 *
 * Los datos siguen siendo registros de la AppSpec: se ven en las vistas, respetan el
 * alcance por registro y dejan auditoría como cualquier otro. Lo que agrega el motor son
 * las transiciones: nadie mueve un caso editando un campo, lo mueve una operación que
 * comprueba quién la pide, en qué estado está el caso y si el trabajo cumple.
 *
 * Por eso las escrituras de acá no exigen el permiso `create`/`update` del rol sobre esas
 * entidades: la autorización es la del proceso (el grupo de la etapa, los revisores). La
 * AppSpec puede —y conviene que lo haga— dejar a los roles operativos sólo con lectura,
 * para que la única puerta para mover un caso sea esta.
 */

const ESTADOS_ACTIVOS = ["en_cola", "tomada", "esperando", "en_revision", "devuelta"] as const;

const REQUISITOS: Record<string, { campos: string[]; relaciones: string[]; opciones?: Record<string, string[]> }> = {
  proceso: { campos: ["nombre", "estado", "definicion"], relaciones: [], opciones: { estado: ["publicado"] } },
  instancia: {
    campos: ["titulo", "etapa", "estado", "tomada_por", "responde", "insumos", "resultado"],
    relaciones: ["proceso"],
    opciones: { estado: [...ESTADOS_ACTIVOS, "entregada"] },
  },
  evento: {
    campos: ["resumen", "tipo", "etapa", "autor", "salidas", "receta", "enlace"],
    relaciones: ["instancia"],
    opciones: {
      tipo: ["creada", "tomada", "liberada", "esperando", "cerrada", "revisada", "devuelta", "entregada"],
    },
  },
};

let faltantesCache: string[] | null = null;

/**
 * Qué le falta a la AppSpec para que el motor funcione. Vacío: está disponible.
 *
 * Una aplicación sin procesos no ve estas herramientas. Una que los tiene a medias recibe
 * la lista de lo que falta en vez de un error a mitad de una operación.
 */
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

const rolesDeLaAplicacion = () => runtimeSpec.roles.map((rol) => rol.key);

function rolesQueAdministran() {
  if (!generatedCapabilities) return [];
  return Object.entries(generatedCapabilities)
    .filter(([, capacidades]) => (capacidades as readonly string[]).includes("manage_users"))
    .map(([rol]) => rol);
}

type Identidad = {
  persona: string;
  roles: string[];
  administra: boolean;
  access: RecordAccessContext | undefined;
};

/**
 * Quién opera: la persona y los roles que la acotan.
 *
 * Una credencial de agente opera por su responsable, y queda limitada a lo que puedan
 * los dos: un agente no toma etapas que su dueño no podría tomar. Una credencial sin
 * responsable no opera procesos, porque todo paso de un caso tiene que tener a alguien
 * que responda por él.
 */
function identidad(agent: AgentPrincipal): Identidad {
  const persona = agent.kind === "user" ? agent.id : agent.ownerUserId;
  if (!persona) {
    throw new Error(
      "Esta credencial no tiene una persona que responda por ella, y en un proceso todo paso tiene responsable. Pedile a quien administra que le asigne una.",
    );
  }
  const roles = agent.kind === "user"
    ? [agent.roleKey]
    : [...new Set([agent.roleKey, agent.ownerRoleKey ?? agent.roleKey])];
  const administradores = rolesQueAdministran();
  return {
    persona,
    roles,
    administra: roles.every((rol) => administradores.includes(rol)),
    access: recordAccessForAgent(agent),
  };
}

function exigirAlcance(agent: AgentPrincipal, alcance: "records:read" | "records:write") {
  if (!agent.scopes.includes(alcance)) {
    throw new Error(
      alcance === "records:write"
        ? "La credencial es de sólo lectura: no puede mover casos."
        : "La credencial no tiene alcance para leer registros.",
    );
  }
}

const permisos = generatedPermissions as unknown as Record<string, Record<string, readonly string[]>>;
function rolPuedeLeer(roles: readonly string[], entidad: string) {
  return roles.every((rol) => permisos[entidad]?.[rol]?.includes("read") ?? false);
}

type Caso = {
  instancia: Record<string, unknown>;
  proceso: Record<string, unknown>;
  definicion: Definicion;
  etapa: Etapa;
};

function definicionValida(proceso: Record<string, unknown>) {
  const validacion = validarDefinicion(proceso.definicion, rolesDeLaAplicacion());
  if (!validacion.ok) {
    throw new Error(
      `La definición del proceso «${String(proceso.nombre)}» tiene errores y quien la administra tiene que corregirla: ${validacion.errores.join(" ")}`,
    );
  }
  return validacion.definicion;
}

async function cargarCaso(id: string, quien: Identidad, client?: PoolClient, bloquear = false): Promise<Caso> {
  const instancia = await getRecord("instancia", id, client, bloquear, quien.access);
  if (!instancia) throw new Error("Ese caso no existe o no está a tu alcance.");
  const proceso = await getRecord("proceso", String(instancia.proceso_id), client, false, quien.access);
  if (!proceso) throw new Error("El proceso de este caso no existe o no está a tu alcance.");
  const definicion = definicionValida(proceso);
  const etapa = etapaPorOrden(definicion, Number(instancia.etapa));
  if (!etapa) {
    throw new Error(`El caso está en la etapa ${String(instancia.etapa)}, que no existe en su proceso.`);
  }
  return { instancia, proceso, definicion, etapa };
}

async function eventosDe(id: string, quien: Identidad) {
  return listRecords("evento", {
    filters: { instancia_id: id },
    sort: "created_at",
    direction: "asc",
    limit: 500,
    access: quien.access,
  });
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
}

/** Lo que dejaron las etapas cerradas, más los insumos del pedido. Lo último pisa lo anterior. */
function acumulado(instancia: Record<string, unknown>, eventos: Record<string, unknown>[]) {
  const total: Record<string, unknown> = { insumos: esObjeto(instancia.insumos) ? instancia.insumos : {} };
  for (const evento of eventos) {
    if (evento.tipo === "cerrada" && esObjeto(evento.salidas)) Object.assign(total, evento.salidas);
    // Lo que eligió una persona al revisar queda con la clave que declaró la etapa.
    const elegida = evento.tipo === "revisada" && esObjeto(evento.salidas) ? evento.salidas.elegida : null;
    if (esObjeto(elegida) && typeof elegida.clave === "string") {
      // Quien elige puede ajustar la opción («la luz, de mañana temprano»). El ajuste viaja con
      // la elección: si quedara sólo en la bitácora, la etapa siguiente trabajaría sin él.
      const ajustes = typeof elegida.ajustes === "string" && elegida.ajustes.trim() ? elegida.ajustes : null;
      total[elegida.clave] = !ajustes
        ? elegida.valor
        : esObjeto(elegida.valor) ? { ...elegida.valor, ajustes } : { opcion: elegida.valor, ajustes };
    }
  }
  return total;
}

function ultimo(eventos: Record<string, unknown>[], tipo: string, etapa?: number) {
  for (let i = eventos.length - 1; i >= 0; i -= 1) {
    const evento = eventos[i];
    if (evento.tipo === tipo && (etapa === undefined || Number(evento.etapa) === etapa)) return evento;
  }
  return null;
}

type Escritura = { agent: AgentPrincipal; agentEventId?: string; quien: Identidad; client: PoolClient };

function autoria(escritura: Escritura) {
  return escritura.agent.kind === "user"
    ? { actorId: escritura.agent.id }
    : { agentId: escritura.agent.id, agentEventId: escritura.agentEventId || undefined };
}

async function registrarEvento(escritura: Escritura, valores: Record<string, unknown>) {
  const entidad = requireEntity("evento");
  const normalizados = recordInputFromObject(entidad, valores, "create");
  const evaluados = applyRules({ entityKey: "evento", event: "before_create", values: normalizados });
  const id = await insertRecord("evento", evaluados.values, escritura.client, escritura.quien.access);
  const despues = await getRecord("evento", id, escritura.client, false, escritura.quien.access);
  await recordAuditEvent(escritura.client, {
    ...autoria(escritura),
    entityKey: "evento",
    recordId: id,
    action: "create",
    changes: { after: despues, rules: evaluados.applied, source: "mcp:procesos" },
  });
  return id;
}

async function moverCaso(escritura: Escritura, antes: Record<string, unknown>, valores: Record<string, unknown>) {
  const entidad = requireEntity("instancia");
  const id = String(antes.id);
  const normalizados = recordInputFromObject(entidad, valores, "update");
  const evaluados = applyRules({ entityKey: "instancia", event: "before_update", values: normalizados, before: antes });
  await updateRecord("instancia", id, evaluados.values, escritura.client, escritura.quien.access);
  const despues = await getRecord("instancia", id, escritura.client, false, escritura.quien.access);
  await recordAuditEvent(escritura.client, {
    ...autoria(escritura),
    entityKey: "instancia",
    recordId: id,
    action: "update",
    changes: { before: antes, after: despues, rules: evaluados.applied, source: "mcp:procesos" },
  });
  return despues;
}

async function actualizarProceso(escritura: Escritura, antes: Record<string, unknown>, valores: Record<string, unknown>) {
  const entidad = requireEntity("proceso");
  const id = String(antes.id);
  const normalizados = recordInputFromObject(entidad, valores, "update");
  const evaluados = applyRules({ entityKey: "proceso", event: "before_update", values: normalizados, before: antes });
  await updateRecord("proceso", id, evaluados.values, escritura.client, escritura.quien.access);
  const despues = await getRecord("proceso", id, escritura.client, false, escritura.quien.access);
  await recordAuditEvent(escritura.client, {
    ...autoria(escritura),
    entityKey: "proceso",
    recordId: id,
    action: "update",
    changes: { before: antes, after: despues, rules: evaluados.applied, source: "mcp:procesos" },
  });
  revalidateAfterWrite("proceso", id);
}

async function nombresDePersonas(ids: unknown[]) {
  const validos = [...new Set(ids.filter((v): v is string => typeof v === "string"))];
  if (!validos.length) return new Map<string, string>();
  const filas = await sql<{ id: string; display_name: string | null; email: string | null }>(
    "SELECT id, display_name, email FROM app_user WHERE id = ANY($1::uuid[])",
    [validos],
  );
  return new Map(filas.map((fila) => [fila.id, fila.display_name || fila.email || fila.id]));
}

function revalidar(id?: string) {
  revalidateAfterWrite("instancia", id);
  revalidateAfterWrite("evento");
}

function etiquetaEtapa(caso: Pick<Caso, "definicion" | "etapa">) {
  return `${caso.etapa.orden} de ${caso.definicion.etapas.length} · ${caso.etapa.nombre}`;
}

/** Aplica el destino de una etapa que terminó: siguiente, revisión o entrega. */
async function aplicarDestino(
  escritura: Escritura,
  caso: Caso,
  destino: Destino,
  enlace: string | null,
) {
  if (destino.tipo === "revision") {
    await moverCaso(escritura, caso.instancia, { estado: "en_revision" });
    return { estado: "en_revision", mensaje: "Quedó en revisión. Quien revisa la aprueba o la devuelve con el motivo." };
  }
  if (destino.tipo === "siguiente") {
    await moverCaso(escritura, caso.instancia, { etapa: destino.orden, estado: "en_cola", tomada_por: null });
    const siguiente = etapaPorOrden(caso.definicion, destino.orden)!;
    return {
      estado: "en_cola",
      mensaje: `Pasó a la etapa ${destino.orden} (${siguiente.nombre}), en la cola de: ${siguiente.grupo.join(", ")}.`,
    };
  }
  await moverCaso(escritura, caso.instancia, { estado: "entregada", resultado: enlace });
  await registrarEvento(escritura, {
    resumen: "Caso entregado",
    tipo: "entregada",
    etapa: caso.etapa.orden,
    autor: escritura.quien.persona,
    enlace,
    instancia: String(caso.instancia.id),
  });
  return { estado: "entregada", mensaje: "Era la última etapa: el caso quedó entregado." };
}

function resumenDeCaso(instancia: Record<string, unknown>, proceso: Record<string, unknown>, definicion: Definicion, etapa: Etapa) {
  return {
    caso: instancia.id,
    titulo: instancia.titulo,
    proceso: proceso.nombre,
    etapa: etiquetaEtapa({ definicion, etapa }),
    ejecutor: etapa.ejecutor,
    ...(etapa.requiere?.length ? { requiere: etapa.requiere } : {}),
    estado: instancia.estado,
    actualizado: instancia.updated_at,
  };
}

// ---------------------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------------------

/**
 * `herramientas` es lo que declara tener la máquina que pregunta. Una etapa con requisitos
 * sólo aparece en disponibles si los declara todos: una IA de navegador no ve, y por lo
 * tanto no toma, una etapa que necesita renderizar video en local.
 */
export async function misPendientes(agent: AgentPrincipal, opciones: { herramientas?: readonly string[] } = {}) {
  exigirAlcance(agent, "records:read");
  const quien = identidad(agent);
  const filas = (await Promise.all(ESTADOS_ACTIVOS.map((estado) => listRecords("instancia", {
    filters: { estado },
    sort: "updated_at",
    direction: "asc",
    limit: 200,
    access: quien.access,
  })))).flat();

  const procesos = new Map<string, { registro: Record<string, unknown>; definicion: Definicion | null }>();
  const seguir: unknown[] = [];
  const revisar: unknown[] = [];
  const disponibles: unknown[] = [];
  const conProblemas: unknown[] = [];
  const administradores = rolesQueAdministran();

  for (const instancia of filas) {
    const procesoId = String(instancia.proceso_id);
    if (!procesos.has(procesoId)) {
      const registro = await getRecord("proceso", procesoId, undefined, false, quien.access);
      const validacion = registro ? validarDefinicion(registro.definicion, rolesDeLaAplicacion()) : null;
      procesos.set(procesoId, {
        registro: registro ?? { nombre: "(proceso fuera de alcance)" },
        definicion: validacion?.ok ? validacion.definicion : null,
      });
    }
    const { registro, definicion } = procesos.get(procesoId)!;
    const etapa = definicion ? etapaPorOrden(definicion, Number(instancia.etapa)) : null;
    if (!definicion || !etapa) {
      if (quien.administra) conProblemas.push({ caso: instancia.id, titulo: instancia.titulo, problema: "la definición del proceso tiene errores" });
      continue;
    }
    const resumen = resumenDeCaso(instancia, registro, definicion, etapa);
    const mia = instancia.tomada_por === quien.persona;
    if (mia && ["tomada", "esperando", "devuelta"].includes(String(instancia.estado))) seguir.push(resumen);
    else if (instancia.estado === "en_revision" && puedeRevisar(etapa, quien.roles, administradores)
      && (etapa.autorrevision || !mia)) revisar.push(resumen);
    else if (instancia.estado === "en_cola" && puedeTomar(etapa, quien.roles)
      && !herramientasQueFaltan(etapa, opciones.herramientas).length) disponibles.push(resumen);
  }

  return {
    para_seguir: seguir,
    para_revisar: revisar,
    disponibles,
    ...(conProblemas.length ? { con_problemas: conProblemas } : {}),
    como_seguir: seguir.length
      ? "Empezá por lo que ya tenés: tomar_caso con su id te devuelve la guía para retomarlo."
      : revisar.length
        ? "Hay trabajo esperando tu revisión: ver_caso muestra qué se hizo, y revisar_etapa lo aprueba o lo devuelve."
        : disponibles.length
          ? "Elegí uno de los disponibles y llamá tomar_caso: te devuelve la guía de la etapa."
          : "No hay nada pendiente para vos ahora.",
  };
}

export async function crearCaso(agent: AgentPrincipal, entrada: {
  proceso: string;
  titulo: string;
  cliente?: string;
  insumos: Record<string, unknown>;
  responde?: string;
}, agentEventId?: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  const proceso = await getRecord("proceso", entrada.proceso, undefined, false, quien.access);
  if (!proceso) throw new Error("Ese proceso no existe o no está a tu alcance.");
  if (proceso.estado !== "publicado") {
    throw new Error(`El proceso «${String(proceso.nombre)}» no está publicado: no se abren casos sobre un borrador ni sobre una versión retirada.`);
  }
  const definicion = definicionValida(proceso);
  const primera = definicion.etapas[0];
  if (!puedeTomar(primera, quien.roles) && !quien.administra) {
    throw new Error(`Los casos de este proceso los abre: ${primera.grupo.join(", ")}.`);
  }
  const faltan = entradasFaltantes(definicion, entrada.insumos);
  if (faltan.length) {
    throw new Error([
      "El pedido está incompleto y el caso no se abre hasta que esté todo. Pedile esto a quien hace el pedido:",
      ...faltan.map((falta) => `- ${falta.clave}: ${falta.descripcion}`),
    ].join("\n"));
  }

  const id = await withTransaction(async (client) => {
    const escritura: Escritura = { agent, agentEventId, quien, client };
    const valores = recordInputFromObject(requireEntity("instancia"), {
      titulo: entrada.titulo,
      proceso: entrada.proceso,
      ...(entrada.cliente ? { cliente: entrada.cliente } : {}),
      insumos: entrada.insumos,
      etapa: 1,
      estado: "en_cola",
      responde: entrada.responde ?? quien.persona,
    }, "create");
    const evaluados = applyRules({ entityKey: "instancia", event: "before_create", values: valores });
    const nuevo = await insertRecord("instancia", evaluados.values, client, quien.access);
    const despues = await getRecord("instancia", nuevo, client, false, quien.access);
    await recordAuditEvent(client, {
      ...autoria(escritura),
      entityKey: "instancia",
      recordId: nuevo,
      action: "create",
      changes: { after: despues, rules: evaluados.applied, source: "mcp:procesos" },
    });
    await registrarEvento(escritura, {
      resumen: `Caso abierto: ${entrada.titulo}`,
      tipo: "creada",
      etapa: 1,
      autor: quien.persona,
      instancia: nuevo,
    });
    return nuevo;
  });
  revalidar(id);
  return {
    caso: id,
    estado: "en_cola",
    mensaje: `Caso abierto. La primera etapa (${primera.nombre}) quedó en la cola de: ${primera.grupo.join(", ")}.`,
  };
}

async function guiaDe(caso: Caso, quien: Identidad) {
  const eventos = await eventosDe(String(caso.instancia.id), quien);
  // Una devolución sigue vigente hasta que la etapa se vuelve a cerrar: quien la retoma
  // tiene que ver el motivo aunque el caso ya figure como tomado.
  const deLaEtapa = eventos.filter((evento) => Number(evento.etapa) === caso.etapa.orden
    && (evento.tipo === "cerrada" || evento.tipo === "devuelta"));
  const ultimoDeLaEtapa = deLaEtapa[deLaEtapa.length - 1];
  const devolucion = ultimoDeLaEtapa?.tipo === "devuelta" ? ultimoDeLaEtapa : null;
  const espera = caso.instancia.estado === "esperando" ? ultimo(eventos, "esperando", caso.etapa.orden) : null;
  const motivo = (evento: Record<string, unknown> | null) => {
    if (!evento) return null;
    const salidas = esObjeto(evento.salidas) ? evento.salidas : {};
    return [String(evento.resumen ?? ""), typeof salidas.motivo === "string" ? salidas.motivo : ""]
      .filter(Boolean).filter((texto, i, todos) => todos.indexOf(texto) === i).join(" — ");
  };
  return componerGuia({
    titulo: String(caso.instancia.titulo),
    proceso: String(caso.proceso.nombre),
    definicion: caso.definicion,
    etapa: caso.etapa,
    estado: String(caso.instancia.estado),
    visibles: visiblesParaEtapa(caso.etapa, acumulado(caso.instancia, eventos)),
    devolucion: motivo(devolucion),
    espera: motivo(espera),
  });
}

export async function guiaDeEtapa(agent: AgentPrincipal, id: string) {
  exigirAlcance(agent, "records:read");
  const quien = identidad(agent);
  const caso = await cargarCaso(id, quien);
  const propia = caso.instancia.tomada_por === quien.persona;
  if (!propia && !quien.administra && !puedeTomar(caso.etapa, quien.roles)
    && !puedeRevisar(caso.etapa, quien.roles, rolesQueAdministran())) {
    throw new Error(`La etapa ${caso.etapa.orden} de este caso no es de tu grupo: la toman ${caso.etapa.grupo.join(", ")}.`);
  }
  return { caso: id, estado: caso.instancia.estado, etapa: etiquetaEtapa(caso), guia: await guiaDe(caso, quien) };
}

export async function tomarCaso(
  agent: AgentPrincipal,
  id: string,
  agentEventId?: string,
  herramientas: readonly string[] = [],
) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  const resultado = await withTransaction(async (client) => {
    const caso = await cargarCaso(id, quien, client, true);
    const estado = String(caso.instancia.estado);
    const propia = caso.instancia.tomada_por === quien.persona;
    if (estado === "en_cola") {
      if (!puedeTomar(caso.etapa, quien.roles)) {
        throw new Error(`Esta etapa (${caso.etapa.nombre}) la toman: ${caso.etapa.grupo.join(", ")}. No es de tu grupo.`);
      }
      const faltan = herramientasQueFaltan(caso.etapa, herramientas);
      if (faltan.length) {
        throw new Error(
          `Esta etapa (${caso.etapa.nombre}) se trabaja en una máquina con: ${caso.etapa.requiere!.join(", ")}. `
          + `No declaraste ${faltan.join(", ")}. Si la tenés, pasala en «herramientas»; si no, dejala para otra máquina.`,
        );
      }
    } else if (["tomada", "esperando", "devuelta"].includes(estado)) {
      if (!propia) throw new Error("Este caso lo tiene otra persona. Si quedó abandonado, quien administra puede liberarlo.");
      if (estado === "tomada") return { caso, yaEraTuyo: true };
    } else if (estado === "en_revision") {
      throw new Error("Este caso está en revisión. Se puede tomar de nuevo cuando lo aprueben o lo devuelvan.");
    } else {
      throw new Error(`Este caso está ${estado}: ya no tiene etapas para tomar.`);
    }
    const escritura: Escritura = { agent, agentEventId, quien, client };
    await moverCaso(escritura, caso.instancia, { estado: "tomada", tomada_por: quien.persona });
    await registrarEvento(escritura, {
      resumen: estado === "en_cola" ? `Tomó la etapa ${caso.etapa.nombre}` : `Retomó la etapa ${caso.etapa.nombre}`,
      tipo: "tomada",
      etapa: caso.etapa.orden,
      autor: quien.persona,
      instancia: id,
    });
    return { caso: { ...caso, instancia: { ...caso.instancia, estado: "tomada", tomada_por: quien.persona } }, yaEraTuyo: false };
  });
  revalidar(id);
  return {
    caso: id,
    estado: "tomada",
    etapa: etiquetaEtapa(resultado.caso),
    mensaje: resultado.yaEraTuyo ? "Ya lo tenías tomado." : "Lo tomaste. Seguí la guía.",
    guia: await guiaDe(resultado.caso, quien),
  };
}

async function exigirPropio(id: string, quien: Identidad, client: PoolClient, estados: string[]) {
  const caso = await cargarCaso(id, quien, client, true);
  if (caso.instancia.tomada_por !== quien.persona) {
    throw new Error("Este caso no lo tenés tomado vos. Primero tomar_caso.");
  }
  if (!estados.includes(String(caso.instancia.estado))) {
    throw new Error(`El caso está ${String(caso.instancia.estado)}: esta operación no corresponde ahora.`);
  }
  return caso;
}

export async function esperarCaso(agent: AgentPrincipal, id: string, falta: string, agentEventId?: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  await withTransaction(async (client) => {
    const caso = await exigirPropio(id, quien, client, ["tomada"]);
    const escritura: Escritura = { agent, agentEventId, quien, client };
    await moverCaso(escritura, caso.instancia, { estado: "esperando" });
    await registrarEvento(escritura, {
      resumen: `Esperando: ${falta}`.slice(0, 500),
      tipo: "esperando",
      etapa: caso.etapa.orden,
      autor: quien.persona,
      salidas: { motivo: falta },
      instancia: id,
    });
  });
  revalidar(id);
  return { caso: id, estado: "esperando", mensaje: "Quedó en espera. Para seguir cuando llegue lo que falta, tomar_caso de nuevo." };
}

export async function liberarCaso(agent: AgentPrincipal, id: string, motivo: string, agentEventId?: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  await withTransaction(async (client) => {
    const caso = await cargarCaso(id, quien, client, true);
    const propia = caso.instancia.tomada_por === quien.persona;
    if (!propia && !quien.administra) throw new Error("Sólo quien lo tiene, o quien administra, puede liberar un caso.");
    if (!["tomada", "esperando", "devuelta"].includes(String(caso.instancia.estado))) {
      throw new Error(`El caso está ${String(caso.instancia.estado)}: no hay nada que liberar.`);
    }
    const escritura: Escritura = { agent, agentEventId, quien, client };
    await moverCaso(escritura, caso.instancia, { estado: "en_cola", tomada_por: null });
    await registrarEvento(escritura, {
      resumen: `Liberó la etapa: ${motivo}`.slice(0, 500),
      tipo: "liberada",
      etapa: caso.etapa.orden,
      autor: quien.persona,
      salidas: { motivo },
      instancia: id,
    });
  });
  revalidar(id);
  return { caso: id, estado: "en_cola", mensaje: "Volvió a la cola de la etapa." };
}

export async function cerrarEtapa(agent: AgentPrincipal, id: string, cierre: {
  resumen: string;
  enlace: string;
  salidas: Record<string, unknown>;
  receta: Record<string, unknown>;
  criterios: RespuestaCriterio[];
}, agentEventId?: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  const resultado = await withTransaction(async (client) => {
    const caso = await exigirPropio(id, quien, client, ["tomada"]);
    const faltas = validarCierre(caso.etapa, cierre);
    if (faltas.length) {
      throw new Error(["La etapa todavía no cierra. Falta:", ...faltas.map((falta) => `- ${falta}`)].join("\n"));
    }
    const escritura: Escritura = { agent, agentEventId, quien, client };
    await registrarEvento(escritura, {
      resumen: cierre.resumen,
      tipo: "cerrada",
      etapa: caso.etapa.orden,
      autor: quien.persona,
      enlace: cierre.enlace,
      salidas: cierre.salidas,
      receta: { ...cierre.receta, criterios: cierre.criterios },
      instancia: id,
    });
    return aplicarDestino(escritura, caso, destinoTrasCerrar(caso.definicion, caso.etapa), cierre.enlace);
  });
  revalidar(id);
  return { caso: id, ...resultado };
}

export async function revisarEtapa(agent: AgentPrincipal, id: string, revision: {
  aprobada: boolean;
  motivo?: string;
  criterios?: RespuestaCriterio[];
  /** En una etapa que pide elegir: el número de la opción elegida, desde 1. */
  eleccion?: number;
}, agentEventId?: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  if (!revision.aprobada && !revision.motivo?.trim()) {
    throw new Error("Para devolver hay que decir el motivo: qué no cumple y qué tiene que cambiar.");
  }
  // La bitácora se lee antes de abrir la transacción: `listRecords` usa el pool, y pedir
  // una segunda conexión mientras la transacción retiene la primera se traba para siempre
  // cuando el pool es chico. El estado se vuelve a comprobar adentro, con el caso bloqueado.
  const eventos = await eventosDe(id, quien);
  const resultado = await withTransaction(async (client) => {
    const caso = await cargarCaso(id, quien, client, true);
    if (caso.instancia.estado !== "en_revision") throw new Error("Este caso no está en revisión.");
    if (!puedeRevisar(caso.etapa, quien.roles, rolesQueAdministran())) {
      const revisores = caso.etapa.revisores?.length ? caso.etapa.revisores : rolesQueAdministran();
      throw new Error(`Esta etapa la revisan: ${revisores.join(", ")}.`);
    }
    if (!caso.etapa.autorrevision && caso.instancia.tomada_por === quien.persona) {
      throw new Error("No podés aprobar ni devolver tu propio trabajo: lo revisa otra persona.");
    }
    const escritura: Escritura = { agent, agentEventId, quien, client };
    const cierre = ultimo(eventos, "cerrada", caso.etapa.orden);
    if (!revision.aprobada) {
      await moverCaso(escritura, caso.instancia, { estado: "devuelta" });
      await registrarEvento(escritura, {
        resumen: `Devuelta: ${revision.motivo}`.slice(0, 500),
        tipo: "devuelta",
        etapa: caso.etapa.orden,
        autor: quien.persona,
        salidas: { motivo: revision.motivo, criterios: revision.criterios ?? [] },
        instancia: id,
      });
      return { estado: "devuelta", mensaje: "Volvió a quien la cerró, con el motivo. La ve en sus pendientes." };
    }
    const opciones = opcionesParaElegir(caso.etapa, cierre?.salidas);
    let elegida: { clave: string; valor: unknown; opcion: number; ajustes?: string } | null = null;
    if (opciones) {
      const numero = revision.eleccion;
      if (!numero || !Number.isInteger(numero) || numero < 1 || numero > opciones.length) {
        throw new Error(`Esta etapa pide elegir una de sus ${opciones.length} opciones: pasá su número en «eleccion», de 1 a ${opciones.length}.`);
      }
      elegida = {
        clave: caso.etapa.eleccion!.guarda,
        valor: opciones[numero - 1],
        opcion: numero,
        ...(revision.motivo?.trim() ? { ajustes: revision.motivo.trim() } : {}),
      };
    }
    const titulo = (valor: unknown) => (esObjeto(valor) && typeof valor.titulo === "string" ? valor.titulo : "");
    const encabezado = elegida
      ? `Eligió la opción ${elegida.opcion}${titulo(elegida.valor) ? ` — ${titulo(elegida.valor)}` : ""}`
      : "Aprobada";
    await registrarEvento(escritura, {
      resumen: (revision.motivo?.trim() ? `${encabezado}: ${revision.motivo}` : encabezado).slice(0, 500),
      tipo: "revisada",
      etapa: caso.etapa.orden,
      autor: quien.persona,
      salidas: {
        aprobada: true,
        ...(elegida ? { elegida } : {}),
        ...(revision.motivo ? { motivo: revision.motivo } : {}),
        criterios: revision.criterios ?? [],
      },
      instancia: id,
    });
    const enlace = typeof cierre?.enlace === "string" ? cierre.enlace : null;
    const destino = await aplicarDestino(escritura, caso, destinoTrasAprobar(caso.definicion, caso.etapa), enlace);
    // Lo que registró alguien que no administra nace en borrador: aprobar su primera
    // iteración es aprobar también el proceso que propuso.
    const definicion = caso.proceso.definicion as Record<string, unknown>;
    if (caso.proceso.estado === "borrador" && definicion?.nacio_de_registro === true) {
      await actualizarProceso(escritura, caso.proceso, { estado: "publicado" });
      return { ...destino, mensaje: `${destino.mensaje} El proceso «${String(caso.proceso.nombre)}» quedó publicado.` };
    }
    return destino;
  });
  revalidar(id);
  return { caso: id, ...resultado };
}

/**
 * Lo que pasó en un caso, de principio a fin: quién hizo cada paso, cuándo, con qué y
 * dónde quedó. Es la vista de quien responde por el trabajo, no la de quien lo hace.
 */
export async function verCaso(agent: AgentPrincipal, id: string) {
  exigirAlcance(agent, "records:read");
  const quien = identidad(agent);
  if (!rolPuedeLeer(quien.roles, "evento")) throw new Error("Tu rol no puede leer la bitácora de los casos.");
  const caso = await cargarCaso(id, quien);
  const eventos = await eventosDe(id, quien);
  const ids = [...new Set(eventos.map((evento) => evento.autor).filter((v): v is string => typeof v === "string"))];
  if (typeof caso.instancia.tomada_por === "string") ids.push(caso.instancia.tomada_por);
  const nombres = new Map(
    ids.length
      ? (await sql<{ id: string; display_name: string | null; email: string | null }>(
        "SELECT id, display_name, email FROM app_user WHERE id = ANY($1::uuid[])",
        [ids],
      )).map((fila) => [fila.id, fila.display_name || fila.email || fila.id])
      : [],
  );
  const nombre = (valor: unknown) => (typeof valor === "string" ? nombres.get(valor) ?? valor : null);
  return {
    caso: id,
    titulo: caso.instancia.titulo,
    proceso: caso.proceso.nombre,
    etapa: etiquetaEtapa(caso),
    estado: caso.instancia.estado,
    tomada_por: nombre(caso.instancia.tomada_por),
    resultado: caso.instancia.resultado ?? null,
    insumos: caso.instancia.insumos ?? {},
    etapas: caso.definicion.etapas.map((etapa) => ({ orden: etapa.orden, nombre: etapa.nombre, ejecutor: etapa.ejecutor })),
    bitacora: eventos.map((evento) => ({
      fecha: evento.created_at,
      tipo: evento.tipo,
      etapa: evento.etapa,
      quien: nombre(evento.autor),
      resumen: evento.resumen,
      enlace: evento.enlace ?? null,
      ...(evento.salidas ? { salidas: evento.salidas } : {}),
      ...(evento.receta ? { receta: evento.receta } : {}),
    })),
  };
}

/**
 * Cancela un caso que ya no se va a hacer: una prueba que quedó colgada, un pedido que se
 * cayó. Lo decide quien administra y con un motivo, que queda en la bitácora. No borra
 * nada: el caso y lo que se hizo siguen a la vista, sólo que nadie lo toma ni lo revisa.
 *
 * Existe porque «Devolver» no alcanza: devolver es «corregí esto», y la máquina que recibe
 * «descartar» como motivo de devolución hace bien en preguntar qué corregir.
 */
export async function cancelarCaso(agent: AgentPrincipal, id: string, motivo: string, agentEventId?: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  if (!quien.administra) throw new Error("Cancelar un caso lo decide quien administra.");
  if (!motivo.trim()) throw new Error("Para cancelar hay que decir el motivo: queda en la bitácora.");
  const tipos = getEntity("evento")?.fields.find((campo) => campo.key === "tipo")?.options?.map((opcion) => opcion.key) ?? [];
  if (!tipos.includes("cancelada")) {
    throw new Error("Esta aplicación todavía no registra cancelaciones: hay que sumar «cancelada» a los tipos de evento en la AppSpec.");
  }
  await withTransaction(async (client) => {
    const caso = await cargarCaso(id, quien, client, true);
    const estado = String(caso.instancia.estado);
    if (estado === "entregada" || estado === "cancelada") throw new Error(`El caso ya está ${estado}: no hay nada que cancelar.`);
    const escritura: Escritura = { agent, agentEventId, quien, client };
    await moverCaso(escritura, caso.instancia, { estado: "cancelada", tomada_por: null });
    await registrarEvento(escritura, {
      resumen: `Cancelado: ${motivo}`.slice(0, 500),
      tipo: "cancelada",
      etapa: caso.etapa.orden,
      autor: quien.persona,
      salidas: { motivo, estado_anterior: estado },
      instancia: id,
    });
  });
  revalidar(id);
  return { caso: id, estado: "cancelada", mensaje: "Quedó cancelado. Lo que se hizo sigue en la bitácora." };
}

/**
 * Lo que una persona tiene para decidir, con lo necesario para decidirlo sin abrir
 * carpetas ni saber de IA: qué se pidió, qué dejó la etapa, contra qué juzgarlo y, si la
 * etapa pide elegir, las opciones.
 */
export async function decisionesPendientes(agent: AgentPrincipal) {
  const pendientes = await misPendientes(agent);
  const quien = identidad(agent);
  const decisiones = [];
  for (const resumen of pendientes.para_revisar as Array<{ caso: string }>) {
    const caso = await cargarCaso(resumen.caso, quien);
    const eventos = await eventosDe(resumen.caso, quien);
    const cierre = ultimo(eventos, "cerrada", caso.etapa.orden);
    const salidas = esObjeto(cierre?.salidas) ? cierre.salidas : {};
    const opciones = opcionesParaElegir(caso.etapa, salidas);
    decisiones.push({
      receta: esObjeto(cierre?.receta) ? cierre.receta : null,
      caso: resumen.caso,
      titulo: String(caso.instancia.titulo),
      proceso: String(caso.proceso.nombre),
      etapa: etiquetaEtapa(caso),
      insumos: esObjeto(caso.instancia.insumos) ? caso.instancia.insumos : {},
      resumen: typeof cierre?.resumen === "string" ? cierre.resumen : "",
      enlace: typeof cierre?.enlace === "string" ? cierre.enlace : null,
      cerrada: cierre?.created_at ?? null,
      juzgar: (caso.etapa.criterios ?? []).filter((criterio) => criterio.tipo === "juicio").map((criterio) => criterio.texto),
      opciones,
      // Lo demás que dejó la etapa, sin repetir las opciones.
      // «origen» es interno: dice si la iteración se registró o se reprodujo, no es algo a juzgar.
      salidas: Object.fromEntries(Object.entries(salidas).filter(([clave]) => clave !== caso.etapa.eleccion?.opciones && clave !== "origen")),
    });
  }
  return decisiones;
}

// ---------------------------------------------------------------------------------------
// Iteraciones: lo que salió bien, y cómo se hizo
// ---------------------------------------------------------------------------------------

function esUrlWeb(valor: unknown) {
  if (typeof valor !== "string") return false;
  try {
    const url = new URL(valor);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function procesosDeLaFamilia(familia: string, quien: Identidad) {
  const todos = await listRecords("proceso", { sort: "updated_at", direction: "desc", limit: 500, access: quien.access });
  return todos.filter((proceso) => familiaDe(proceso) === familia);
}

function versionDe(proceso: Record<string, unknown>) {
  const numero = Number(proceso.version);
  return Number.isFinite(numero) ? numero : 0;
}

/** La versión publicada más alta de una familia, o null si no hay ninguna publicada. */
function vigente(procesos: Record<string, unknown>[]) {
  return procesos
    .filter((proceso) => proceso.estado === "publicado")
    .sort((a, b) => versionDe(b) - versionDe(a))[0] ?? null;
}

async function familiaPedida(proceso: string, quien: Identidad) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proceso)) {
    const registro = await getRecord("proceso", proceso, undefined, false, quien.access);
    if (!registro) throw new Error("Ese proceso no existe o no está a tu alcance.");
    return familiaDe(registro);
  }
  return claveDeNombre(proceso);
}

export type Reproduccion = { salio_igual: boolean; que_falto?: string };

/**
 * Registra algo que salió bien —o la prueba de reproducir una receta— como iteración de
 * un proceso, con cómo se hizo y la conversación donde se hizo.
 *
 * Si el proceso no existe, este registro lo crea como v1, con la receta como
 * instrucciones. Lo que registra quien administra queda entregado; lo que registra otra
 * persona queda para que lo apruebe quien administra (y, si creó un proceso, el proceso
 * nace en borrador y se publica con esa aprobación). Una reproducción no se aprueba: es una
 * prueba de la receta, y vale tanto si salió igual como si no.
 */
export async function registrarIteracion(agent: AgentPrincipal, entrada: {
  proceso?: string;
  nuevo_proceso?: { nombre: string; proposito: string; donde?: string };
  titulo: string;
  resultado: string;
  conversacion?: string;
  receta: Receta;
  reproduccion?: Reproduccion;
}, agentEventId?: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  const faltas = faltasDeReceta(entrada.receta);
  if (!esUrlWeb(entrada.resultado)) faltas.unshift("resultado: la dirección (https://…) de lo que quedó bien, en la carpeta compartida.");
  if (entrada.conversacion !== undefined && entrada.conversacion !== "" && !esEnlaceDeConversacion(entrada.conversacion)) {
    faltas.push("conversacion: tiene que ser la dirección de la conversación (https://… o claude://…).");
  }
  if (entrada.reproduccion && !entrada.reproduccion.salio_igual && !entrada.reproduccion.que_falto?.trim()) {
    faltas.push("reproduccion.que_falto: si no salió igual, qué faltó o qué cambió respecto de la receta.");
  }
  if (!entrada.proceso && !entrada.nuevo_proceso) faltas.push("proceso: el id del proceso, o nuevo_proceso si es la primera vez.");
  if (entrada.proceso && entrada.nuevo_proceso) faltas.push("proceso y nuevo_proceso: es uno u otro.");
  if (entrada.reproduccion && entrada.nuevo_proceso) faltas.push("reproduccion: sólo se reproduce un proceso que ya existe.");
  if (faltas.length) throw new Error(["No se registró. Falta:", ...faltas.map((falta) => `- ${falta}`)].join("\n"));

  const administradores = rolesQueAdministran();
  let proceso: Record<string, unknown> | null = null;
  let definicionNueva: ReturnType<typeof definicionDesdeReceta> | null = null;
  if (entrada.proceso) {
    proceso = await getRecord("proceso", entrada.proceso, undefined, false, quien.access);
    if (!proceso) throw new Error("Ese proceso no existe o no está a tu alcance.");
  } else {
    const nuevo = entrada.nuevo_proceso!;
    const familia = claveDeNombre(nuevo.nombre);
    const existentes = await procesosDeLaFamilia(familia, quien);
    if (existentes.length) {
      const ultimo = existentes.sort((a, b) => versionDe(b) - versionDe(a))[0];
      throw new Error(`Ya existe «${nombreDeFamilia(ultimo.nombre)}» (id ${String(ultimo.id)}): registralo como iteración de ese proceso, con «proceso».`);
    }
    definicionNueva = definicionDesdeReceta({
      nombre: nuevo.nombre,
      proposito: nuevo.proposito,
      receta: entrada.receta,
      roles: [...quien.roles, ...administradores],
      revisores: administradores.length ? administradores : quien.roles,
      donde: nuevo.donde,
    });
    const validacion = validarDefinicion(definicionNueva, rolesDeLaAplicacion());
    if (!validacion.ok) throw new Error(`La receta no forma un proceso válido: ${validacion.errores.join(" ")}`);
  }

  const directo = quien.administra || Boolean(entrada.reproduccion);
  const resultado = await withTransaction(async (client) => {
    const escritura: Escritura = { agent, agentEventId, quien, client };
    if (definicionNueva) {
      const valores = recordInputFromObject(requireEntity("proceso"), {
        nombre: entrada.nuevo_proceso!.nombre.trim(),
        version: 1,
        estado: quien.administra ? "publicado" : "borrador",
        descripcion: entrada.nuevo_proceso!.proposito,
        definicion: definicionNueva,
      }, "create");
      const evaluados = applyRules({ entityKey: "proceso", event: "before_create", values: valores });
      const nuevoId = await insertRecord("proceso", evaluados.values, client, quien.access);
      proceso = await getRecord("proceso", nuevoId, client, false, quien.access);
      await recordAuditEvent(client, {
        ...autoria(escritura),
        entityKey: "proceso",
        recordId: nuevoId,
        action: "create",
        changes: { after: proceso, rules: evaluados.applied, source: "mcp:procesos" },
      });
    }
    const definicion = definicionValida(proceso!);
    const ultima = definicion.etapas[definicion.etapas.length - 1];
    const origen = entrada.reproduccion ? "reproduccion" : "descubrimiento";
    const insumos = {
      origen,
      ...(entrada.conversacion ? { conversacion: entrada.conversacion } : {}),
      ...(entrada.reproduccion ? { reproduccion: entrada.reproduccion } : {}),
    };
    const valores = recordInputFromObject(requireEntity("instancia"), {
      titulo: entrada.titulo,
      proceso: String(proceso!.id),
      insumos,
      etapa: ultima.orden,
      estado: "en_revision",
      tomada_por: quien.persona,
      responde: quien.persona,
    }, "create");
    const evaluados = applyRules({ entityKey: "instancia", event: "before_create", values: valores });
    const id = await insertRecord("instancia", evaluados.values, client, quien.access);
    const instancia = await getRecord("instancia", id, client, false, quien.access);
    await recordAuditEvent(client, {
      ...autoria(escritura),
      entityKey: "instancia",
      recordId: id,
      action: "create",
      changes: { after: instancia, rules: evaluados.applied, source: "mcp:procesos" },
    });
    await registrarEvento(escritura, {
      resumen: `${origen === "reproduccion" ? "Reproducción" : "Registrada"}: ${entrada.titulo}`.slice(0, 500),
      tipo: "creada",
      etapa: ultima.orden,
      autor: quien.persona,
      instancia: id,
    });
    const reproduccion = entrada.reproduccion;
    const resumen = !reproduccion
      ? `Así se hizo: ${entrada.titulo}`
      : reproduccion.salio_igual
        ? `Se reprodujo y salió igual: ${entrada.titulo}`
        : `Se reprodujo y no salió igual: ${reproduccion.que_falto}`;
    await registrarEvento(escritura, {
      resumen: resumen.slice(0, 500),
      tipo: "cerrada",
      etapa: ultima.orden,
      autor: quien.persona,
      enlace: entrada.resultado,
      salidas: insumos,
      receta: entrada.receta,
      instancia: id,
    });
    if (!directo) {
      return { iteracion: id, proceso: String(proceso!.id), estado: "en_revision", mensaje: "Quedó registrada, para que la apruebe quien administra." };
    }
    const caso: Caso = { instancia: instancia!, proceso: proceso!, definicion, etapa: ultima };
    await aplicarDestino(escritura, caso, { tipo: "entrega" }, entrada.resultado);
    return { iteracion: id, proceso: String(proceso!.id), estado: "entregada", mensaje: "Quedó registrada." };
  });
  revalidar(resultado.iteracion);
  revalidateAfterWrite("proceso", resultado.proceso);
  return {
    ...resultado,
    ...(definicionNueva ? { proceso_nuevo: true, mensaje: `${resultado.mensaje} El proceso quedó creado${quien.administra ? "" : ", en borrador hasta esa aprobación"}.` } : {}),
  };
}

type Imagen = { id: string; nombre: string; tipo: string };

/** Las imágenes adjuntas a un caso, en el orden en que se subieron. */
async function imagenesDe(caso: string): Promise<Imagen[]> {
  const adjuntos = await listAttachments("instancia", caso).catch(() => []);
  return adjuntos
    .filter((adjunto) => adjunto.content_type.startsWith("image/"))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.original_name.localeCompare(b.original_name))
    .map((adjunto) => ({ id: adjunto.id, nombre: adjunto.original_name, tipo: adjunto.content_type }));
}

/**
 * Adjunta archivos a un caso —las láminas de un carrusel, la portada de un video— para que
 * el resultado se vea en Operación y otra IA lo pueda mirar con read_attachment.
 *
 * Lo pesado sigue en la carpeta compartida: esto es para lo liviano que hace falta ver. No
 * pasa por el permiso de editar casos, que es del motor: adjunta quien lo hizo, quien
 * responde por él o quien administra.
 */
export async function adjuntarACaso(agent: AgentPrincipal, caso: string, archivos: Array<{
  nombre: string;
  tipo: string;
  contenido: Buffer;
}>) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  const entidad = requireEntity("instancia");
  const politica = resolveAttachmentPolicy(entidad);
  if (!politica) throw new Error("Esta aplicación no admite archivos en los casos. Hay que habilitarlos en la AppSpec.");
  if (!archivos.length) throw new Error("No llegó ningún archivo.");
  for (const archivo of archivos) {
    const nombre = archivo.nombre.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!nombre || nombre.length > 255) throw new Error("Cada archivo necesita un nombre de hasta 255 caracteres.");
    if (!archivo.contenido.length) throw new Error(`«${nombre}» está vacío.`);
    if (archivo.contenido.length > politica.maxSizeBytes) {
      throw new Error(`«${nombre}» supera el máximo de ${Math.floor(politica.maxSizeBytes / 1024 / 1024)} MB por archivo.`);
    }
    if (!contentTypeAllowed(archivo.tipo.toLowerCase(), politica.allowedTypes)) {
      throw new Error(`«${nombre}» es ${archivo.tipo}, y en los casos se admite: ${politica.allowedTypes.join(", ")}.`);
    }
    archivo.nombre = nombre;
  }
  const ids = await withTransaction(async (client) => {
    const instancia = await getRecord("instancia", caso, client, true, quien.access);
    if (!instancia) throw new Error("Ese caso no existe o no está a tu alcance.");
    const propio = instancia.tomada_por === quien.persona || instancia.responde === quien.persona;
    if (!propio && !quien.administra) throw new Error("Adjunta quien hizo el caso, quien responde por él o quien administra.");
    await lockAttachmentSet(client, "instancia", caso);
    const actuales = await countAttachments(client, "instancia", caso);
    if (actuales + archivos.length > politica.maxFiles) {
      throw new Error(`Un caso admite hasta ${politica.maxFiles} archivos y este ya tiene ${actuales}.`);
    }
    const escritura: Escritura = { agent, quien, client };
    const nuevos: string[] = [];
    for (const archivo of archivos) {
      const sha256 = createHash("sha256").update(archivo.contenido).digest("hex");
      const id = await insertAttachment(client, {
        entityKey: "instancia",
        recordId: caso,
        originalName: archivo.nombre,
        contentType: archivo.tipo.toLowerCase(),
        content: archivo.contenido,
        sha256,
        actorId: quien.persona,
      });
      await recordAuditEvent(client, {
        ...autoria(escritura),
        entityKey: "instancia",
        recordId: caso,
        action: "attachment_create",
        changes: { attachment: { id, originalName: archivo.nombre, contentType: archivo.tipo, sizeBytes: archivo.contenido.length, sha256 }, source: "mcp:procesos" },
      });
      nuevos.push(id);
    }
    return nuevos;
  });
  revalidar(caso);
  return { caso, adjuntados: ids.length, archivos: ids, mensaje: `Quedaron ${ids.length} archivo${ids.length === 1 ? "" : "s"} en el caso.` };
}

type Iteracion = {
  iteracion: string;
  titulo: string;
  estado: string;
  fecha: unknown;
  quien: string | null;
  persona: string | null;
  /** Con qué skill y versión se hizo, si la receta lo dice. */
  skill: string | null;
  imagenes: Imagen[];
  origen: string;
  resultado: string | null;
  conversacion: string | null;
  reproduccion: Reproduccion | null;
  receta: Record<string, unknown> | null;
};

/**
 * Si un caso cuenta como iteración: terminó, o espera la aprobación que lo termina.
 *
 * Un caso en revisión a mitad del proceso —la etapa 4 de 6— todavía no es una vez que se
 * hizo: es trabajo en curso. Cuenta si se registró (trae «origen») o si la revisión que
 * espera es la de su última etapa.
 */
function esIteracion(caso: Record<string, unknown>, ultimaEtapa: number | undefined) {
  if (caso.estado === "entregada") return true;
  if (caso.estado !== "en_revision") return false;
  const insumos = esObjeto(caso.insumos) ? caso.insumos : {};
  return typeof insumos.origen === "string" || (ultimaEtapa !== undefined && Number(caso.etapa) === ultimaEtapa);
}

function ultimaEtapaDe(proceso: Record<string, unknown>) {
  const definicion = esObjeto(proceso.definicion) ? proceso.definicion : {};
  const etapas = Array.isArray(definicion.etapas) ? definicion.etapas : [];
  const ordenes = etapas.map((etapa) => Number((etapa as Record<string, unknown>)?.orden)).filter(Number.isFinite);
  return ordenes.length ? Math.max(...ordenes) : undefined;
}

/** Las iteraciones de toda la familia de un proceso, de la más reciente a la más vieja. */
async function iteracionesDeFamilia(procesos: Record<string, unknown>[], quien: Identidad, limite = 100): Promise<Iteracion[]> {
  const ultima = new Map(procesos.map((proceso) => [String(proceso.id), ultimaEtapaDe(proceso)]));
  const casos = (await Promise.all(procesos.map((proceso) => listRecords("instancia", {
    filters: { proceso_id: String(proceso.id) },
    sort: "created_at",
    direction: "desc",
    limit: limite,
    access: quien.access,
  })))).flat()
    .filter((caso) => esIteracion(caso, ultima.get(String(caso.proceso_id))))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limite);
  const nombres = await nombresDePersonas(casos.map((caso) => caso.tomada_por ?? caso.responde));
  const iteraciones: Iteracion[] = [];
  for (const caso of casos) {
    const eventos = await eventosDe(String(caso.id), quien);
    const cierre = ultimo(eventos, "cerrada");
    const insumos = esObjeto(caso.insumos) ? caso.insumos : {};
    const persona = (caso.tomada_por ?? caso.responde) as string | undefined;
    iteraciones.push({
      iteracion: String(caso.id),
      titulo: String(caso.titulo),
      estado: String(caso.estado),
      fecha: caso.created_at,
      quien: persona ? nombres.get(persona) ?? persona : null,
      persona: persona ?? null,
      skill: skillDeReceta(cierre?.receta),
      imagenes: await imagenesDe(String(caso.id)),
      origen: typeof insumos.origen === "string" ? insumos.origen : "caso",
      resultado: typeof caso.resultado === "string" ? caso.resultado : typeof cierre?.enlace === "string" ? cierre.enlace : null,
      conversacion: esEnlaceDeConversacion(insumos.conversacion) ? String(insumos.conversacion) : null,
      reproduccion: esObjeto(insumos.reproduccion) ? insumos.reproduccion as Reproduccion : null,
      receta: esObjeto(cierre?.receta) ? cierre.receta : null,
    });
  }
  return iteraciones;
}

const ESTADO_LEGIBLE: Record<string, string> = {
  en_cola: "En cola",
  tomada: "Tomado",
  esperando: "Esperando",
  en_revision: "En revisión",
  devuelta: "Devuelto",
};

/** Los casos abiertos de una familia que todavía no son una iteración: trabajo en curso. */
async function enCursoDeFamilia(procesos: Record<string, unknown>[], quien: Identidad) {
  const porId = new Map(procesos.map((proceso) => [String(proceso.id), proceso]));
  const casos = (await Promise.all(procesos.flatMap((proceso) => ESTADOS_ACTIVOS.map((estado) => listRecords("instancia", {
    filters: { proceso_id: String(proceso.id), estado },
    sort: "updated_at",
    direction: "desc",
    limit: 100,
    access: quien.access,
  }))))).flat();
  const abiertos = casos.filter((caso) => !esIteracion(caso, ultimaEtapaDe(porId.get(String(caso.proceso_id)) ?? {})));
  const nombres = await nombresDePersonas(abiertos.map((caso) => caso.tomada_por));
  return abiertos
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .map((caso) => {
      const proceso = porId.get(String(caso.proceso_id)) ?? {};
      const validacion = validarDefinicion(proceso.definicion, rolesDeLaAplicacion());
      const etapa = validacion.ok ? etapaPorOrden(validacion.definicion, Number(caso.etapa)) : null;
      const total = validacion.ok ? validacion.definicion.etapas.length : null;
      return {
        caso: String(caso.id),
        titulo: String(caso.titulo),
        etapa: etapa ? `${etapa.orden}${total ? ` de ${total}` : ""} · ${etapa.nombre}` : `Etapa ${String(caso.etapa)}`,
        estado: ESTADO_LEGIBLE[String(caso.estado)] ?? String(caso.estado),
        quien: typeof caso.tomada_por === "string" ? nombres.get(caso.tomada_por) ?? null : null,
        actualizado: caso.updated_at,
      };
    });
}

/** La ficha de un proceso, si su definición la trae: sólo los campos con contenido. */
function fichaDe(proceso: Record<string, unknown>): Ficha | null {
  const definicion = esObjeto(proceso.definicion) ? proceso.definicion : {};
  return esObjeto(definicion.ficha) ? definicion.ficha as Ficha : null;
}

export async function iteracionesDeProceso(agent: AgentPrincipal, proceso: string, limite = 50) {
  exigirAlcance(agent, "records:read");
  const quien = identidad(agent);
  const familia = await familiaPedida(proceso, quien);
  const procesos = await procesosDeLaFamilia(familia, quien);
  if (!procesos.length) throw new Error(`No hay ningún proceso «${proceso}».`);
  const actual = vigente(procesos) ?? procesos[0];
  const iteraciones = await iteracionesDeFamilia(procesos, quien, limite);
  const definicion = esObjeto(actual.definicion) ? actual.definicion : {};
  return {
    familia,
    nombre: nombreDeFamilia(actual.nombre),
    ficha: fichaDe(actual),
    resumen: fichaDe(actual)?.resumen ?? resumenCorto(definicion.proposito ?? actual.descripcion, 220),
    // Quién ya lo hizo bien: a quién preguntarle.
    saben: [...new Set(iteraciones
      .filter((it) => it.estado === "entregada" && it.reproduccion?.salio_igual !== false && it.quien)
      .map((it) => it.quien as string))],
    // El registro que se muestra y se edita. Un proceso es uno solo: lo que cambia en el
    // método queda en el historial de su skill, no en versiones acá.
    vigente: { id: actual.id, estado: actual.estado },
    retirado: procesos.every((p) => p.estado === "retirado"),
    iteraciones,
    en_curso: await enCursoDeFamilia(procesos, quien),
  };
}

/**
 * Cómo se hace un proceso, sin abrir un caso: su guía y la receta de las
 * últimas veces que salió bien. Es lo que lee la IA de otra persona, en otra máquina,
 * para hacerlo igual.
 */
export async function comoSeHace(agent: AgentPrincipal, proceso: string) {
  exigirAlcance(agent, "records:read");
  const quien = identidad(agent);
  const familia = await familiaPedida(proceso, quien);
  const procesos = await procesosDeLaFamilia(familia, quien);
  const actual = vigente(procesos);
  if (!actual) {
    throw new Error(procesos.length
      ? `«${nombreDeFamilia(procesos[0].nombre)}» no está publicado.`
      : `No hay ningún proceso «${proceso}».`);
  }
  const definicion = definicionValida(actual);
  const buenas = (await iteracionesDeFamilia(procesos, quien, 20))
    .filter((it) => it.estado === "entregada" && it.reproduccion?.salio_igual !== false && it.receta)
    .slice(0, 3);
  return {
    proceso: actual.id,
    nombre: nombreDeFamilia(actual.nombre),
    guia: guiaDeProceso({
      nombre: nombreDeFamilia(actual.nombre),
      definicion,
      recientes: buenas.map((it) => ({ titulo: it.titulo, fecha: it.fecha, receta: it.receta, resultado: it.resultado, imagenes: it.imagenes })),
    }),
    // Lo que la IA tiene que mirar: las imágenes de las últimas veces que salió bien.
    referencias: buenas
      .filter((it) => it.imagenes.length)
      .map((it) => ({ iteracion: it.iteracion, titulo: it.titulo, imagenes: it.imagenes.map(({ id, nombre }) => ({ id, nombre })) })),
  };
}

/** Los procesos, para el panel: su ficha, cuántas iteraciones y la última. */
export async function familiasDeProcesos(agent: AgentPrincipal) {
  exigirAlcance(agent, "records:read");
  const quien = identidad(agent);
  const procesos = await listRecords("proceso", { sort: "updated_at", direction: "desc", limit: 500, access: quien.access });
  const casos = await listRecords("instancia", { sort: "created_at", direction: "desc", limit: 500, access: quien.access });
  const familias = new Map<string, Record<string, unknown>[]>();
  for (const proceso of procesos) {
    const clave = familiaDe(proceso);
    familias.set(clave, [...(familias.get(clave) ?? []), proceso]);
  }
  const resumenes = [...familias.entries()].map(([clave, versiones]) => {
    const ultima = new Map(versiones.map((v) => [String(v.id), ultimaEtapaDe(v)]));
    const propios = casos.filter((caso) => ultima.has(String(caso.proceso_id)) && esIteracion(caso, ultima.get(String(caso.proceso_id))));
    const enCurso = casos.filter((caso) => ultima.has(String(caso.proceso_id))
      && (ESTADOS_ACTIVOS as readonly string[]).includes(String(caso.estado))
      && !esIteracion(caso, ultima.get(String(caso.proceso_id)))).length;
    const actual = vigente(versiones) ?? versiones.sort((a, b) => versionDe(b) - versionDe(a))[0];
    const definicion = esObjeto(actual.definicion) ? actual.definicion : {};
    return {
      familia: clave,
      nombre: nombreDeFamilia(actual.nombre),
      // Una línea para la tarjeta: la de la ficha, o la primera oración del propósito.
      resumen: fichaDe(actual)?.resumen ?? resumenCorto(definicion.proposito ?? actual.descripcion),
      skill: fichaDe(actual)?.skill ?? null,
      // Los casos donde buscar la portada: las últimas iteraciones, de la más nueva a la más vieja.
      candidatos: propios.slice(0, 5).map((caso) => String(caso.id)),
      estado: String(actual.estado),
      actualizado: actual.updated_at ?? null,
      iteraciones: propios.length,
      en_curso: enCurso,
      ultima: propios[0]?.created_at ?? null,
    };
  }).sort((a, b) => String(b.ultima ?? "").localeCompare(String(a.ultima ?? "")));
  // La portada de cada tarjeta: las primeras imágenes de la iteración más reciente que tenga.
  return Promise.all(resumenes.map(async ({ candidatos, ...familia }) => {
    let miniaturas: Imagen[] = [];
    for (const caso of candidatos) {
      miniaturas = (await imagenesDe(caso)).slice(0, 3);
      if (miniaturas.length) break;
    }
    return { ...familia, miniaturas };
  }));
}

// ---------------------------------------------------------------------------------------
// Alta, modificación y baja de procesos desde el panel
// ---------------------------------------------------------------------------------------

function exigirQueAdministre(quien: Identidad) {
  if (!quien.administra) throw new Error("Los procesos los da de alta, modifica y retira quien administra.");
}

async function insertarProceso(escritura: Escritura, valores: Record<string, unknown>) {
  const entidad = requireEntity("proceso");
  const normalizados = recordInputFromObject(entidad, valores, "create");
  const evaluados = applyRules({ entityKey: "proceso", event: "before_create", values: normalizados });
  const id = await insertRecord("proceso", evaluados.values, escritura.client, escritura.quien.access);
  const despues = await getRecord("proceso", id, escritura.client, false, escritura.quien.access);
  await recordAuditEvent(escritura.client, {
    ...autoria(escritura),
    entityKey: "proceso",
    recordId: id,
    action: "create",
    changes: { after: despues, rules: evaluados.applied, source: "panel:procesos" },
  });
  return id;
}

/**
 * Da de alta un proceso desde el panel: su ficha y una etapa que se hace con la skill que la
 * ficha nombra. Nace publicado. Lo que el proceso tiene de método vive en la skill;
 * acá queda lo que una persona necesita para saber cómo se hace y pedirlo.
 */
export async function crearProceso(agent: AgentPrincipal, datos: { nombre: string; ficha: Ficha; instrucciones?: string }) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  const nombre = datos.nombre.trim();
  if (nombre.length < 3) throw new Error("El proceso necesita un nombre.");
  const familia = claveDeNombre(nombre);
  if ((await procesosDeLaFamilia(familia, quien)).length) {
    throw new Error(`Ya hay un proceso «${nombre}». Para cambiarlo, editá su ficha.`);
  }
  const administradores = rolesQueAdministran();
  const skill = datos.ficha.skill?.nombre;
  const definicion = {
    proceso: familia,
    ficha: datos.ficha,
    proposito: datos.ficha.resumen ?? nombre,
    etapas: [{
      orden: 1,
      clave: "hacerlo",
      nombre: "Hacerlo",
      ejecutor: "cualquiera",
      grupo: rolesDeLaAplicacion(),
      instrucciones: datos.instrucciones?.trim()
        || (skill ? `Se hace con la skill ${skill}: seguila. Al terminar, registralo con registrar_iteracion.` : "Seguí la ficha del proceso. Al terminar, registralo con registrar_iteracion."),
      revision: "humana",
      revisores: administradores.length ? administradores : quien.roles,
      autorrevision: true,
    }],
  };
  const validacion = validarDefinicion(definicion, rolesDeLaAplicacion());
  if (!validacion.ok) throw new Error(validacion.errores.join(" "));
  const id = await withTransaction((client) => insertarProceso({ agent, quien, client }, {
    nombre,
    version: 1,
    estado: "publicado",
    descripcion: datos.ficha.resumen ?? "",
    definicion,
  }));
  revalidateAfterWrite("proceso", id);
  return { proceso: id, familia, mensaje: `«${nombre}» quedó publicado.` };
}

/**
 * Modifica un proceso: cambia su ficha en el lugar. Un proceso es un solo registro y siempre
 * muestra lo vigente, para que quien lo tome no tenga que elegir entre versiones. Cómo cambió
 * el método queda en el historial de su skill, y cada iteración dice con cuál se hizo. La
 * guía para la IA y las etapas pasan sin cambios.
 */
export async function editarProceso(agent: AgentPrincipal, familia: string, datos: { nombre?: string; ficha: Ficha }) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  const procesos = await procesosDeLaFamilia(familia, quien);
  const actual = vigente(procesos) ?? [...procesos].sort((a, b) => versionDe(b) - versionDe(a))[0];
  if (!actual) throw new Error("Ese proceso no existe.");
  const nombre = (datos.nombre?.trim() || nombreDeFamilia(actual.nombre));
  const anterior = esObjeto(actual.definicion) ? actual.definicion : {};
  // La clave de la familia queda fija: así renombrar no la parte en dos.
  const definicion = { ...anterior, proceso: familia, ficha: datos.ficha };
  const validacion = validarDefinicion(definicion, rolesDeLaAplicacion());
  if (!validacion.ok) throw new Error(validacion.errores.join(" "));
  const id = String(actual.id);
  await withTransaction((client) => actualizarProceso({ agent, quien, client }, actual, {
    nombre,
    descripcion: datos.ficha.resumen ?? (typeof actual.descripcion === "string" ? actual.descripcion : ""),
    definicion,
  }));
  revalidateAfterWrite("proceso", id);
  return { proceso: id, mensaje: "Ficha guardada." };
}

/**
 * Da de baja un proceso: retira todos sus registros. No borra nada —las iteraciones y su
 * bitácora siguen a la vista—, pero ya no se abren casos ni aparece entre los vigentes.
 * No se retira con casos en curso: primero se terminan o se cancelan.
 */
export async function retirarProceso(agent: AgentPrincipal, familia: string, motivo: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  if (!motivo.trim()) throw new Error("Para retirar un proceso hay que decir el motivo.");
  const procesos = await procesosDeLaFamilia(familia, quien);
  if (!procesos.length) throw new Error("Ese proceso no existe.");
  const enCurso = await enCursoDeFamilia(procesos, quien);
  if (enCurso.length) {
    throw new Error(`Tiene ${enCurso.length === 1 ? "un caso" : `${enCurso.length} casos`} en curso: terminalos o cancelalos antes de retirarlo.`);
  }
  const activos = procesos.filter((p) => p.estado !== "retirado");
  if (!activos.length) throw new Error("Ya está retirado.");
  await withTransaction(async (client) => {
    const escritura: Escritura = { agent, quien, client };
    for (const proceso of activos) {
      await actualizarProceso(escritura, proceso, { estado: "retirado" });
    }
    await recordAuditEvent(client, {
      ...autoria(escritura),
      entityKey: "proceso",
      recordId: String(activos[0].id),
      action: "update",
      changes: { motivo, retiradas: activos.map((p) => p.id), source: "panel:procesos" },
    });
  });
  revalidateAfterWrite("proceso");
  return { familia, mensaje: `«${nombreDeFamilia(activos[0].nombre)}» quedó retirado.` };
}

/**
 * Vuelve a publicar la última versión de un proceso retirado, por si se retiró por error o
 * se vuelve a usar.
 */
export async function reactivarProceso(agent: AgentPrincipal, familia: string) {
  exigirAlcance(agent, "records:write");
  const quien = identidad(agent);
  exigirQueAdministre(quien);
  const procesos = await procesosDeLaFamilia(familia, quien);
  if (!procesos.length) throw new Error("Ese proceso no existe.");
  if (procesos.some((p) => p.estado === "publicado")) throw new Error("Ya tiene una versión publicada.");
  const ultima = [...procesos].sort((a, b) => versionDe(b) - versionDe(a))[0];
  await withTransaction((client) => actualizarProceso({ agent, quien, client }, ultima, { estado: "publicado" }));
  revalidateAfterWrite("proceso", String(ultima.id));
  return { familia, mensaje: `«${nombreDeFamilia(ultima.nombre)}» volvió a estar publicado.` };
}

export function validarProceso(definicion: unknown) {
  const validacion = validarDefinicion(definicion, rolesDeLaAplicacion());
  return validacion.ok
    ? { valida: true, etapas: validacion.definicion.etapas.length, errores: [] as string[] }
    : { valida: false, errores: validacion.errores };
}
