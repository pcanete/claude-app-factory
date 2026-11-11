"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { USER_SCOPES } from "@/platform/mcp/store";
import { redirect } from "next/navigation";
import { adjuntarACaso, cancelarCaso } from "@/platform/processes/engine";

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

/** Cancelar un caso desde la página del proceso. El motor exige que quien lo pide administre. */
export async function cancelarCasoAction(formData: FormData) {
  const user = await requireUser();
  const caso = String(formData.get("caso") ?? "");
  const familia = String(formData.get("familia") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();
  let error: string | null = null;
  try {
    await cancelarCaso({ id: user.id, name: user.displayName, roleKey: user.roleKey, scopes: [...USER_SCOPES], kind: "user" }, caso, motivo);
  } catch (causa) {
    error = causa instanceof Error ? causa.message : "No se pudo cancelar el caso.";
  }
  revalidatePath("/procesos", "layout");
  revalidatePath("/pendientes");
  const destino = `/procesos/${encodeURIComponent(familia)}`;
  redirect(error ? `${destino}?error=${encodeURIComponent(error)}` : `${destino}?hecho=${encodeURIComponent("Caso cancelado.")}`);
}
