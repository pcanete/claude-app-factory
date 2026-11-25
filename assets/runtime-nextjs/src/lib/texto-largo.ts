/**
 * Lee un texto largo escrito en markdown y lo convierte en bloques que la ficha dibuja
 * con elementos de React: nunca se inserta HTML, así que nada del texto puede ejecutarse.
 *
 * Cubre lo que de verdad aparece en las notas: títulos, negritas, listas, citas,
 * separadores, enlaces e imágenes (que se muestran como enlace). Lo que no reconoce
 * queda como texto, con sus saltos de línea: una lista de accesos pegada sin formato
 * se lee igual que en el original.
 *
 * La negrita sólo se reconoce entre bordes de palabra: «Ab**Cd**12» puede ser una
 * clave, no «Ab» + negrita + «12», y tiene que mostrarse tal cual.
 */

export type Linea = Parte[];

export type Parte =
  | { tipo: "texto"; texto: string }
  | { tipo: "negrita"; partes: Parte[] }
  | { tipo: "enlace"; href: string; partes: Parte[] };

export type Bloque =
  | { tipo: "titulo"; nivel: 1 | 2 | 3; partes: Linea }
  | { tipo: "parrafo"; lineas: Linea[] }
  | { tipo: "lista"; ordenada: boolean; items: Linea[] }
  | { tipo: "cita"; lineas: Linea[] }
  | { tipo: "separador" };

const SEPARADOR = /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const TITULO = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const VINETA = /^\s*[*+-]\s+(.*)$/;
const NUMERADA = /^\s*\d{1,3}[.)]\s+(.*)$/;
const CITA = /^\s*>\s?(.*)$/;

/** Sólo se enlaza lo que se puede abrir sin riesgo: web y correo. */
export function enlaceSeguro(url: string): string | null {
  const limpio = url.trim();
  if (/^https?:\/\/[^\s]+$/i.test(limpio)) return limpio;
  if (/^mailto:[^\s]+$/i.test(limpio)) return limpio;
  return null;
}

const ALNUM = /[\p{L}\p{N}]/u;

// 1: escape · 2,3,4: imagen o enlace · 5: negrita · 6: dirección suelta
const TOKEN =
  /\\([\\`*_{}[\]()#+\-.!>|])|(!?)\[([^\]\n]*)\]\(([^()\s]+)\)|\*\*([^*\s](?:[^*\n]*?[^*\s])?)\*\*|(https?:\/\/[^\s<>()[\]]+)/gu;

function agregarTexto(partes: Parte[], texto: string) {
  if (!texto) return;
  const ultima = partes[partes.length - 1];
  if (ultima?.tipo === "texto") ultima.texto += texto;
  else partes.push({ tipo: "texto", texto });
}

export function leerLinea(texto: string, dentroDeEnlace = false): Linea {
  const partes: Parte[] = [];
  // Una expresión propia por llamada: la lectura es recursiva y comparte el patrón.
  const token = new RegExp(TOKEN.source, TOKEN.flags);
  let desde = 0;
  let m: RegExpExecArray | null;
  while ((m = token.exec(texto)) !== null) {
    const inicio = m.index;
    const crudo = m[0];
    agregarTexto(partes, texto.slice(desde, inicio));
    desde = inicio + crudo.length;

    if (m[1] !== undefined) {
      agregarTexto(partes, m[1] as string);
    } else if (m[3] !== undefined) {
      const esImagen = m[2] === "!";
      const href = enlaceSeguro(m[4] as string);
      if (!href || dentroDeEnlace) {
        agregarTexto(partes, crudo);
      } else {
        // Una imagen no se carga desde la ficha: se ofrece como enlace.
        const alt = m[3].trim();
        const etiqueta = esImagen ? (alt ? `Imagen: ${alt}` : "Imagen") : alt || href;
        partes.push({ tipo: "enlace", href, partes: leerLinea(etiqueta, true) });
      }
    } else if (m[5] !== undefined) {
      const antes = texto[inicio - 1] ?? "";
      const despues = texto[desde] ?? "";
      if (ALNUM.test(antes) || ALNUM.test(despues)) {
        // Pegado a letras o números: es parte de una palabra (una clave), no formato.
        agregarTexto(partes, "**");
        desde = inicio + 2;
      } else {
        partes.push({ tipo: "negrita", partes: leerLinea(m[5] as string, dentroDeEnlace) });
      }
    } else if (m[6] !== undefined) {
      // La puntuación final suele ser de la oración, no de la dirección.
      const url = m[6].replace(/[.,;:!?'"]+$/, "");
      desde = inicio + url.length;
      if (dentroDeEnlace) agregarTexto(partes, url);
      else partes.push({ tipo: "enlace", href: url, partes: [{ tipo: "texto", texto: url }] });
    }
    // Si una negrita resultó ser parte de una palabra, se sigue leyendo justo después de
    // los asteriscos de apertura: lo que venía adentro puede tener enlaces o negritas reales.
    token.lastIndex = desde;
  }
  agregarTexto(partes, texto.slice(desde));
  return partes;
}

export function leerTextoLargo(texto: string): Bloque[] {
  const bloques: Bloque[] = [];
  let actual: Bloque | null = null;
  const cerrar = () => {
    if (actual) bloques.push(actual);
    actual = null;
  };

  for (const cruda of texto.replace(/\r\n?/g, "\n").split("\n")) {
    const linea = cruda.replace(/\s+$/, "");
    if (!linea.trim()) {
      cerrar();
      continue;
    }
    if (SEPARADOR.test(linea)) {
      cerrar();
      bloques.push({ tipo: "separador" });
      continue;
    }
    const titulo = TITULO.exec(linea);
    if (titulo) {
      cerrar();
      const nivel = Math.min(titulo[1].length, 3) as 1 | 2 | 3;
      bloques.push({ tipo: "titulo", nivel, partes: leerLinea(titulo[2]) });
      continue;
    }
    const vineta = VINETA.exec(linea);
    const numerada = vineta ? null : NUMERADA.exec(linea);
    if (vineta || numerada) {
      const ordenada = Boolean(numerada);
      const contenido = (vineta ?? numerada)![1];
      const abierta = actual as Bloque | null;
      if (abierta?.tipo !== "lista" || abierta.ordenada !== ordenada) {
        cerrar();
        actual = { tipo: "lista", ordenada, items: [] };
      }
      (actual as Extract<Bloque, { tipo: "lista" }>).items.push(leerLinea(contenido));
      continue;
    }
    const cita = CITA.exec(linea);
    if (cita) {
      const abierta = actual as Bloque | null;
      if (abierta?.tipo !== "cita") {
        cerrar();
        actual = { tipo: "cita", lineas: [] };
      }
      (actual as Extract<Bloque, { tipo: "cita" }>).lineas.push(leerLinea(cita[1]));
      continue;
    }
    const abierta = actual as Bloque | null;
    if (abierta?.tipo !== "parrafo") {
      cerrar();
      actual = { tipo: "parrafo", lineas: [] };
    }
    (actual as Extract<Bloque, { tipo: "parrafo" }>).lineas.push(leerLinea(linea));
  }
  cerrar();
  return bloques;
}
