/**
 * La definición de un proceso y todo lo que se decide sólo con ella: si está bien
 * escrita, qué falta en un pedido, si un cierre cumple, adónde va el caso después y qué
 * guía recibe quien toma una etapa.
 *
 * Sin dependencias a propósito, igual que `platform/mcp/instructions-text.ts`: así
 * `scripts/test-process-definition.mjs` prueba este mismo archivo y no una copia. Lo que
 * toca la base vive en `engine.ts`.
 *
 * El contrato completo está en `references/process-engine.md` de la fábrica.
 */

export type Ejecutor = "humano" | "agente" | "cualquiera";
export type TipoRevision = "ninguna" | "agente" | "humana" | "ambas";

/** Un insumo o una entrada: un texto que lo describe, o un objeto explícito. */
export type Entrada = string | { descripcion?: string; requerido?: boolean };

export type Herramienta = {
  nombre: string;
  /** `skill`: instalada en la máquina de quien opera. `conector`: una conexión de su IA. `manual`: la hace una persona. */
  tipo?: "skill" | "conector" | "manual" | "taller";
  uso?: string;
  /** Qué hacer si quien toma la etapa no la tiene. Por defecto: esperar, no improvisar. */
  si_no_esta?: string;
};

export type Criterio = { tipo: "mecanico" | "juicio"; texto: string };

export type Etapa = {
  orden: number;
  clave?: string;
  nombre: string;
  ejecutor: Ejecutor;
  /** Los roles que pueden tomarla: es la cola de la etapa. */
  grupo: string[];
  /** Qué se ve de lo anterior: `insumos` o la clave de una salida de otra etapa. */
  entradas_visibles?: string[];
  instrucciones: string;
  pasos?: string[];
  errores_frecuentes?: string[];
  herramientas?: Herramienta[];
  criterios?: Criterio[];
  /** Lo que la etapa tiene que dejar, clave por clave. */
  salidas?: Record<string, string>;
  revision: TipoRevision;
  /** Los roles que revisan. Sin declarar, revisan los roles que administran. */
  revisores?: string[];
  /** Si quien cerró puede aprobar su propio trabajo. Por defecto, no. */
  autorrevision?: boolean;
  /**
   * Lo que tiene que tener la máquina que la ejecuta, por ejemplo `["hyperframes"]` o
   * `["higgsfield"]`. Una etapa con requisitos sólo se le ofrece a quien declara tenerlos:
   * así una IA de navegador no toma una etapa que necesita renderizar video en local.
   */
  requiere?: string[];
  /**
   * Una etapa que deja opciones para que una persona elija. `opciones` es la clave de la
   * salida que trae la lista; `guarda` es la clave con la que la opción elegida queda
   * disponible para las etapas siguientes.
   */
  eleccion?: { opciones: string; guarda: string };
};

/**
 * La ficha de un proceso, escrita para personas: lo que un compañero necesita saber para
 * entender cómo se hace algo sin leer la guía, que está escrita para la IA.
 */
export type Ficha = {
  /** Qué hace, en una línea. Es lo que muestra la tarjeta del proceso. */
  resumen?: string;
  /** Qué hay que darle para empezar. */
  entrada?: string;
  /** Qué entrega. */
  entrega?: string;
  /** Qué tiene que tener la máquina donde se hace. */
  necesita?: string[];
  /** La frase para pedírselo a una IA. */
  pedido_ejemplo?: string;
  /** La skill con la que se hace: nombre, versión y, si está publicada, su repositorio. */
  skill?: { nombre: string; version?: string; repo?: string };
};

export type Definicion = {
  ficha?: Ficha;
  proposito?: string;
  donde_vive_el_resultado?: string;
  /** El formulario del pedido: lo que tiene que estar antes de que el caso exista. */
  pedido?: { entradas?: Record<string, Entrada>; instrucciones?: string };
  etapas: Etapa[];
};

export type RespuestaCriterio = {
  /** El número del criterio (desde 1) o su texto exacto. */
  criterio: number | string;
  cumplido: boolean;
  evidencia?: string;
};

const EJECUTORES = new Set(["humano", "agente", "cualquiera"]);
/** Un requisito o una clave: minúsculas, números, guiones. Lo comparan máquinas, no personas. */
const CLAVE = /^[a-z][a-z0-9_-]{0,47}$/;
const REVISIONES = new Set(["ninguna", "agente", "humana", "ambas"]);

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
}

function textoNoVacio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

function listaDeTextos(valor: unknown) {
  return Array.isArray(valor) && valor.every(textoNoVacio);
}

