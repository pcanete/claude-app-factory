/**
 * Qué es un proceso y qué es una iteración, sin base de datos ni red. Lo prueba
 * `scripts/test-process-definition.mjs` sobre este mismo archivo.
 *
 * Desde la plataforma 2.0 el sistema tiene un solo objetivo: registrar con fidelidad cómo
 * alguien hizo algo en su máquina, para que otra persona lo repita en otra máquina con otra
 * IA. Para eso alcanzan dos piezas:
 *
 * - El **proceso** dice qué hace, con qué skill, qué tiene que tener la máquina para hacerlo
 *   (requisitos que se pueden comprobar), qué tiene que dejar registrado cada vez y en qué
 *   carpeta de Dropbox va lo producido.
 * - La **iteración** es una vez que se hizo: la carpeta con lo producido, los datos que el
 *   proceso pide, la receta, la skill con su commit y la conversación.
 *
 * No hay etapas, colas, revisiones ni aprobaciones. Estado y responsable son opcionales.
 */

export type TipoRequisito = "skill" | "libreria" | "programa" | "conector" | "variable" | "archivo";

/** Algo que la máquina tiene que tener, con cómo comprobarlo y cómo conseguirlo. */
export type Requisito = {
  nombre: string;
  tipo: TipoRequisito;
  /** Cómo comprobar que está: un comando o qué mirar. Lo ejecuta la IA en esa máquina. */
  verificar: string;
  /** Qué hacer si falta. */
  instalar?: string;
};

/** Un dato que cada iteración tiene que dejar. Lo declara el proceso, no lo inventa la persona. */
export type CampoDeRegistro = {
  clave: string;
  descripcion: string;
  /** Por defecto, obligatorio. */
  requerido?: boolean;
};

/** Lo que una persona lee para saber cómo se hace algo. */
export type Ficha = {
  /** Qué hace, en una línea. Es lo que muestra la tarjeta del proceso. */
  resumen?: string;
  /** Qué hay que darle para empezar. */
  entrada?: string;
  /** Qué entrega. */
  entrega?: string;
  /** La frase para pedírselo a una IA. */
  pedido_ejemplo?: string;
  /** La skill con la que se hace y su repositorio. La versión es el commit, no se anota acá. */
  skill?: { nombre: string; repo?: string };
};

export type Definicion = {
  /** La clave estable del proceso. Si falta, sale del nombre. */
  proceso?: string;
  ficha?: Ficha;
  /** Cómo se hace, en markdown, para procesos sin skill o como resumen de la skill. */
  metodo?: string;
  requisitos?: Requisito[];
  registro?: CampoDeRegistro[];
  /** La carpeta de Dropbox donde va cada iteración, por ejemplo «/Clientes/x/piezas/». */
  carpeta?: string;
};

export type Receta = {
  pasos: string[];
  prompts?: string[];
  herramientas: string[];
  modelo: string;
  decisiones: string[];
  descartes?: string[];
};

export type Reproduccion = { salio_igual: boolean; que_falto?: string };

export const TIPOS_DE_REQUISITO: readonly TipoRequisito[] = ["skill", "libreria", "programa", "conector", "variable", "archivo"];
const CLAVE = /^[a-z][a-z0-9_]{0,47}$/;

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
}

function textoNoVacio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

function listaDeTextos(valor: unknown): valor is string[] {
  return Array.isArray(valor) && valor.every((item) => typeof item === "string");
}

