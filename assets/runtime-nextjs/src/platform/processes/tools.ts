import { marcas } from "@/platform/mcp/annotations";
import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { runtimeSpec } from "@/lib/spec";
import type { AgentPrincipal } from "@/platform/mcp/store";
import {
  cerrarEtapa,
  crearCaso,
  esperarCaso,
  guiaDeEtapa,
  liberarCaso,
  misPendientes,
  motorDisponible,
  revisarEtapa,
  tomarCaso,
  validarProceso,
  verCaso,
} from "@/platform/processes/engine";
import { DIAS_POR_DEFECTO, listarProcesos, rolesVenTablero, tableroDeProceso } from "@/platform/processes/dashboard";

type ResultadoMcp = {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
};

/** El rastreo de `server.ts`: deja la actividad del agente igual que cualquier otra herramienta. */
export type Rastreo = (
  herramienta: string,
  entrada: Record<string, unknown>,
  ejecutar: (agentEventId?: string) => Promise<{ value: Record<string, unknown>; resultCount?: number }>,
) => Promise<ResultadoMcp>;

const caso = z.string().uuid().describe("El id del caso (instancia), como lo devuelve mis_pendientes.");
const respuestaCriterio = z.object({
  criterio: z.union([z.number().int().min(1), z.string()]).describe("El número del criterio en la guía, o su texto exacto."),
  cumplido: z.boolean(),
  evidencia: z.string().max(2_000).optional().describe("Cómo lo verificaste: qué miraste y qué encontraste."),
});
const textos = z.array(z.string().max(2_000)).max(100);
const herramientas = z.array(z.string().max(48)).max(50).optional()
  .describe("Lo que tiene instalado la máquina desde la que trabajás, por ejemplo [\"hyperframes\", \"higgsfield\"]. Una IA de navegador no declara nada.");

function acotado(valor: unknown, limite: number, etiqueta: string) {
  if (JSON.stringify(valor ?? null).length > limite) throw new Error(`${etiqueta} supera ${Math.round(limite / 1024)} KB.`);
}

/**
 * Las herramientas con forma de tarea. Se registran sólo si la AppSpec tiene las
 * entidades del motor; si no, la aplicación sigue igual que antes.
 *
 * Las descripciones son parte del contrato: es lo que lee la IA de quien opera para
 * saber qué hace cada una, así que dicen cuándo usarlas, no sólo qué devuelven.
 */
