import "server-only";
import type { PoolClient } from "pg";
import { generatedCapabilities, generatedPermissions } from "@/generated/permissions";
import { recordAuditEvent } from "@/lib/audit";
import { sql, withTransaction } from "@/lib/db";
import { recordAccessForAgent, type RecordAccessContext } from "@/lib/record-access";
import { getRecord, insertRecord, listRecords, recordInputFromObject, updateRecord } from "@/lib/repository";
import { revalidateAfterWrite } from "@/lib/revalidation";
import { applyRules } from "@/lib/rules";
import { getEntity, relationFields, requireEntity, runtimeSpec } from "@/lib/spec";
import type { AgentPrincipal } from "@/platform/mcp/store";
import {
  componerGuia,
  destinoTrasAprobar,
  destinoTrasCerrar,
  entradasFaltantes,
  etapaPorOrden,
  herramientasQueFaltan,
  opcionesParaElegir,
  puedeRevisar,
  puedeTomar,
  validarCierre,
  validarDefinicion,
  visiblesParaEtapa,
  type Definicion,
  type Destino,
  type Etapa,
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
    return aplicarDestino(escritura, caso, destinoTrasAprobar(caso.definicion, caso.etapa), enlace);
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
      salidas: Object.fromEntries(Object.entries(salidas).filter(([clave]) => clave !== caso.etapa.eleccion?.opciones)),
    });
  }
  return decisiones;
}

export function validarProceso(definicion: unknown) {
  const validacion = validarDefinicion(definicion, rolesDeLaAplicacion());
  return validacion.ok
    ? { valida: true, etapas: validacion.definicion.etapas.length, errores: [] as string[] }
    : { valida: false, errores: validacion.errores };
}