function esUrlWeb(valor: unknown) {
  if (typeof valor !== "string") return false;
  try {
    return ["https:", "http:"].includes(new URL(valor).protocol);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------
// El proceso
// ---------------------------------------------------------------------------------------

/**
 * Revisa una definición. Tolera campos de más —los procesos anteriores a la 2.0 traen
 * `etapas`, `proposito` y otros— y no los usa.
 */
export function validarDefinicion(valor: unknown): { ok: true; definicion: Definicion } | { ok: false; errores: string[] } {
  if (!esObjeto(valor)) return { ok: false, errores: ["La definición tiene que ser un objeto."] };
  const errores: string[] = [];

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
      if (ficha.skill !== undefined) {
        const skill = ficha.skill;
        if (!esObjeto(skill) || !textoNoVacio(skill.nombre)) errores.push("ficha.skill necesita nombre.");
        else if (skill.repo !== undefined && !esUrlWeb(skill.repo)) {
          errores.push("ficha.skill.repo tiene que ser la dirección (https://…) del repositorio.");
        }
      }
    }
  }

  if (valor.metodo !== undefined && typeof valor.metodo !== "string") errores.push("metodo tiene que ser un texto.");
  if (valor.carpeta !== undefined && !textoNoVacio(valor.carpeta)) errores.push("carpeta tiene que ser la ruta de Dropbox, por ejemplo «/Clientes/x/piezas/».");

  if (valor.requisitos !== undefined) {
    if (!Array.isArray(valor.requisitos)) errores.push("requisitos tiene que ser una lista.");
    else {
      valor.requisitos.forEach((requisito, indice) => {
        const donde = `El requisito ${indice + 1}`;
        if (!esObjeto(requisito)) return void errores.push(`${donde} no es un objeto.`);
        if (!textoNoVacio(requisito.nombre)) errores.push(`${donde} necesita nombre.`);
        if (!TIPOS_DE_REQUISITO.includes(requisito.tipo as TipoRequisito)) {
          errores.push(`${donde} tiene que tener tipo: ${TIPOS_DE_REQUISITO.join(", ")}.`);
        }
        if (!textoNoVacio(requisito.verificar)) errores.push(`${donde} necesita «verificar»: cómo se comprueba que está.`);
        if (requisito.instalar !== undefined && typeof requisito.instalar !== "string") errores.push(`${donde}: «instalar» tiene que ser un texto.`);
      });
    }
  }

  if (valor.registro !== undefined) {
    if (!Array.isArray(valor.registro)) errores.push("registro tiene que ser una lista.");
    else {
      const vistas = new Set<string>();
      valor.registro.forEach((campo, indice) => {
        const donde = `El dato ${indice + 1} del registro`;
        if (!esObjeto(campo)) return void errores.push(`${donde} no es un objeto.`);
        if (typeof campo.clave !== "string" || !CLAVE.test(campo.clave)) {
          errores.push(`${donde} necesita una clave en minúsculas, sin espacios (por ejemplo «deportista»).`);
        } else if (vistas.has(campo.clave)) errores.push(`El registro repite la clave «${campo.clave}».`);
        else vistas.add(campo.clave);
        if (!textoNoVacio(campo.descripcion)) errores.push(`${donde} necesita una descripción.`);
        if (campo.requerido !== undefined && typeof campo.requerido !== "boolean") errores.push(`${donde}: «requerido» es sí o no.`);
      });
    }
  }

  if (errores.length) return { ok: false, errores };
  return {
    ok: true,
    definicion: {
      ...(textoNoVacio(valor.proceso) ? { proceso: valor.proceso } : {}),
      ...(esObjeto(valor.ficha) ? { ficha: valor.ficha as Ficha } : {}),
      ...(typeof valor.metodo === "string" && valor.metodo.trim() ? { metodo: valor.metodo } : {}),
      requisitos: (valor.requisitos as Requisito[] | undefined) ?? [],
      registro: (valor.registro as CampoDeRegistro[] | undefined) ?? [],
      ...(textoNoVacio(valor.carpeta) ? { carpeta: valor.carpeta } : {}),
    },
  };
}

/**
 * Lo que le falta a un proceso para que otra persona lo pueda repetir. Vacía: está completo.
 *
 * `validarDefinicion` revisa la forma y tolera procesos viejos a medias, para poder leerlos.
 * Ésta es la vara para guardar: un proceso no se crea ni se edita si le falta algo de esto,
 * lo haga una persona en el panel o su agente por MCP.
 */
