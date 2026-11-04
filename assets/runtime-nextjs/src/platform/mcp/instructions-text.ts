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
};

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
