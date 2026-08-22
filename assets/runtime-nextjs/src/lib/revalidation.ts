import { revalidatePath } from "next/cache";

// Toda escritura invalida las mismas rutas, venga de la interfaz o de un agente
// por MCP. Las vistas se invalidan como grupo: un calendario o un tablero puede
// mostrar registros de cualquier entidad, así que no alcanza con invalidar la
// ruta de la entidad que se tocó.
export function revalidateAfterWrite(entityKey: string, recordId?: string) {
  revalidatePath("/");
  revalidatePath("/views/[view]", "page");
  revalidatePath(`/records/${entityKey}`);
  if (recordId) revalidatePath(`/records/${entityKey}/${recordId}`);
  revalidatePath("/audit");
}