/**
 * Revisa una definición antes de que alguien trabaje con ella.
 *
 * `roles` son los de la aplicación: un grupo que nombra un rol inexistente deja una
 * etapa que nadie puede tomar, y eso se ve recién cuando el caso se traba.
 */
export function validarDefinicion(
  valor: unknown,
  roles?: readonly string[],
): { ok: true; definicion: Definicion } | { ok: false; errores: string[] } {
  const errores: string[] = [];
  if (!esObjeto(valor)) return { ok: false, errores: ["La definición tiene que ser un objeto JSON."] };
  const rolesValidos = roles ? new Set(roles) : null;
  const revisarRoles = (lista: unknown, donde: string) => {
    if (!listaDeTextos(lista) || !(lista as string[]).length) {
      errores.push(`${donde} tiene que ser una lista de roles, no vacía.`);
      return;
    }
    if (!rolesValidos) return;
    for (const rol of lista as string[]) {
      if (!rolesValidos.has(rol)) errores.push(`${donde} nombra el rol «${rol}», que no existe en la aplicación.`);
    }
  };

  if (valor.pedido !== undefined) {
    if (!esObjeto(valor.pedido)) errores.push("pedido tiene que ser un objeto.");
    else if (valor.pedido.entradas !== undefined && !esObjeto(valor.pedido.entradas)) {
      errores.push("pedido.entradas tiene que ser un objeto: clave → descripción.");
    }
  }

  if (valor.ficha !== undefined) {
    const ficha = valor.ficha;
    if (!esObjeto(ficha)) errores.push("ficha tiene que ser un objeto.");
    else {
      for (const campo of ["resumen", "entrada", "entrega", "pedido_ejemplo"] as const) {
        if (ficha[campo] !== undefined && !textoNoVacio(ficha[campo])) errores.push(`ficha.${campo} tiene que ser un texto.`);
      }
      if (textoNoVacio(ficha.resumen) && ficha.resumen.length > 200) {
        errores.push("ficha.resumen es lo que se lee en la tarjeta del proceso: una línea, hasta 200 caracteres.");
      }
      if (ficha.necesita !== undefined && !listaDeTextos(ficha.necesita)) errores.push("ficha.necesita tiene que ser una lista de textos.");
      if (ficha.skill !== undefined) {
        const skill = ficha.skill;
        if (!esObjeto(skill) || !textoNoVacio(skill.nombre)) errores.push("ficha.skill necesita nombre.");
        else {
          if (skill.version !== undefined && !textoNoVacio(skill.version)) errores.push("ficha.skill.version tiene que ser un texto, por ejemplo «2».");
          if (skill.repo !== undefined && !esUrl(skill.repo)) errores.push("ficha.skill.repo tiene que ser la dirección (https://…) del repositorio.");
        }
      }
    }
  }

  const etapas = valor.etapas;
  if (!Array.isArray(etapas) || !etapas.length) {
    errores.push("etapas tiene que ser una lista con al menos una etapa.");
    return { ok: false, errores };
  }

  etapas.forEach((etapa, indice) => {
    const donde = `La etapa ${indice + 1}`;
    if (!esObjeto(etapa)) {
      errores.push(`${donde} no es un objeto.`);
      return;
    }
    if (etapa.orden !== indice + 1) {
      errores.push(`${donde} tiene orden ${String(etapa.orden)}: las etapas van numeradas 1, 2, 3… sin saltos.`);
    }
    if (!textoNoVacio(etapa.nombre)) errores.push(`${donde} no tiene nombre.`);
    if (!EJECUTORES.has(etapa.ejecutor as string)) {
      errores.push(`${donde}: ejecutor tiene que ser humano, agente o cualquiera.`);
    }
    revisarRoles(etapa.grupo, `${donde}: grupo`);
    if (!textoNoVacio(etapa.instrucciones)) {
      errores.push(`${donde} no tiene instrucciones: quien la tome no sabría cómo hacerla.`);
    }
    if (!REVISIONES.has(etapa.revision as string)) {
      errores.push(`${donde}: revision tiene que ser ninguna, agente, humana o ambas.`);
    }
    if (etapa.revisores !== undefined) revisarRoles(etapa.revisores, `${donde}: revisores`);
    for (const campo of ["pasos", "errores_frecuentes", "entradas_visibles"] as const) {
      if (etapa[campo] !== undefined && !listaDeTextos(etapa[campo])) {
        errores.push(`${donde}: ${campo} tiene que ser una lista de textos.`);
      }
    }
    if (etapa.criterios !== undefined) {
      if (!Array.isArray(etapa.criterios)) errores.push(`${donde}: criterios tiene que ser una lista.`);
      else etapa.criterios.forEach((criterio, posicion) => {
        if (!esObjeto(criterio) || !textoNoVacio(criterio.texto) || !["mecanico", "juicio"].includes(criterio.tipo as string)) {
          errores.push(`${donde}, criterio ${posicion + 1}: necesita tipo (mecanico o juicio) y texto.`);
        }
      });
    }
    if (etapa.herramientas !== undefined) {
      if (!Array.isArray(etapa.herramientas)) errores.push(`${donde}: herramientas tiene que ser una lista.`);
      else etapa.herramientas.forEach((herramienta, posicion) => {
        if (!esObjeto(herramienta) || !textoNoVacio(herramienta.nombre)) {
          errores.push(`${donde}, herramienta ${posicion + 1}: necesita nombre.`);
        }
      });
    }
    if (etapa.salidas !== undefined) {
      if (!esObjeto(etapa.salidas) || !Object.values(etapa.salidas).every(textoNoVacio)) {
        errores.push(`${donde}: salidas tiene que ser un objeto clave → descripción.`);
      }
    }
    if (etapa.requiere !== undefined) {
      if (!Array.isArray(etapa.requiere) || !etapa.requiere.every((r) => typeof r === "string" && CLAVE.test(r))) {
        errores.push(`${donde}: requiere tiene que ser una lista de nombres en minúsculas, por ejemplo ["hyperframes"].`);
      }
    }
    if (etapa.eleccion !== undefined) {
      const eleccion = etapa.eleccion;
      if (!esObjeto(eleccion) || !textoNoVacio(eleccion.opciones) || !textoNoVacio(eleccion.guarda)) {
        errores.push(`${donde}: eleccion necesita «opciones» (la salida con la lista) y «guarda» (dónde queda la elegida).`);
      } else {
        const salidas = esObjeto(etapa.salidas) ? etapa.salidas : {};
        if (!(eleccion.opciones in salidas)) {
          errores.push(`${donde}: eleccion.opciones dice «${eleccion.opciones}», que no es una de sus salidas.`);
        }
        if (!CLAVE.test(eleccion.guarda) || eleccion.guarda === "insumos" || eleccion.guarda in salidas) {
          errores.push(`${donde}: eleccion.guarda tiene que ser una clave nueva en minúsculas, distinta de sus salidas.`);
        }
        if (etapa.revision !== "humana" && etapa.revision !== "ambas") {
          errores.push(`${donde}: una etapa con eleccion necesita revision humana: elegir es de una persona.`);
        }
      }
    }
  });

  // Lo que una etapa dice ver tiene que haberlo dejado alguien antes.
  const disponibles = new Set(["insumos"]);
  etapas.forEach((etapa, indice) => {
    if (!esObjeto(etapa)) return;
    for (const clave of (Array.isArray(etapa.entradas_visibles) ? etapa.entradas_visibles : []) as string[]) {
      if (!disponibles.has(clave)) {
        errores.push(`La etapa ${indice + 1} quiere ver «${clave}», que ninguna etapa anterior deja.`);
      }
    }
    if (esObjeto(etapa.salidas)) for (const clave of Object.keys(etapa.salidas)) disponibles.add(clave);
    if (esObjeto(etapa.eleccion) && textoNoVacio(etapa.eleccion.guarda)) disponibles.add(etapa.eleccion.guarda);
  });

  return errores.length ? { ok: false, errores } : { ok: true, definicion: valor as unknown as Definicion };
}

