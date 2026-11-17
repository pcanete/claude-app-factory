/**
 * Cómo se arman las instrucciones de servidor MCP. Sin dependencias a propósito: así
 * `scripts/test-mcp-instructions.mjs` prueba este mismo archivo, no una copia.
 *
 * Forma del valor guardado en la configuración (`mcp` / `instrucciones`):
 *   - un texto: se envía a todos los roles;
 *   - `{ "general": "...", "roles": { "<rol>": "..." } }`: lo general más lo del rol.
 * Cualquier otra forma se ignora, y la base sale igual.
 */

export const NAMESPACE_INSTRUCCIONES = "mcp";
export const CLAVE_INSTRUCCIONES = "instrucciones";
export const LIMITE_INSTRUCCIONES = 16_000;

export type ContextoInstrucciones = {
  aplicacion: string;
  descripcion?: string;
  nombre: string;
  rol: string;
  rolEtiqueta: string;
  tipo: "agent" | "user";
  /** El `app_user.id` de la persona que opera, o de la que responde por el agente. */
  persona?: string | null;
  /** Si la aplicación tiene motor de procesos: cambia por dónde se empieza a trabajar. */
  motorDeProcesos?: boolean;
  /** Si quien opera crea y edita procesos: recibe además los pasos para crear uno completo. */
  administraProcesos?: boolean;
  /** Si la aplicación guarda lo producido en su almacén propio: entonces Dropbox no se exige. */
  almacen?: boolean;
};

/**
 * Los pasos para crear un proceso, para quien administra. Un proceso que nace a medias
 * —sin skill probada, sin pieza en Dropbox o sin láminas— no lo puede repetir nadie.
 */
export const PASOS_PARA_CREAR_UN_PROCESO = [
  "Si administrás y algo se hizo por primera vez, crear el proceso es esto, en este orden, y no se saltea ningún paso:",
  "1. La skill vive en el repositorio de skills de la organización, enlazada en esta máquina, y está probada: regenerá la pieza desde la skill, no desde lo que quedó en la conversación.",
  "2. Commit y push de la skill. El commit que vas a registrar es ese, no uno local que nadie más tiene.",
  "3. La pieza está en la carpeta de Dropbox del proceso, comprobada con el conector de Dropbox. Si no tenés conector, preguntale a la persona si la ve en Dropbox; que esté en la carpeta sincronizada de esta máquina no alcanza.",
  "4. registrar_iteracion con nuevo_proceso y la ficha completa.",
  "5. Adjuntá las láminas con adjuntar_a_iteracion.",
  "6. Comprobá con iteraciones_de_proceso que la iteración aparece con sus imágenes. Recién ahí está creado.",
];

/** Los mismos pasos con almacén propio: la pieza se sube a la aplicación, sin Dropbox. */
export const PASOS_PARA_CREAR_UN_PROCESO_CON_ALMACEN = [
  PASOS_PARA_CREAR_UN_PROCESO[0],
  PASOS_PARA_CREAR_UN_PROCESO[1],
  PASOS_PARA_CREAR_UN_PROCESO[2],
  "3. registrar_iteracion con nuevo_proceso y la ficha completa.",
  "4. Subí la pieza con subir_producido y confirmala con confirmar_producido: la aplicación comprueba que llegó entera.",
  "5. Si subiste las láminas, confirmar_producido ya las dejó como vista previa. Si lo producido no tiene imágenes (un video), adjuntá la portada con adjuntar_a_iteracion.",
  "6. Comprobá con iteraciones_de_proceso que la iteración no quedó incompleta. Recién ahí está creado.",
];

