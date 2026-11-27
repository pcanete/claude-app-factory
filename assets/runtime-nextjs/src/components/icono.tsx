import ICONOS from "@/lib/icons.json";

/** Los nombres de ícono que una entidad o una vista puede declarar en el AppSpec (`icon`). */
export type NombreDeIcono = keyof typeof ICONOS;

/**
 * Un ícono del menú: SVG de trazo de 16 px que toma el color del texto, sin librerías ni
 * fuentes externas. El dibujo sale de `lib/icons.json`, el mismo archivo con el que el
 * compilador valida los nombres del AppSpec: un nombre que no existe no llega hasta acá.
 * Si llegara, se dibuja el neutro antes que romper el menú.
 *
 * El contenido es fijo y viene de la fábrica, nunca de lo que escribe una persona: por eso
 * se puede insertar como marcado.
 */
export function Icono({ nombre }: { nombre?: string }) {
  const dibujo = (nombre && (ICONOS as Record<string, string>)[nombre]) || ICONOS.circle;
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      dangerouslySetInnerHTML={{ __html: dibujo }}
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="16"
    />
  );
}