export function registrarHerramientasDeProcesos(server: McpServer, agent: AgentPrincipal, rastreo: Rastreo) {
  if (!motorDisponible()) return;

  server.registerTool("mis_pendientes", {
    annotations: marcas("mis_pendientes"),
    description:
      "Por dónde empezar. Devuelve los casos que tenés para seguir, los que esperan tu revisión y los que podés tomar, según tu rol. Si trabajás desde una máquina con skills instaladas, declaralas en «herramientas»: las etapas que las requieren sólo aparecen para quien las tiene.",
    inputSchema: z.object({ herramientas }),
  }, async (entrada) => rastreo("mis_pendientes", entrada, async () => {
    const value = await misPendientes(agent, { herramientas: entrada.herramientas });
    return { value, resultCount: value.para_seguir.length + value.para_revisar.length + value.disponibles.length };
  }));

  server.registerTool("tomar_caso", {
    annotations: marcas("tomar_caso"),
    description:
      "Toma la etapa actual de un caso (o la retoma si ya era tuya) y devuelve su guía: qué tenés para trabajar, qué herramientas usar, cómo se hace, qué se controla y cómo cerrar. Si la etapa requiere herramientas de la máquina, declaralas en «herramientas».",
    inputSchema: z.object({ caso, herramientas }),
  }, async (entrada) => rastreo("tomar_caso", entrada, async (eventId) => ({
    value: await tomarCaso(agent, entrada.caso, eventId, entrada.herramientas),
    resultCount: 1,
  })));

  server.registerTool("guia_de_etapa", {
    annotations: marcas("guia_de_etapa"),
    description: "La guía de la etapa actual de un caso, sin tomarlo. Sirve para ver de qué se trata antes de tomarlo o para releerla.",
    inputSchema: z.object({ caso }),
  }, async (entrada) => rastreo("guia_de_etapa", entrada, async () => ({
    value: await guiaDeEtapa(agent, entrada.caso),
    resultCount: 1,
  })));

  server.registerTool("esperar_caso", {
    annotations: marcas("esperar_caso"),
    description:
      "Deja el caso en espera porque falta algo que no podés conseguir vos: un archivo, un dato, una decisión, una herramienta. Lo sigue teniendo quien lo tomó.",
    inputSchema: z.object({ caso, falta: z.string().min(3).max(1_000).describe("Qué falta y a quién se le pidió.") }),
  }, async (entrada) => rastreo("esperar_caso", entrada, async (eventId) => ({
    value: await esperarCaso(agent, entrada.caso, entrada.falta, eventId),
    resultCount: 1,
  })));

  server.registerTool("liberar_caso", {
    annotations: marcas("liberar_caso"),
    description: "Devuelve la etapa a la cola para que la tome otra persona. Usalo si no la vas a poder terminar.",
    inputSchema: z.object({ caso, motivo: z.string().min(3).max(1_000) }),
  }, async (entrada) => rastreo("liberar_caso", entrada, async (eventId) => ({
    value: await liberarCaso(agent, entrada.caso, entrada.motivo, eventId),
    resultCount: 1,
  })));

  server.registerTool("cerrar_etapa", {
    annotations: marcas("cerrar_etapa"),
    description:
      "Cierra la etapa que tenés tomada. Exige el enlace al resultado, las salidas que pide la etapa, la receta de cómo lo hiciste y la respuesta a cada criterio con su evidencia. Si algo falta, no cierra y dice qué.",
    inputSchema: z.object({
      caso,
      resumen: z.string().min(3).max(500).describe("Una línea con lo que quedó hecho."),
      enlace: z.string().max(2_000).describe("Dirección del resultado en la carpeta compartida de la organización."),
      salidas: z.record(z.string(), z.unknown()).default({}).describe("Lo que pide la sección «Cómo cerrar» de la guía, clave por clave."),
      receta: z.object({
        pasos: textos.describe("Qué hiciste, en orden."),
        herramientas: textos.describe("Qué skills, conectores o programas usaste. Vacía si ninguno."),
        modelo: z.string().max(200).describe("Qué IA usaste."),
        decisiones: textos.describe("Qué elegiste y por qué cuando había opciones. Vacía si no hubo."),
        fallos: textos.optional().describe("Qué no funcionó."),
      }),
      criterios: z.array(respuestaCriterio).max(100).default([]),
    }),
  }, async (entrada) => rastreo("cerrar_etapa", entrada, async (eventId) => {
    acotado(entrada.salidas, 32_768, "salidas");
    acotado(entrada.receta, 32_768, "receta");
    return {
      value: await cerrarEtapa(agent, entrada.caso, {
        resumen: entrada.resumen,
        enlace: entrada.enlace,
        salidas: entrada.salidas,
        receta: entrada.receta,
        criterios: entrada.criterios,
      }, eventId),
      resultCount: 1,
    };
  }));

  server.registerTool("revisar_etapa", {
    annotations: marcas("revisar_etapa"),
    description:
      "Aprueba o devuelve una etapa en revisión. Aprobar la pasa a la siguiente (o la entrega si era la última). Devolver exige el motivo: vuelve a quien la cerró. Antes, mirá el trabajo con ver_caso.",
    inputSchema: z.object({
      caso,
      aprobada: z.boolean(),
      motivo: z.string().max(2_000).optional().describe("Obligatorio al devolver: qué no cumple y qué tiene que cambiar."),
      criterios: z.array(respuestaCriterio).max(100).optional().describe("Tu juicio sobre cada criterio, si querés dejarlo escrito."),
      eleccion: z.number().int().min(1).max(100).optional()
        .describe("Si la etapa pide elegir: el número de la opción elegida, desde 1. Lo decide la persona, no la IA."),
    }),
  }, async (entrada) => rastreo("revisar_etapa", entrada, async (eventId) => ({
    value: await revisarEtapa(agent, entrada.caso, {
      aprobada: entrada.aprobada,
      motivo: entrada.motivo,
      criterios: entrada.criterios,
      eleccion: entrada.eleccion,
    }, eventId),
    resultCount: 1,
  })));

  server.registerTool("crear_caso", {
    annotations: marcas("crear_caso"),
    description:
      "Abre un caso nuevo de un proceso publicado. El pedido tiene que traer todos los insumos que el proceso exige: si falta alguno, no se abre y la respuesta dice cuáles pedir.",
    inputSchema: z.object({
      proceso: z.string().uuid().describe("El id del proceso publicado (query_records sobre proceso)."),
      titulo: z.string().min(3).max(200).describe("Qué es y para quién, por ejemplo «IVA de marzo — Estudio X»."),
      cliente: z.string().uuid().optional(),
      insumos: z.record(z.string(), z.unknown()).describe("Las entradas del pedido, clave por clave."),
      responde: z.string().uuid().optional().describe("Quién responde por el caso ante el cliente. Por defecto, vos."),
    }),
  }, async (entrada) => rastreo("crear_caso", { ...entrada, insumos: undefined }, async (eventId) => {
    acotado(entrada.insumos, 32_768, "insumos");
    return { value: await crearCaso(agent, entrada, eventId), resultCount: 1 };
  }));

  server.registerTool("ver_caso", {
    annotations: marcas("ver_caso"),
    description:
      "Todo lo que pasó en un caso: cada etapa, quién la hizo, cuándo, con qué receta y dónde quedó el resultado. Es la vista para revisar o para responder por el trabajo.",
    inputSchema: z.object({ caso }),
  }, async (entrada) => rastreo("ver_caso", entrada, async () => {
    const value = await verCaso(agent, entrada.caso);
    return { value, resultCount: value.bitacora.length };
  }));

  server.registerTool("validar_proceso", {
    annotations: marcas("validar_proceso"),
    description:
      "Revisa una definición de proceso antes de guardarla o publicarla: etapas numeradas, grupos con roles que existen, instrucciones, criterios y salidas. No guarda nada.",
    inputSchema: z.object({ definicion: z.record(z.string(), z.unknown()) }),
  }, async (entrada) => rastreo("validar_proceso", { definicion: "(omitida)" }, async () => ({
    value: validarProceso(entrada.definicion),
  })));

  // Sólo para quien ve toda la actividad: el tablero incluye la tasa de devolución por
  // persona, y medir el trabajo no tiene que volverse un ranking a la vista de quien opera.
  const roles = agent.kind === "user" ? [agent.roleKey] : [...new Set([agent.roleKey, agent.ownerRoleKey ?? agent.roleKey])];
  if (agent.scopes.includes("records:read") && rolesVenTablero(roles)) {
    server.registerTool("tablero_de_trabajo", {
      annotations: marcas("tablero_de_trabajo"),
      description:
        "Cómo rinde el trabajo, según la bitácora. Sin proceso, un resumen de todos: casos, entregados, tiempo de ciclo y dónde se traba cada uno. Con proceso, el detalle por etapa: tiempo en cola, trabajando, esperando y en revisión; tasa de devolución; qué modelo de IA declaró cada cierre y cómo le fue; los últimos motivos de espera y devolución; los casos detenidos y la tasa por persona. Usalo para decidir qué mejorar en la próxima versión de un proceso.",
      inputSchema: z.object({
        proceso: z.string().uuid().optional().describe("El id del proceso. Sin él, devuelve el resumen de todos."),
        dias: z.number().int().min(1).max(730).optional().describe("Período en días: los casos abiertos más los creados en ese lapso. Por defecto, 90."),
      }),
    }, async (entrada) => rastreo("tablero_de_trabajo", entrada, async () => {
      if (entrada.proceso) {
        const detalle = await tableroDeProceso(entrada.proceso, entrada.dias);
        if (!detalle) throw new Error("Ese proceso no existe.");
        return { value: detalle, resultCount: detalle.tablero.casos };
      }
      const procesos = await listarProcesos();
      const resumen = [];
      for (const proceso of procesos) {
        const detalle = await tableroDeProceso(proceso.id, entrada.dias);
        if (!detalle) continue;
        const { tablero } = detalle;
        resumen.push({
          id: proceso.id,
          nombre: proceso.nombre,
          estado: proceso.estado,
          casos: tablero.casos,
          entregados: tablero.entregados,
          ciclo_mediana_horas: tablero.ciclo.mediana_horas,
          detenidos: tablero.detenidos.length,
          traba: tablero.traba,
        });
      }
      return { value: { dias: entrada.dias ?? DIAS_POR_DEFECTO, procesos: resumen }, resultCount: resumen.length };
    }));
  }

  // Los prompts aparecen como comandos en los clientes que los muestran: para alguien que
  // no sabe qué pedirle a su IA, elegir «pendientes» es más fácil que redactarlo.
  const aplicacion = runtimeSpec.app.name;
  server.registerPrompt("pendientes", {
    title: "Qué tengo pendiente",
    description: `Lo que tenés para hacer en ${aplicacion}, y por dónde empezar.`,
  }, () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: `Fijate con mis_pendientes qué tengo en «${aplicacion}». Mostrámelo corto, ordenado por lo que más urge, y proponé por cuál empezar.`,
      },
    }],
  }));

  server.registerPrompt("trabajar_caso", {
    title: "Trabajar un caso",
    description: "Toma un caso, lee la guía de su etapa y la sigue paso a paso.",
    argsSchema: z.object({ caso: z.string().describe("El id del caso") }),
  }, ({ caso: id }) => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          `Tomá el caso ${id} con tomar_caso y seguí su guía paso a paso.`,
          "Antes de empezar, decime en dos líneas qué hay que lograr y si te falta alguna herramienta de las que pide.",
          "Pedime sólo lo que la guía dice que me toca a mí. Cuando termines, mostrame el resultado y la evidencia de cada criterio antes de llamar a cerrar_etapa.",
        ].join(" "),
      },
    }],
  }));
}