/** Lo que pide la etapa y quien la quiere tomar no declaró tener. Vacía: la puede tomar. */
export function herramientasQueFaltan(etapa: Etapa, declaradas: readonly string[] = []) {
  const tiene = new Set(declaradas.map((herramienta) => herramienta.trim().toLowerCase()));
  return (etapa.requiere ?? []).filter((requisito) => !tiene.has(requisito));
}

/** Las opciones que dejó un cierre para elegir, o null si la etapa no pide elegir. */
export function opcionesParaElegir(etapa: Etapa, salidas: unknown): unknown[] | null {
  if (!etapa.eleccion) return null;
  const valor = esObjeto(salidas) ? salidas[etapa.eleccion.opciones] : undefined;
  return Array.isArray(valor) ? valor : [];
}

export function etapaPorOrden(definicion: Definicion, orden: number) {
  return definicion.etapas.find((etapa) => etapa.orden === orden) ?? null;
}

function descripcion(entrada: Entrada) {
  return typeof entrada === "string" ? entrada : entrada.descripcion ?? "";
}

/** Un texto que empieza con «opcional» marca la entrada como opcional; un objeto lo dice explícito. */
export function esRequerida(entrada: Entrada) {
  if (typeof entrada === "string") return !/^\s*opcional\b/i.test(entrada);
  return entrada.requerido !== false;
}

