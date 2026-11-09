"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { USER_SCOPES } from "@/platform/mcp/store";
import { revisarEtapa } from "@/platform/processes/engine";

/**
 * Decidir desde el panel: elegir una opción, aprobar o devolver con el motivo.
 *
 * Es la misma operación que `revisar_etapa` por MCP, con la persona como identidad: el
 * motor comprueba que le toque revisar, que no sea su propio trabajo y que la opción
 * exista. El panel no decide nada por su cuenta.
 */
export async function decidirAction(formData: FormData) {
  const user = await requireUser();
  const caso = String(formData.get("caso") ?? "");
  const accion = String(formData.get("accion") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();
  const persona = {
    id: user.id,
    name: user.displayName,
    roleKey: user.roleKey,
    scopes: [...USER_SCOPES],
    kind: "user" as const,
  };

  let error: string | null = null;
  let hecho = "";
  try {
    if (accion === "devolver") {
      await revisarEtapa(persona, caso, { aprobada: false, motivo });
      hecho = "Lo devolviste con el motivo. Vuelve a quien lo trabajó.";
    } else if (accion.startsWith("elegir:")) {
      const opcion = Number(accion.slice("elegir:".length));
      await revisarEtapa(persona, caso, { aprobada: true, eleccion: opcion, ...(motivo ? { motivo } : {}) });
      hecho = `Elegiste la opción ${opcion}. El caso sigue con la etapa siguiente.`;
    } else if (accion === "aprobar") {
      await revisarEtapa(persona, caso, { aprobada: true, ...(motivo ? { motivo } : {}) });
      hecho = "Aprobado. El caso sigue con la etapa siguiente.";
    } else {
      error = "No se entendió la decisión. Volvé a intentarlo.";
    }
  } catch (causa) {
    error = causa instanceof Error ? causa.message : "No se pudo registrar la decisión.";
  }

  revalidatePath("/pendientes");
  revalidatePath("/");
  const parametro = error ? `error=${encodeURIComponent(error)}` : `hecho=${encodeURIComponent(hecho)}`;
  redirect(`/pendientes?${parametro}`);
}
