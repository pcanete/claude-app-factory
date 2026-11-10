"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { USER_SCOPES } from "@/platform/mcp/store";
import { adjuntarACaso } from "@/platform/processes/engine";

/**
 * Sube un archivo a una iteración desde el panel. Uno por llamada, a propósito: Vercel corta
 * los pedidos de más de 4,5 MB, y nueve láminas juntas lo superan. El componente que llama
 * los manda de a uno y muestra el avance.
 */
export async function subirArchivoAIteracionAction(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const caso = String(formData.get("caso") ?? "");
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: "No llegó ningún archivo." };
  try {
    await adjuntarACaso(
      { id: user.id, name: user.displayName, roleKey: user.roleKey, scopes: [...USER_SCOPES], kind: "user" },
      caso,
      [{ nombre: archivo.name, tipo: archivo.type || "application/octet-stream", contenido: Buffer.from(await archivo.arrayBuffer()) }],
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo subir el archivo." };
  }
  revalidatePath("/procesos", "layout");
  return { ok: true };
}