function vacio(valor: unknown) {
  if (valor === undefined || valor === null) return true;
  if (typeof valor === "string") return !valor.trim();
  if (Array.isArray(valor)) return !valor.length;
  if (esObjeto(valor)) return !Object.keys(valor).length;
  return false;
}

/** Lo que falta en un pedido, con la descripción que hay que mostrarle a quien lo completa. */
export function entradasFaltantes(definicion: Definicion, insumos: unknown) {
  const entradas = definicion.pedido?.entradas ?? {};
  const datos = esObjeto(insumos) ? insumos : {};
  return Object.entries(entradas)
    .filter(([clave, entrada]) => esRequerida(entrada) && vacio(datos[clave]))
    .map(([clave, entrada]) => ({ clave, descripcion: descripcion(entrada) }));
}

function esUrl(valor: unknown) {
  if (typeof valor !== "string") return false;
  try {
    const url = new URL(valor);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function buscarRespuesta(criterio: Criterio, posicion: number, respuestas: RespuestaCriterio[]) {
  return respuestas.find((respuesta) =>
    respuesta.criterio === posicion + 1
    || (typeof respuesta.criterio === "string" && respuesta.criterio.trim() === criterio.texto.trim()));
}

/** Los criterios de juicio que quedan para quien revisa, en vez de para quien cerró. */
export function juicioQuedaParaRevision(etapa: Etapa) {
  return etapa.revision === "humana" || etapa.revision === "ambas";
}

/**
 * Si un cierre se puede aceptar. Devuelve la lista de lo que falta, en el orden en que
 * conviene arreglarlo; vacía significa que cierra.
 *
 * Los criterios se responden uno por uno, con evidencia. Es la diferencia entre "lo
 * revisé" y decir qué se revisó: obliga a la IA a mirar cada uno, y a quien revisa le
 * deja escrito contra qué comparar.
 */
export function validarCierre(etapa: Etapa, cierre: {
  enlace: unknown;
  salidas: unknown;
  receta: unknown;
  criterios: unknown;
}) {
  const faltas: string[] = [];
  if (!esUrl(cierre.enlace)) {
    faltas.push("enlace: tiene que ser la dirección (https://…) del resultado en la carpeta compartida.");
  }

  const salidas = esObjeto(cierre.salidas) ? cierre.salidas : {};
  for (const [clave, que] of Object.entries(etapa.salidas ?? {})) {
    if (vacio(salidas[clave])) faltas.push(`salidas.${clave}: ${que}.`);
  }
  if (etapa.eleccion) {
    const opciones = salidas[etapa.eleccion.opciones];
    if (!vacio(opciones) && (!Array.isArray(opciones) || opciones.length < 2)) {
      faltas.push(`salidas.${etapa.eleccion.opciones}: tiene que ser una lista de al menos dos opciones, para que quien revisa elija.`);
    }
  }

  faltas.push(...faltasDeReceta(cierre.receta));

  const respuestas = Array.isArray(cierre.criterios) ? cierre.criterios as RespuestaCriterio[] : [];
  const paraRevision = juicioQuedaParaRevision(etapa);
  (etapa.criterios ?? []).forEach((criterio, posicion) => {
    if (criterio.tipo === "juicio" && paraRevision) return;
    const respuesta = buscarRespuesta(criterio, posicion, respuestas);
    const etiqueta = `criterio ${posicion + 1} («${criterio.texto}»)`;
    if (!respuesta) faltas.push(`${etiqueta}: falta responderlo.`);
    else if (respuesta.cumplido !== true) faltas.push(`${etiqueta}: no está cumplido. La etapa no cierra hasta que lo esté.`);
    else if (!textoNoVacio(respuesta.evidencia)) faltas.push(`${etiqueta}: falta la evidencia de cómo lo verificaste.`);
  });
  return faltas;
}

/**
 * Una línea para la tarjeta de un proceso que no tiene ficha: la primera oración de su
 * propósito, recortada. El propósito está escrito para la IA y puede ocupar una pantalla.
 */
export function resumenCorto(texto: unknown, maximo = 140) {
  if (typeof texto !== "string") return "";
  const limpio = texto.replace(/\s+/g, " ").trim();
  const oracion = limpio.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? limpio;
  if (oracion.length <= maximo) return oracion;
  const corte = oracion.slice(0, maximo);
  return `${corte.slice(0, Math.max(corte.lastIndexOf(" "), maximo - 30)).replace(/[\s,;:—-]+$/, "")}…`;
}

/** Con qué skill se hizo una iteración: lo dice la receta, o una herramienta «skill … vN». */
export function skillDeReceta(receta: unknown) {
  if (!esObjeto(receta)) return null;
  if (textoNoVacio(receta.skill)) return receta.skill.trim();
  const herramientas = Array.isArray(receta.herramientas) ? receta.herramientas : [];
  const encontrada = herramientas.find((h): h is string => typeof h === "string" && /^skill\s+\S/i.test(h.trim()));
  return encontrada ? encontrada.trim().replace(/^skill\s+/i, "") : null;
}

/**
 * Si una dirección sirve como enlace a la conversación donde se hizo algo. Además de la web,
 * vale `claude://`: es el enlace que da la app de Claude a una sesión de la propia máquina.
 */
export function esEnlaceDeConversacion(valor: unknown) {
  if (typeof valor !== "string") return false;
  try {
    return ["https:", "http:", "claude:"].includes(new URL(valor).protocol);
  } catch {
    return false;
  }
}

/** Lo que le falta a una receta para que otra persona la pueda seguir. Vacía: está completa. */
export function faltasDeReceta(valor: unknown) {
  const faltas: string[] = [];
  const receta = esObjeto(valor) ? valor : {};
  if (!listaDeTextos(receta.pasos) || !(receta.pasos as string[]).length) {
    faltas.push("receta.pasos: qué hiciste, en orden, como lista de textos.");
  }
  if (!listaDeTextos(receta.herramientas)) {
    faltas.push("receta.herramientas: qué skills, conectores o programas usaste (lista; vacía si ninguno).");
  }
  if (!textoNoVacio(receta.modelo)) faltas.push("receta.modelo: qué IA usaste, por ejemplo «Claude Opus» o «ChatGPT».");
  if (!listaDeTextos(receta.decisiones)) {
    faltas.push("receta.decisiones: qué elegiste y por qué cuando había opciones (lista; vacía si no hubo).");
  }
  if (receta.fallos !== undefined && !listaDeTextos(receta.fallos)) {
    faltas.push("receta.fallos: tiene que ser una lista de textos.");
  }
  if (receta.prompts !== undefined && !listaDeTextos(receta.prompts)) {
    faltas.push("receta.prompts: tiene que ser una lista con los prompts textuales que funcionaron.");
  }
  if (receta.skill !== undefined && !textoNoVacio(receta.skill)) {
    faltas.push("receta.skill: con qué skill y versión se hizo, por ejemplo «carrusel-p3-negocios v2».");
  }
  if (receta.descartes !== undefined && !listaDeTextos(receta.descartes)) {
    faltas.push("receta.descartes: tiene que ser una lista de lo que se probó y no funcionó.");
  }
  return faltas;
}

// ---------------------------------------------------------------------------------------
// Procesos que nacen de lo que salió bien
// ---------------------------------------------------------------------------------------

/** Una clave estable a partir de un nombre: «Carrusel P3 · estilo X» → «carrusel-p3-estilo-x». */
export function claveDeNombre(nombre: string) {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "proceso";
}

/**
 * La clave estable de un proceso. La declara la definición (`proceso`); si no la declara,
 * sale del nombre. Los procesos anteriores a la plataforma 1.12 guardaban una versión por
 * registro, con « vN» al final del nombre: comparten clave, y por eso se ven como uno.
 */
export function familiaDe(proceso: { nombre?: unknown; definicion?: unknown }) {
  const definicion = esObjeto(proceso.definicion) ? proceso.definicion : {};
  if (typeof definicion.proceso === "string" && definicion.proceso.trim()) return claveDeNombre(definicion.proceso);
  return claveDeNombre(String(proceso.nombre ?? "").replace(/\s+v\d+\s*$/i, ""));
}

/** El nombre de un proceso para mostrar: sin el « vN» que llevaban los registros viejos. */
export function nombreDeFamilia(nombre: unknown) {
  return String(nombre ?? "").replace(/\s+v\d+\s*$/i, "").trim();
}

export type Receta = {
  pasos: string[];
  herramientas: string[];
  modelo: string;
  decisiones: string[];
  prompts?: string[];
  /** Con qué skill y versión se hizo, si se hizo con una. */
  skill?: string;
  descartes?: string[];
  fallos?: string[];
};

/**
 * La definición de un proceso que nace de una receta: alguien hizo algo, le quedó bien,
 * y lo registró. Es una sola etapa —hacerlo— cuyas instrucciones son cómo se hizo. Se
 * mejora con lo que muestren las iteraciones.
 */
export function definicionDesdeReceta(entrada: {
  nombre: string;
  proposito: string;
  receta: Receta;
  roles: readonly string[];
  revisores: readonly string[];
  donde?: string;
}): Definicion & { proceso: string; nacio_de_registro: true } {
  const { receta } = entrada;
  const prompts = receta.prompts?.length
    ? ["", "Los prompts que funcionaron, tal cual:", ...receta.prompts.map((prompt) => `\n> ${prompt.replace(/\n/g, "\n> ")}`)]
    : [];
  const decisiones = receta.decisiones.length ? ["", "Decisiones que se tomaron:", ...receta.decisiones.map((d) => `- ${d}`)] : [];
  return {
    proceso: claveDeNombre(entrada.nombre),
    nacio_de_registro: true,
    proposito: entrada.proposito,
    ...(entrada.donde ? { donde_vive_el_resultado: entrada.donde } : {}),
    etapas: [{
      orden: 1,
      clave: "hacerlo",
      nombre: "Hacerlo",
      ejecutor: "cualquiera",
      grupo: [...new Set(entrada.roles)],
      instrucciones: [
        `Así se hizo la vez que salió bien, con ${receta.modelo}. Seguilo en ese orden; si algo no funciona igual, anotalo: es lo que mejora el proceso.`,
        ...prompts,
        ...decisiones,
      ].join("\n"),
      pasos: receta.pasos,
      herramientas: receta.herramientas.map((nombre) => ({ nombre })),
      ...(receta.descartes?.length ? { errores_frecuentes: receta.descartes } : {}),
      revision: "humana",
      revisores: [...new Set(entrada.revisores)],
    }],
  };
}

/**
 * Cómo se hace un proceso, para quien lo va a hacer sin abrir un caso: por ejemplo, para
 * reproducirlo en otra máquina o con otra IA. Es la definición vigente más la receta de
 * las últimas veces que salió bien.
 */
export function guiaDeProceso(entrada: {
  nombre: string;
  definicion: Definicion;
  recientes: Array<{
    titulo: string;
    fecha: unknown;
    receta: unknown;
    resultado: unknown;
    imagenes?: Array<{ id: string; nombre: string }>;
  }>;
}) {
  const { definicion } = entrada;
  const partes = [`# ${entrada.nombre}`];
  const skill = definicion.ficha?.skill;
  if (skill?.nombre) {
    partes.push(
      "",
      `Se hace con la skill ${skill.nombre}${skill.repo ? ` (${skill.repo})` : ""}. El método vigente es el de la skill: antes de empezar, traé su última versión. Lo que sigue es el resumen y lo que pasó las últimas veces.`,
    );
  }
  if (definicion.proposito) partes.push("", `Para qué: ${definicion.proposito}`);
  for (const etapa of definicion.etapas) {
    partes.push("", definicion.etapas.length > 1 ? `## Etapa ${etapa.orden}: ${etapa.nombre}` : "## Cómo se hace", "", etapa.instrucciones.trim());
    if (etapa.pasos?.length) partes.push("", lista(etapa.pasos, true));
    if (etapa.herramientas?.length) partes.push("", `Herramientas: ${etapa.herramientas.map((h) => h.nombre).join(", ")}.`);
    if (etapa.errores_frecuentes?.length) partes.push("", "Lo que no funcionó:", lista(etapa.errores_frecuentes));
  }
  if (definicion.donde_vive_el_resultado) partes.push("", `Dónde va el resultado: ${definicion.donde_vive_el_resultado}`);
  if (entrada.recientes.length) {
    partes.push("", "## Las últimas veces que salió bien");
    for (const reciente of entrada.recientes) {
      const receta = esObjeto(reciente.receta) ? reciente.receta : {};
      partes.push("", `### ${reciente.titulo}`);
      if (typeof receta.modelo === "string") partes.push(`Con ${receta.modelo}.`);
      if (listaDeTextos(receta.pasos)) partes.push(lista(receta.pasos as string[], true));
      if (listaDeTextos(receta.prompts) && (receta.prompts as string[]).length) {
        partes.push("Prompts:", ...(receta.prompts as string[]).map((prompt) => `> ${prompt.replace(/\n/g, "\n> ")}`));
      }
      if (typeof reciente.resultado === "string") partes.push(`Resultado: ${reciente.resultado}`);
      if (reciente.imagenes?.length) {
        partes.push(
          `Imágenes del resultado (${reciente.imagenes.length}): miralas con read_attachment antes de empezar, en este orden.`,
          ...reciente.imagenes.map((imagen, indice) => `${indice + 1}. ${imagen.nombre} — ${imagen.id}`),
        );
      }
    }
  }
  partes.push(
    "",
    "## Al terminar",
    "",
    "Si salió bien, registralo con registrar_iteracion como reproducción, diciendo si salió igual y, si no, qué faltó en la receta. En receta.skill poné con qué skill y qué commit se hizo. Eso es lo que permite mejorar el proceso.",
  );
  return partes.join("\n");
}

export type Destino =
  | { tipo: "revision" }
  | { tipo: "siguiente"; orden: number }
  | { tipo: "entrega" };

export function destinoTrasAprobar(definicion: Definicion, etapa: Etapa): Destino {
  const siguiente = etapaPorOrden(definicion, etapa.orden + 1);
  return siguiente ? { tipo: "siguiente", orden: siguiente.orden } : { tipo: "entrega" };
}

export function destinoTrasCerrar(definicion: Definicion, etapa: Etapa): Destino {
  return juicioQuedaParaRevision(etapa) ? { tipo: "revision" } : destinoTrasAprobar(definicion, etapa);
}

export function puedeTomar(etapa: Etapa, roles: readonly string[]) {
  return roles.length > 0 && roles.every((rol) => etapa.grupo.includes(rol));
}

export function puedeRevisar(etapa: Etapa, roles: readonly string[], rolesQueAdministran: readonly string[]) {
  const revisores = etapa.revisores?.length ? etapa.revisores : rolesQueAdministran;
  return roles.length > 0 && roles.every((rol) => revisores.includes(rol));
}

/** Lo que una etapa puede ver de lo acumulado. Lo que no declara no se muestra. */
export function visiblesParaEtapa(etapa: Etapa, acumulado: Record<string, unknown>) {
  return Object.fromEntries(
    (etapa.entradas_visibles ?? [])
      .filter((clave) => clave in acumulado)
      .map((clave) => [clave, acumulado[clave]]),
  );
}

export type ContextoGuia = {
  titulo: string;
  proceso: string;
  definicion: Definicion;
  etapa: Etapa;
  estado: string;
  visibles: Record<string, unknown>;
  /** El motivo de la última devolución, si la etapa volvió de revisión. */
  devolucion?: string | null;
  /** Lo que está esperando, si quedó en espera. */
  espera?: string | null;
};

function lista(items: readonly string[], numerada = false) {
  return items.map((item, indice) => (numerada ? `${indice + 1}. ${item}` : `- ${item}`)).join("\n");
}

/**
 * La guía de una etapa, escrita para la IA de quien la tomó.
 *
 * Es el reemplazo de "saber qué skill usar": la persona no necesita conocer el método,
 * porque la etapa se lo dice a su IA cada vez, con la versión vigente del proceso. Lo
 * único que se le pide a la persona es lo que sólo ella puede dar: insumos y criterio.
 */
export function componerGuia(contexto: ContextoGuia) {
  const { etapa, definicion } = contexto;
  const total = definicion.etapas.length;
  const partes: string[] = [
    `# ${contexto.titulo}`,
    `Proceso «${contexto.proceso}». Etapa ${etapa.orden} de ${total}: **${etapa.nombre}**. Estado: ${contexto.estado}.`,
  ];
  if (definicion.proposito) partes.push("", `Para qué existe este proceso: ${definicion.proposito}`);

  if (contexto.devolucion) {
    partes.push("", "## Te la devolvieron", "", `Motivo: ${contexto.devolucion}`, "Corregí eso antes que nada y volvé a cerrar.");
  }
  if (contexto.espera) partes.push("", "## Está esperando", "", contexto.espera);

  partes.push("", "## Lo que tenés para trabajar", "");
  partes.push(Object.keys(contexto.visibles).length
    ? "```json\n" + JSON.stringify(contexto.visibles, null, 2) + "\n```"
    : "Esta etapa no recibe nada de las anteriores.");

  if (etapa.requiere?.length) {
    partes.push(
      "",
      "## Qué necesita la máquina",
      "",
      `Esta etapa se trabaja en una máquina que tenga: ${etapa.requiere.join(", ")}. Si no lo tenés, no la tomes: liberala con liberar_caso diciendo qué te falta.`,
    );
  }

  const herramientas = etapa.herramientas ?? [];
  if (herramientas.length) {
    partes.push("", "## Herramientas", "", "Antes de empezar, comprobá que tenés disponible cada una. No la reemplaces por otra parecida.", "");
    for (const herramienta of herramientas) {
      const tipo = herramienta.tipo ? ` (${herramienta.tipo})` : "";
      const siNoEsta = herramienta.si_no_esta
        ?? "no improvises: llamá esperar_caso diciendo qué herramienta falta, y avisale a la persona.";
      partes.push(`- **${herramienta.nombre}**${tipo}${herramienta.uso ? `: ${herramienta.uso}` : ""}. Si no la tenés: ${siNoEsta}`);
    }
  }

  partes.push("", "## Cómo se hace", "", etapa.instrucciones.trim());
  if (etapa.pasos?.length) partes.push("", lista(etapa.pasos, true));
  if (etapa.errores_frecuentes?.length) partes.push("", "## Errores frecuentes", "", lista(etapa.errores_frecuentes));

  const criterios = etapa.criterios ?? [];
  if (criterios.length) {
    const paraRevision = juicioQuedaParaRevision(etapa);
    partes.push("", "## Qué se controla", "");
    criterios.forEach((criterio, indice) => {
      const quien = criterio.tipo === "mecanico"
        ? "lo verificás vos y das la evidencia"
        : paraRevision ? "lo juzga quien revisa" : "lo juzgás vos y das la evidencia";
      partes.push(`${indice + 1}. ${criterio.texto} — ${quien}.`);
    });
  }

  if (etapa.ejecutor === "humano") {
    partes.push(
      "",
      "## Qué le toca a la persona",
      "",
      "Esta etapa la decide o la hace una persona, no una IA. Tu trabajo es pedirle lo que haga falta, registrar lo que decida y cerrar. No decidas por ella.",
    );
  }

  const salidas = Object.entries(etapa.salidas ?? {});
  partes.push("", "## Cómo cerrar", "", "Llamá cerrar_etapa con:");
  partes.push(lista([
    "resumen: una línea con lo que quedó hecho.",
    "enlace: la dirección del resultado en la carpeta compartida de la organización, nunca en una carpeta personal.",
    salidas.length
      ? `salidas: ${salidas.map(([clave, que]) => `«${clave}» (${que})`).join(", ")}.`
      : "salidas: {} si la etapa no deja nada más que el enlace.",
    "receta: pasos, herramientas, modelo (qué IA usaste), decisiones y, si hubo, fallos.",
    criterios.length
      ? "criterios: uno por cada criterio de arriba, con su número, cumplido y la evidencia."
      : "criterios: [] (esta etapa no tiene criterios).",
  ]));
  if (etapa.eleccion) {
    partes.push(
      "",
      `Esta etapa termina en una elección. En «${etapa.eleccion.opciones}» dejá una lista de opciones, cada una como objeto con «titulo» y «descripcion», y «vista_previa» con la dirección de una imagen si la hay. Quien revisa elige una desde el panel, sin abrir carpetas: escribí cada opción para que se entienda sola. La elegida queda como «${etapa.eleccion.guarda}» para las etapas siguientes.`,
    );
  }
  if (definicion.donde_vive_el_resultado) partes.push("", `Dónde va el resultado: ${definicion.donde_vive_el_resultado}`);

  const revision = {
    ninguna: "Sin revisión: al cerrar pasa directo a la etapa siguiente.",
    agente: "La revisión es de un agente: los criterios mecánicos con evidencia son la revisión. Al cerrar pasa a la siguiente.",
    humana: etapa.eleccion
      ? "Al cerrar queda en revisión de una persona, que elige una de las opciones o te la devuelve con el motivo."
      : "Al cerrar queda en revisión de una persona, que la aprueba o te la devuelve con el motivo.",
    ambas: "Al cerrar queda en revisión de una persona, que además mira la evidencia de los criterios mecánicos.",
  }[etapa.revision];
  partes.push("", "## Después", "", revision);
  partes.push("", "Si te falta algo que no podés conseguir vos —un archivo, un dato, una decisión, una herramienta— llamá esperar_caso con lo que falta. No cierres con algo inventado.");
  return partes.join("\n");
}