function texto(valor: unknown) {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

export function componerInstrucciones(contexto: ContextoInstrucciones, valor: unknown) {
  const quien = contexto.tipo === "agent"
    ? `el agente «${contexto.nombre}», con el rol ${contexto.rolEtiqueta}. Lo que escribas queda registrado a nombre de la persona que responde por esta credencial`
    : `${contexto.nombre}, con el rol ${contexto.rolEtiqueta}. Lo que escribas queda registrado a tu nombre`;
  const partes = [
    `Estás conectado a «${contexto.aplicacion}»${contexto.descripcion ? `: ${contexto.descripcion}` : ""}.`,
    `Operás como ${quien}.`,
  ];
  // Sin esto una IA no puede completar un campo de persona con su propio nombre: no
  // hay herramienta que responda "quién soy", y el identificador no se adivina.
  if (contexto.persona) {
    partes.push(
      contexto.tipo === "agent"
        ? `La persona que responde por vos tiene el identificador ${contexto.persona}: usalo en los campos de tipo persona cuando el trabajo sea de ella.`
        : `Tu identificador de persona es ${contexto.persona}: usalo en los campos de tipo persona cuando el trabajo sea tuyo.`,
    );
  }
  partes.push("Para saber qué podés consultar y modificar, usá list_entities y describe_entity.");
  // Con procesos, lo que el equipo ya sabe hacer está en la plataforma: la IA lo trae antes
  // de improvisar, y registra lo que sale bien para que otro lo repita.
  if (contexto.motorDeProcesos) {
    partes.push(
      "",
      "Esta aplicación guarda lo que el equipo sabe hacer como procesos, y cada vez que se hizo como iteraciones.",
      "- Si te piden algo que el equipo ya sabe hacer, traé cómo se hace con como_se_hace. Comprobá primero en esta máquina los requisitos que lista; lo que falte, instalalo como dice o avisá, y no lo reemplaces por otra cosa.",
      ...(contexto.almacen
        ? [
          "- Lo producido se guarda en la aplicación, no en Dropbox ni en una carpeta personal: no hace falta acceso a ninguna otra cuenta.",
          "- Al terminar, registralo con registrar_iteracion: los datos que pide el proceso, la receta, la skill con su commit y el enlace a la conversación.",
          "- Después subí lo producido con subir_producido (un PUT por archivo desde esta máquina, sin pasarlo por el chat) y confirmalo con confirmar_producido. Es parte de registrar: hasta entonces la iteración queda incompleta. Las imágenes que subas (las láminas) quedan solas como vista previa en el panel; sólo si lo producido no tiene imágenes (un video), adjuntá la portada con adjuntar_a_iteracion.",
        ]
        : [
          "- Lo producido va a la carpeta de Dropbox del proceso. Comprobá con el conector de Dropbox que quedó ahí antes de registrar; si no tenés conector, preguntale a la persona en vez de dar por buena la carpeta sincronizada.",
          "- Al terminar, registralo con registrar_iteracion: carpeta, archivos, los datos que pide el proceso, la receta, la skill con su commit y el enlace a la conversación.",
          "- Adjuntar las imágenes es parte de registrar, no un paso opcional: después de registrar_iteracion, adjuntá las láminas o la portada con adjuntar_a_iteracion. Una iteración sin imágenes queda incompleta.",
        ]),
      "- No crees ni edites procesos ni iteraciones con create_record o update_record.",
    );
    if (contexto.administraProcesos) partes.push("", ...(contexto.almacen ? PASOS_PARA_CREAR_UN_PROCESO_CON_ALMACEN : PASOS_PARA_CREAR_UN_PROCESO));
  }

  let general: string | null = null;
  let delRol: string | null = null;
  if (typeof valor === "string") {
    general = texto(valor);
  } else if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    const objeto = valor as { general?: unknown; roles?: unknown };
    general = texto(objeto.general);
    if (objeto.roles && typeof objeto.roles === "object" && !Array.isArray(objeto.roles)) {
      delRol = texto((objeto.roles as Record<string, unknown>)[contexto.rol]);
    }
  }
  if (general) partes.push("", general);
  if (delRol) partes.push("", delRol);

  const completo = partes.join("\n");
  if (completo.length <= LIMITE_INSTRUCCIONES) return completo;
  const aviso = "\n\n[Instrucciones recortadas: superan el límite de la plataforma.]";
  return `${completo.slice(0, LIMITE_INSTRUCCIONES - aviso.length)}${aviso}`;
}
