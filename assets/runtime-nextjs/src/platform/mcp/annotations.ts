/**
 * Qué hace cada herramienta con los datos, dicho para el cliente que la llama.
 *
 * Un cliente que no sabe si una herramienta modifica algo asume lo peor: ChatGPT pide
 * confirmación en cada llamada a una herramienta sin `readOnlyHint`, así que leer la guía
 * de una etapa costaba lo mismo que borrar un registro. Con las marcas, leer es fluido y
 * la confirmación queda para lo que cambia algo.
 *
 * Las marcas son una pista para el cliente, no un control: los permisos siguen viviendo en
 * el servidor. Pero una marca equivocada engaña a quien decide si confirmar, así que:
 *
 *   readOnlyHint     no escribe nada que otra persona vaya a ver.
 *   destructiveHint  pisa o borra lo que ya había. Abrir un caso o registrar un evento
 *                    agrega; actualizar un campo reemplaza el valor anterior.
 *   idempotentHint   repetir la llamada con los mismos datos no tiene efecto adicional.
 *   openWorldHint    toca algo fuera de esta aplicación. Ninguna lo hace.
 *
 * Toda herramienta registrada tiene que estar acá: `marcas()` falla con un nombre que no
 * conoce, y `scripts/test-mcp-annotations.mjs` comprueba que cada registro la use.
 */
import type { ToolAnnotations } from "@modelcontextprotocol/server";

const LEE: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const AGREGA: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const REEMPLAZA: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
const BORRA: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

export const MARCAS = {
  // Esquema y configuración.
  list_entities: LEE,
  describe_entity: LEE,
  list_settings: LEE,
  get_setting: LEE,
  set_setting: REEMPLAZA,
  delete_setting: BORRA,

  // Registros y adjuntos.
  list_attachments: LEE,
  read_attachment: LEE,
  count_records: LEE,
  query_records: LEE,
  get_record: LEE,
  export_snapshot: LEE,
  create_record: AGREGA,
  update_record: REEMPLAZA,
  delete_record: BORRA,

  // Motor de procesos. Mover un caso deja un evento en la bitácora y no borra nada:
  // lo anterior sigue a la vista, por eso ninguna es destructiva.
  mis_pendientes: LEE,
  guia_de_etapa: LEE,
  ver_caso: LEE,
  validar_proceso: LEE,
  tablero_de_trabajo: LEE,
  como_se_hace: LEE,
  iteraciones_de_proceso: LEE,
  registrar_iteracion: AGREGA,
  adjuntar_a_caso: AGREGA,
  crear_caso: AGREGA,
  tomar_caso: AGREGA,
  esperar_caso: AGREGA,
  liberar_caso: AGREGA,
  cerrar_etapa: AGREGA,
  revisar_etapa: AGREGA,
} satisfies Record<string, ToolAnnotations>;

export type NombreDeHerramienta = keyof typeof MARCAS;

export function marcas(nombre: NombreDeHerramienta): ToolAnnotations {
  const encontradas = MARCAS[nombre];
  if (!encontradas) throw new Error(`La herramienta ${nombre} no declara qué hace con los datos.`);
  return encontradas;
}