export function faltasDeFicha(definicion: Definicion): string[] {
  const ficha = definicion.ficha ?? {};
  const faltas: string[] = [];
  if (!textoNoVacio(ficha.resumen)) faltas.push("qué hace, en una línea (ficha.resumen)");
  if (!textoNoVacio(ficha.entrada)) faltas.push("qué hay que darle para empezar (ficha.entrada)");
  if (!textoNoVacio(ficha.entrega)) faltas.push("qué entrega (ficha.entrega)");
  const conSkill = textoNoVacio(ficha.skill?.nombre) && textoNoVacio(ficha.skill?.repo);
  if (!conSkill && !textoNoVacio(definicion.metodo)) {
    faltas.push(textoNoVacio(ficha.skill?.nombre)
      ? "el repositorio de la skill (ficha.skill.repo)"
      : "la skill con su repositorio (ficha.skill) o, si no hay skill, cómo se hace (metodo)");
  }
  if (!esCarpetaDeDropbox(definicion.carpeta)) faltas.push("la carpeta de Dropbox donde va cada iteración (carpeta)");
  if (!(definicion.requisitos ?? []).length) faltas.push("al menos un requisito, con cómo comprobarlo (requisitos)");
  if (!(definicion.registro ?? []).length) faltas.push("al menos un dato que se registra cada vez (registro)");
  return faltas;
}

/** Una clave estable a partir de un nombre: «Carrusel P3 · estilo X» → «carrusel-p3-estilo-x». */
export function claveDeNombre(nombre: string) {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "proceso";
}

/**
 * La clave estable de un proceso. La declara la definición (`proceso`); si no la declara,
 * sale del nombre. Los registros anteriores a la 1.12 llevaban « vN» al final del nombre:
 * comparten clave, y por eso se ven como uno.
 */
export function familiaDe(proceso: { nombre?: unknown; definicion?: unknown }) {
  const definicion = esObjeto(proceso.definicion) ? proceso.definicion : {};
  if (typeof definicion.proceso === "string" && definicion.proceso.trim()) return claveDeNombre(definicion.proceso);
  return claveDeNombre(String(proceso.nombre ?? "").replace(/\s+v\d+\s*$/i, ""));
}

/** El nombre para mostrar: sin el « vN» que llevaban los registros viejos. */
export function nombreDeFamilia(nombre: unknown) {
  return String(nombre ?? "").replace(/\s+v\d+\s*$/i, "").trim();
}

/** La primera oración, recortada. */
export function resumenCorto(texto: unknown, maximo = 140) {
  if (typeof texto !== "string") return "";
  const limpio = texto.replace(/\s+/g, " ").trim();
  const oracion = limpio.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? limpio;
  if (oracion.length <= maximo) return oracion;
  const corte = oracion.slice(0, maximo);
  return `${corte.slice(0, Math.max(corte.lastIndexOf(" "), maximo - 30)).replace(/[\s,;:—-]+$/, "")}…`;
}

// ---------------------------------------------------------------------------------------
// Requisitos y registro escritos por una persona, una línea por elemento
// ---------------------------------------------------------------------------------------

/**
 * Lee los requisitos del formulario: una línea por requisito,
 * «nombre | tipo | cómo verificar | cómo instalar». Devuelve también las líneas que no se
 * entendieron, para decirlas en vez de perderlas.
 */
