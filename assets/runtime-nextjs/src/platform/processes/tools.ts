import { marcas } from "@/platform/mcp/annotations";
import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { runtimeSpec } from "@/lib/spec";
import type { AgentPrincipal } from "@/platform/mcp/store";
import {
  adjuntarAIteracion,
  comoSeHace,
  administraProcesos,
  iteracionesDeProceso,
  mejorarProceso,
  motorDisponible,
  registrarIteracion,
} from "@/platform/processes/engine";
import { TIPOS_DE_REQUISITO, type TipoRequisito } from "@/platform/processes/definition";

type ResultadoMcp = {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  structuredContent: Record<string, unknown>;
};

/** El rastreo de `server.ts`: deja la actividad del agente igual que cualquier otra herramienta. */
export type Rastreo = (
  herramienta: string,
  entrada: Record<string, unknown>,
  ejecutar: (agentEventId?: string) => Promise<{ value: Record<string, unknown>; resultCount?: number }>,
) => Promise<ResultadoMcp>;

const textos = z.array(z.string().max(4_000)).max(100);

// La ficha de un proceso, igual para crearlo y para mejorarlo. Qué es obligatorio lo decide
// el motor (`faltasDeFicha`), no el esquema: así el panel y el MCP exigen lo mismo.
const ficha = z.object({
  resumen: z.string().min(10).max(200).describe("Qué hace, en una línea."),
  entrada: z.string().max(500).describe("Qué hay que darle para empezar."),
  entrega: z.string().max(500).describe("Qué entrega."),
  pedido_ejemplo: z.string().max(300).optional().describe("La frase para pedírselo a una IA."),
  skill: z.object({
    nombre: z.string().min(1).max(120),
    repo: z.string().url().max(500).describe("La dirección (https://…) del repositorio de la skill."),
  }).optional().describe("La skill con que se hace. Si no hay skill, mandá metodo."),
});
const requisitos = z.array(z.object({
  nombre: z.string().min(1).max(200),
  tipo: z.enum(TIPOS_DE_REQUISITO as unknown as [TipoRequisito, ...TipoRequisito[]]),
  verificar: z.string().min(1).max(1_000).describe("Cómo se comprueba en una máquina que está: un comando o qué mirar."),
  instalar: z.string().max(1_000).optional().describe("Qué hacer si falta."),
})).min(1).max(50).describe("Lo que la máquina tiene que tener: skills, librerías, programas, conectores, variables y archivos.");
const registro = z.array(z.object({
  clave: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/).describe("En minúsculas, sin espacios: «deportista»."),
  descripcion: z.string().min(1).max(500),
  requerido: z.boolean().optional().describe("Por defecto, sí."),
})).min(1).max(50).describe("Los datos que cada iteración tiene que dejar. Carpeta, archivos, receta, skill y conversación se registran siempre.");
const carpeta = z.string().max(500).describe("La carpeta de Dropbox donde va cada iteración: «/Clientes/<cliente>/…/piezas/».");
const metodo = z.string().max(20_000).describe("Cómo se hace, en markdown. Sólo si no hay skill.");

function acotado(valor: unknown, limite: number, etiqueta: string) {
  if (JSON.stringify(valor ?? null).length > limite) throw new Error(`${etiqueta} supera ${Math.round(limite / 1024)} KB.`);
}

/**
 * Cuatro herramientas: cómo se hace algo, registrar una vez que se hizo, ver las veces que
 * se hizo y adjuntar lo liviano para mirarlo. Una quinta, editar_proceso, sólo para el
 * agente de quien administra. Se registran sólo si la AppSpec tiene
 * `proceso` e `iteracion`.
 *
 * Las descripciones son parte del contrato: es lo que lee la IA de quien opera para saber
 * cuándo usarlas.
 */
