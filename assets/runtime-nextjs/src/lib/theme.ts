/**
 * El color principal de la aplicación, el que declara el AppSpec en `app.theme.primary`,
 * convertido en las variables que usa la hoja de estilos (2.11.0).
 *
 * Un color de marca no siempre se lee como texto sobre un tema oscuro: un índigo profundo
 * sobre las tarjetas queda en 2,6:1, y un texto chico pide 4,5:1. Por eso salen tres
 * variables y no una:
 *   --primary        el color tal cual, para fondos (botones, pestaña activa, marcas);
 *   --primary-text   el mismo color aclarado lo justo para leerse como texto sobre las
 *                    tarjetas (enlaces, rótulos);
 *   --on-primary     blanco u oscuro, el que se lea mejor sobre un botón de ese color.
 *
 * Sin dependencias a propósito: `scripts/test-theme.mjs` prueba este mismo archivo.
 */

/** Las tarjetas: el fondo más claro sobre el que se lee texto, o sea el caso más difícil. */
export const FONDO_DE_LECTURA = "#232a38";
export const PRIMARIO_POR_DEFECTO = "#0EA5E9";
const BLANCO = "#ffffff";
const OSCURO = "#0b0d12";
const CONTRASTE_DE_TEXTO = 4.5;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** `#abc` o `#aabbcc`, en minúsculas y de seis dígitos; cualquier otra cosa, null. */
export function normalizarColor(valor: unknown): string | null {
  if (typeof valor !== "string" || !HEX.test(valor.trim())) return null;
  const hex = valor.trim().slice(1).toLowerCase();
  return `#${hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex}`;
}

function canales(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function luminancia(hex: string) {
  const [r, g, b] = canales(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores de seis dígitos: de 1 a 21. */
export function contraste(a: string, b: string) {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Mezcla `color` con blanco en la proporción `t` (0 = el color, 1 = blanco). */
function aclarar(hex: string, t: number) {
  return `#${canales(hex).map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** El color más cercano al de marca que se lee como texto sobre las tarjetas. */
export function colorDeTexto(primario: string, fondo = FONDO_DE_LECTURA) {
  for (let paso = 0; paso <= 20; paso += 1) {
    const candidato = aclarar(primario, paso * 0.05);
    if (contraste(candidato, fondo) >= CONTRASTE_DE_TEXTO) return candidato;
  }
  return BLANCO;
}

/** Blanco u oscuro: el que se lea mejor sobre un fondo del color principal. */
export function textoSobre(primario: string) {
  return contraste(BLANCO, primario) >= contraste(OSCURO, primario) ? BLANCO : OSCURO;
}

/** Las variables de color de la aplicación. Un color inválido o ausente usa el de la plataforma. */
export function variablesDeTema(theme?: { primary?: unknown }) {
  const primario = normalizarColor(theme?.primary) ?? PRIMARIO_POR_DEFECTO.toLowerCase();
  return {
    "--primary": primario,
    "--primary-text": colorDeTexto(primario),
    "--on-primary": textoSobre(primario),
  };
}