export function requisitosDeTexto(texto: string) {
  const requisitos: Requisito[] = [];
  const errores: string[] = [];
  for (const [indice, linea] of texto.split(/\r?\n/).entries()) {
    if (!linea.trim()) continue;
    const [nombre, tipo, verificar, ...resto] = linea.split("|").map((parte) => parte.trim());
    const instalar = resto.join(" | ").trim();
    const tipoNormal = (tipo ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") as TipoRequisito;
    if (!nombre || !TIPOS_DE_REQUISITO.includes(tipoNormal) || !verificar) {
      errores.push(`Línea ${indice + 1}: «nombre | tipo | cómo verificar | cómo instalar», con tipo ${TIPOS_DE_REQUISITO.join(", ")}.`);
      continue;
    }
    requisitos.push({ nombre, tipo: tipoNormal, verificar, ...(instalar ? { instalar } : {}) });
  }
  return { requisitos, errores };
}

export function requisitosATexto(requisitos: readonly Requisito[] | undefined) {
  return (requisitos ?? []).map((r) => [r.nombre, r.tipo, r.verificar, r.instalar ?? ""].join(" | ").replace(/\s\|\s$/, "")).join("\n");
}

/** «clave | descripción | opcional», una línea por dato. */
export function registroDeTexto(texto: string) {
  const registro: CampoDeRegistro[] = [];
  const errores: string[] = [];
  for (const [indice, linea] of texto.split(/\r?\n/).entries()) {
    if (!linea.trim()) continue;
    const [clave, descripcion, marca] = linea.split("|").map((parte) => parte.trim());
    if (!clave || !CLAVE.test(clave) || !descripcion) {
      errores.push(`Línea ${indice + 1}: «clave | descripción | opcional», con la clave en minúsculas y sin espacios.`);
      continue;
    }
    registro.push({ clave, descripcion, ...(marca && /^opcional$/i.test(marca) ? { requerido: false } : {}) });
  }
  return { registro, errores };
}

export function registroATexto(registro: readonly CampoDeRegistro[] | undefined) {
  return (registro ?? []).map((c) => [c.clave, c.descripcion, c.requerido === false ? "opcional" : ""].join(" | ").replace(/\s\|\s$/, "")).join("\n");
}

// ---------------------------------------------------------------------------------------
// La iteración
// ---------------------------------------------------------------------------------------

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

/**
 * Si una dirección es una carpeta de Dropbox: el enlace web (`https://www.dropbox.com/…`) o
 * la ruta dentro de Dropbox (`/Clientes/…`). Lo producido tiene que quedar ahí.
 */
export function esCarpetaDeDropbox(valor: unknown) {
  if (typeof valor !== "string" || !valor.trim()) return false;
  const texto = valor.trim();
  if (texto.startsWith("/")) return texto.length > 1 && !texto.includes("..");
  try {
    const url = new URL(texto);
    return url.protocol === "https:" && /(^|\.)dropbox\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/** Lo que le falta a una receta para que otra persona la pueda seguir. Vacía: está completa. */
export function faltasDeReceta(valor: unknown) {
  const faltas: string[] = [];
  const receta = esObjeto(valor) ? valor : {};
  if (!listaDeTextos(receta.pasos) || !receta.pasos.length) faltas.push("receta.pasos: qué se hizo, en orden, como lista de textos.");
  if (!listaDeTextos(receta.herramientas)) faltas.push("receta.herramientas: qué skills, conectores o programas se usaron (lista; vacía si ninguno).");
  if (!textoNoVacio(receta.modelo)) faltas.push("receta.modelo: qué IA se usó.");
  if (!listaDeTextos(receta.decisiones)) faltas.push("receta.decisiones: qué se eligió y por qué (lista; vacía si no hubo).");
  if (receta.prompts !== undefined && !listaDeTextos(receta.prompts)) faltas.push("receta.prompts: lista con los prompts textuales que funcionaron.");
  if (receta.descartes !== undefined && !listaDeTextos(receta.descartes)) faltas.push("receta.descartes: lista de lo que se probó y no funcionó.");
  return faltas;
}

/** Los datos que pide el registro del proceso y no vinieron. */
export function datosFaltantes(registro: readonly CampoDeRegistro[], datos: unknown) {
  const valores = esObjeto(datos) ? datos : {};
  return registro
    .filter((campo) => campo.requerido !== false)
    .filter((campo) => {
      const valor = valores[campo.clave];
      return valor === undefined || valor === null || (typeof valor === "string" && !valor.trim())
        || (Array.isArray(valor) && !valor.length);
    })
    .map((campo) => `datos.${campo.clave}: ${campo.descripcion}`);
}

/**
 * Todo lo que una iteración necesita para registrarse. Vacío: se puede guardar.
 *
 * Lo que no se negocia es la carpeta de Dropbox con lo producido y la lista de archivos que
 * quedaron ahí: es lo que otra persona va a abrir. Lo demás lo pide el proceso.
 */
export function faltasDeIteracion(definicion: Definicion, entrada: {
  titulo?: unknown;
  carpeta?: unknown;
  archivos?: unknown;
  datos?: unknown;
  receta?: unknown;
  conversacion?: unknown;
  reproduccion?: unknown;
}) {
  const faltas: string[] = [];
  if (!textoNoVacio(entrada.titulo)) faltas.push("titulo: qué se hizo esta vez.");
  if (!esCarpetaDeDropbox(entrada.carpeta)) {
    faltas.push("carpeta: la carpeta de Dropbox donde quedó lo producido (https://www.dropbox.com/… o /Clientes/…).");
  }
  if (!listaDeTextos(entrada.archivos) || !entrada.archivos.length) {
    faltas.push("archivos: los archivos que quedaron en esa carpeta, comprobados con el conector de Dropbox. Sin archivos en Dropbox no hay iteración.");
  }
  faltas.push(...faltasDeReceta(entrada.receta));
  faltas.push(...datosFaltantes(definicion.registro ?? [], entrada.datos));
  if (entrada.conversacion !== undefined && entrada.conversacion !== "" && !esEnlaceDeConversacion(entrada.conversacion)) {
    faltas.push("conversacion: la dirección de la conversación (https://… o claude://…).");
  }
  if (entrada.reproduccion !== undefined) {
    const r = entrada.reproduccion;
    if (!esObjeto(r) || typeof r.salio_igual !== "boolean") faltas.push("reproduccion.salio_igual: si salió igual que la receta.");
    else if (!r.salio_igual && !textoNoVacio(r.que_falto)) faltas.push("reproduccion.que_falto: si no salió igual, qué faltó.");
  }
  return faltas;
}

/** Con qué skill y commit se hizo, según lo registrado. */
export function skillDeIteracion(valor: { skill?: unknown; receta?: unknown }) {
  if (textoNoVacio(valor.skill)) return valor.skill.trim();
  const receta = esObjeto(valor.receta) ? valor.receta : {};
  if (textoNoVacio(receta.skill)) return receta.skill.trim();
  const herramientas = Array.isArray(receta.herramientas) ? receta.herramientas : [];
  const encontrada = herramientas.find((h): h is string => typeof h === "string" && /^skill\s+\S/i.test(h.trim()));
  return encontrada ? encontrada.trim().replace(/^skill\s+/i, "") : null;
}

// ---------------------------------------------------------------------------------------
// Lo que lee la IA
// ---------------------------------------------------------------------------------------

function lista(items: readonly string[], numerada = false) {
  return items.map((item, indice) => `${numerada ? `${indice + 1}.` : "-"} ${item}`).join("\n");
}

/**
 * La guía para repetir un proceso en otra máquina: qué comprobar antes, cómo se hace, qué
 * hay que registrar y dónde guardar. Es texto para la IA de quien lo va a hacer.
 */
export function guiaDeProceso(entrada: {
  nombre: string;
  definicion: Definicion;
  recientes: Array<{ titulo: string; skill?: string | null; receta: unknown; carpeta: unknown; imagenes?: Array<{ id: string; nombre: string }> }>;
}) {
  const { definicion } = entrada;
  const partes = [`# ${entrada.nombre}`];
  if (definicion.ficha?.resumen) partes.push("", definicion.ficha.resumen);

  partes.push("", "## 1. Antes de empezar: comprobá la máquina");
  const skill = definicion.ficha?.skill;
  const requisitos = [...(definicion.requisitos ?? [])];
  if (skill?.nombre && !requisitos.some((r) => r.tipo === "skill" && r.nombre === skill.nombre)) {
    requisitos.unshift({
      nombre: skill.nombre,
      tipo: "skill",
      verificar: `que la skill ${skill.nombre} esté instalada en esta máquina`,
      ...(skill.repo ? { instalar: `clonar ${skill.repo} y enlazar la skill` } : {}),
    });
  }
  if (requisitos.length) {
    partes.push(
      "",
      "Comprobá cada uno en esta máquina antes de hacer nada. Si falta alguno, instalalo con lo que dice o avisale a la persona y pará: no lo reemplaces por otra cosa.",
      "",
      ...requisitos.map((r, i) => `${i + 1}. **${r.nombre}** (${r.tipo}) — comprobar: ${r.verificar}${r.instalar ? ` — si falta: ${r.instalar}` : ""}`),
    );
  } else {
    partes.push("", "El proceso no declara requisitos.");
  }
  if (skill?.nombre) {
    partes.push("", `Traé la última versión de la skill ${skill.nombre} antes de usarla, y anotá su commit: va en el registro.`);
  }

  partes.push("", "## 2. Cómo se hace");
  if (skill?.nombre) partes.push("", `Seguí la skill ${skill.nombre}${skill.repo ? ` (${skill.repo})` : ""}: el método vigente es el suyo.`);
  if (definicion.metodo) partes.push("", definicion.metodo.trim());
  if (!skill?.nombre && !definicion.metodo) partes.push("", "Seguí la receta de las últimas veces que salió bien, más abajo.");

  partes.push("", "## 3. Dónde guardar lo producido");
  partes.push(
    "",
    definicion.carpeta
      ? `En Dropbox, dentro de ${definicion.carpeta}, una carpeta por iteración.`
      : "En la carpeta compartida del cliente en Dropbox, una carpeta por iteración.",
    "Antes de registrar, comprobá con el conector de Dropbox que los archivos están en esa carpeta. Sin eso, no se registra.",
  );

  partes.push("", "## 4. Al terminar, registrá la iteración");
  const registro = definicion.registro ?? [];
  partes.push(
    "",
    "Llamá registrar_iteracion con la carpeta, la lista de archivos comprobados, la receta (pasos, prompts que funcionaron, herramientas, modelo, decisiones, descartes), la skill con su commit y el enlace a esta conversación.",
  );
  if (registro.length) {
    partes.push("", "Este proceso pide además estos datos, en «datos»:", "", lista(registro.map((c) => `${c.clave}: ${c.descripcion}${c.requerido === false ? " (opcional)" : ""}`)));
  }
  partes.push("", "Si estabas repitiendo algo que ya estaba registrado, decí en «reproduccion» si salió igual y, si no, qué faltó.");

  if (entrada.recientes.length) {
    partes.push("", "## Las últimas veces que se hizo");
    for (const reciente of entrada.recientes) {
      const receta = esObjeto(reciente.receta) ? reciente.receta : {};
      partes.push("", `### ${reciente.titulo}`);
      const detalle = [typeof receta.modelo === "string" ? `Con ${receta.modelo}` : null, reciente.skill ? `skill ${reciente.skill}` : null].filter(Boolean);
      if (detalle.length) partes.push(`${detalle.join(", ")}.`);
      if (listaDeTextos(receta.pasos)) partes.push(lista(receta.pasos, true));
      if (listaDeTextos(receta.prompts) && receta.prompts.length) {
        partes.push("Prompts:", ...receta.prompts.map((prompt) => `> ${prompt.replace(/\n/g, "\n> ")}`));
      }
      if (listaDeTextos(receta.descartes) && receta.descartes.length) partes.push("No funcionó:", lista(receta.descartes));
      if (typeof reciente.carpeta === "string") partes.push(`Carpeta: ${reciente.carpeta}`);
      if (reciente.imagenes?.length) {
        partes.push(
          `Imágenes (${reciente.imagenes.length}): miralas con read_attachment antes de empezar.`,
          ...reciente.imagenes.map((imagen, indice) => `${indice + 1}. ${imagen.nombre} — ${imagen.id}`),
        );
      }
    }
  }
  return partes.join("\n");
}