export function registrarHerramientasDeProcesos(server: McpServer, agent: AgentPrincipal, rastreo: Rastreo) {
  if (!motorDisponible()) return;

  server.registerTool("como_se_hace", {
    annotations: marcas("como_se_hace"),
    description:
      "Cómo se hace algo que el equipo ya sabe hacer: qué tiene que tener esta máquina (requisitos con cómo comprobarlos y cómo instalarlos), con qué skill se hace, dónde se guarda en Dropbox, qué hay que registrar al terminar y las últimas veces que se hizo. Usalo antes de empezar cuando la persona pide algo que el equipo ya hizo, comprobá los requisitos en esta máquina y recién después ejecutá.",
    inputSchema: z.object({
      proceso: z.string().min(2).max(200).describe("El nombre del proceso, por ejemplo «Carrusel P3 Negocios», o su id."),
    }),
  }, async (entrada) => rastreo("como_se_hace", entrada, async () => ({
    value: await comoSeHace(agent, entrada.proceso),
    resultCount: 1,
  })));

  server.registerTool("registrar_iteracion", {
    annotations: marcas("registrar_iteracion"),
    description:
      "Registra una vez que se hizo un proceso. Antes de llamarla, lo producido tiene que estar en Dropbox y tenés que haber comprobado con el conector de Dropbox que los archivos están en la carpeta: sin carpeta y archivos no se registra. Mandá los datos que el proceso pide (como_se_hace los lista en «registro»), la receta armada de esta conversación, la skill con su commit y el enlace a la conversación. Si el proceso todavía no existe y administrás, mandá nuevo_proceso con la ficha completa; si no administrás, pedile a quien administra que lo cree.",
    inputSchema: z.object({
      proceso: z.string().max(200).optional().describe("El nombre o el id del proceso."),
      nuevo_proceso: z.object({
        nombre: z.string().min(3).max(120),
        ficha,
        requisitos,
        registro,
        carpeta,
        metodo: metodo.optional(),
      }).optional().describe("Sólo si es la primera vez que se hace, y sólo si quien registra administra: crea el proceso con su ficha completa en el mismo paso. Los datos de esta iteración tienen que cumplir el registro que declares."),
      titulo: z.string().min(3).max(200).describe("Qué se hizo esta vez, por ejemplo «Federer y On»."),
      carpeta: z.string().max(1_000).describe("La carpeta de Dropbox donde quedó lo producido: https://www.dropbox.com/… o /Clientes/…"),
      archivos: textos.min(1).describe("Los archivos que quedaron en esa carpeta, como los devolvió el conector de Dropbox al comprobarlos."),
      datos: z.record(z.string(), z.unknown()).optional().describe("Los datos que pide el registro del proceso, con su clave."),
      receta: z.object({
        pasos: textos.min(1).describe("Qué se hizo, en orden, para que otra persona lo repita."),
        prompts: textos.optional().describe("Los prompts que funcionaron, textuales."),
        herramientas: textos.describe("Skills, conectores y programas usados. Vacía si ninguno."),
        modelo: z.string().max(200).describe("Qué IA se usó."),
        decisiones: textos.describe("Qué se eligió y por qué."),
        descartes: textos.optional().describe("Lo que se probó y no funcionó."),
      }),
      skill: z.string().max(200).optional().describe("Con qué skill y commit se hizo: «carrusel-p3-negocios @ f31eaf4». El commit sale del repositorio de la skill en esta máquina; no lo inventes."),
      conversacion: z.string().max(2_000).optional().describe("El enlace de esta conversación (https://… o claude://…)."),
      reproduccion: z.object({
        salio_igual: z.boolean(),
        que_falto: z.string().max(4_000).optional(),
      }).optional().describe("Sólo si esto fue repetir un proceso siguiendo como_se_hace."),
      estado: z.enum(["en_curso", "terminada", "publicada"]).optional().describe("Opcional."),
      responsable: z.string().uuid().optional().describe("Opcional: el id de la persona que responde por esto."),
    }),
  }, async (entrada) => rastreo("registrar_iteracion", { ...entrada, receta: "(omitida)", datos: "(omitidos)" }, async (eventId) => {
    acotado(entrada.receta, 64_000, "receta");
    acotado(entrada.datos, 64_000, "datos");
    return { value: await registrarIteracion(agent, entrada, eventId), resultCount: 1 };
  }));

  // Sólo lo ve el agente de quien administra: es el único que puede cambiar un proceso.
  if (administraProcesos(agent)) {
    server.registerTool("editar_proceso", {
      annotations: marcas("editar_proceso"),
      description:
        "Mejora un proceso que ya existe: cambiá sólo lo que mandes (ficha, requisitos, registro, carpeta o método) y el resto queda como está. Requisitos y registro se reemplazan enteros: mandá la lista completa. El proceso tiene que quedar completo, si no, no se guarda. Lo que es método de la skill va a su repositorio, no acá.",
      inputSchema: z.object({
        proceso: z.string().min(2).max(200).describe("El nombre o el id del proceso."),
        nombre: z.string().min(3).max(120).optional(),
        ficha: ficha.partial().optional(),
        requisitos: requisitos.optional(),
        registro: registro.optional(),
        carpeta: carpeta.optional(),
        metodo: metodo.optional(),
      }),
    }, async ({ proceso, ...cambios }) => rastreo("editar_proceso", { proceso, cambios: Object.keys(cambios) }, async () => ({
      value: await mejorarProceso(agent, proceso, cambios),
      resultCount: 1,
    })));
  }

  server.registerTool("iteraciones_de_proceso", {
    annotations: marcas("iteraciones_de_proceso"),
    description:
      "Las veces que se hizo un proceso: quién, cuándo, dónde quedó en Dropbox, con qué skill y commit, la receta, los datos y, en las reproducciones, si salió igual y qué faltó. Es lo que se mira para mejorar el proceso o su skill.",
    inputSchema: z.object({
      proceso: z.string().min(2).max(200).describe("El nombre o el id del proceso."),
      limite: z.number().int().min(1).max(100).optional(),
    }),
  }, async (entrada) => rastreo("iteraciones_de_proceso", entrada, async () => {
    const value = await iteracionesDeProceso(agent, entrada.proceso, entrada.limite);
    return { value, resultCount: value.iteraciones.length };
  }));

  server.registerTool("adjuntar_a_iteracion", {
    annotations: marcas("adjuntar_a_iteracion"),
    description:
      "Adjunta imágenes o PDF livianos a una iteración registrada —las láminas de un carrusel, la portada de un video— para que se vean en el panel y otra IA las mire. Lo pesado queda en Dropbox.",
    inputSchema: z.object({
      iteracion: z.string().uuid().describe("El id que devolvió registrar_iteracion."),
      archivos: z.array(z.object({
        nombre: z.string().min(1).max(255).describe("Con el orden si importa: «slide-01.jpg»."),
        tipo: z.string().max(100).describe("image/jpeg, image/png, image/webp o application/pdf."),
        contenido: z.string().max(4_500_000).describe("El archivo en base64."),
      })).min(1).max(10),
    }),
  }, async (entrada) => rastreo("adjuntar_a_iteracion", { iteracion: entrada.iteracion, archivos: entrada.archivos.map((a) => a.nombre) }, async () => {
    const value = await adjuntarAIteracion(agent, entrada.iteracion, entrada.archivos.map((archivo) => ({
      nombre: archivo.nombre,
      tipo: archivo.tipo,
      contenido: Buffer.from(archivo.contenido, "base64"),
    })));
    return { value, resultCount: value.adjuntados };
  }));

  // Los prompts aparecen como comandos en los clientes que los muestran: quien no sabe qué
  // pedirle a su IA elige uno.
  const aplicacion = runtimeSpec.app.name;
  const mensaje = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

  server.registerPrompt("registrar", {
    title: "Registrar lo que hice",
    description: "Guarda cómo se hizo esto, en esta conversación, como iteración de un proceso.",
  }, () => mensaje([
    `Quiero registrar en «${aplicacion}» lo que hicimos en esta conversación.`,
    "1. Fijate a qué proceso pertenece con como_se_hace (o query_records sobre proceso). Si no existe y administro, proponeme la ficha completa —qué hace, qué entra, qué entrega, skill y repositorio, carpeta, requisitos con cómo comprobarlos y qué se registra— para crearlo con nuevo_proceso. Si no administro, decímelo: lo tiene que crear quien administra.",
    "2. Asegurate de que lo producido esté en la carpeta de Dropbox del proceso, y comprobalo con el conector de Dropbox: anotá los archivos que están.",
    "3. Armá la receta de esta conversación —pasos en orden, prompts que funcionaron textuales, herramientas, IA, decisiones y descartes— y los datos que pide el proceso.",
    "4. Anotá la skill con su commit, si se hizo con una, y el enlace de esta conversación.",
    "5. Mostrame todo y, cuando lo apruebe, llamá registrar_iteracion. Si hay imágenes livianas, adjuntalas con adjuntar_a_iteracion.",
  ].join("\n")));

  server.registerPrompt("reproducir", {
    title: "Hacer algo que el equipo ya sabe hacer",
    description: "Comprueba la máquina, sigue el proceso y registra si salió igual.",
    argsSchema: z.object({ proceso: z.string().describe("El nombre del proceso, por ejemplo «Carrusel P3 Negocios»") }),
  }, ({ proceso }) => mensaje([
    `Quiero hacer «${proceso}». Traé cómo se hace con como_se_hace.`,
    "Primero comprobá en esta máquina cada requisito, uno por uno, y decime cuáles están y cuáles faltan. Lo que falte, instalalo con lo que dice el proceso o decime qué hacer; no lo reemplaces por otra cosa.",
    "Después seguí la skill o el método, mirando antes las imágenes de referencia con read_attachment.",
    "Al terminar, guardá en Dropbox, comprobalo, mostrame el resultado, preguntame si salió igual y registralo con registrar_iteracion como reproducción.",
  ].join(" ")));

  server.registerPrompt("mejorar_proceso", {
    title: "Mejorar un proceso",
    description: "Mira las veces que se hizo y propone qué cambiar.",
    argsSchema: z.object({ proceso: z.string().describe("El nombre del proceso") }),
  }, ({ proceso }) => mensaje([
    `Mirá con iteraciones_de_proceso las veces que se hizo «${proceso}» y con como_se_hace cómo se hace hoy.`,
    "Fijate qué se repite en lo que salió bien, qué faltó en las reproducciones que no salieron igual y qué requisito o dato del registro falta.",
    "Proponeme qué cambiar, cada cambio con la iteración que lo justifica.",
    "Lo que es método va a la skill, con un commit que diga qué cambió y por qué. Lo que es ficha, requisito, registro o carpeta se cambia con editar_proceso, si administro, cuando lo apruebe; si no, lo edita quien administra en el panel.",
  ].join(" ")));
}
