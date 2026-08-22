"use server";

import { revalidatePath } from "next/cache";
import { recordAuditEvent } from "@/lib/audit";
import { requireUserManagementAccess } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { deleteSetting, setSetting } from "@/platform/settings/store";

export type SettingsState = { error?: string; ok?: string };

function leerValor(crudo: string) {
  const texto = crudo.trim();
  if (!texto) throw new Error("El valor no puede quedar vacío. Usá null si querés registrar la ausencia.");
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    // Un texto suelto es un valor JSON válido una vez entrecomillado: se acepta para
    // que guardar una cadena no obligue a escribir comillas a mano.
    return texto;
  }
}

export async function saveSettingAction(_estado: SettingsState, formData: FormData): Promise<SettingsState> {
  const actor = await requireUserManagementAccess();
  const namespace = String(formData.get("namespace") ?? "").trim();
  const key = String(formData.get("key") ?? "").trim();

  try {
    const value = leerValor(String(formData.get("value") ?? ""));
    await withTransaction(async (client) => {
      const guardada = await setSetting(client, { namespace, key, value, actorId: actor.id });
      await recordAuditEvent(client, {
        actorId: actor.id,
        entityKey: "app_setting",
        recordId: null,
        action: "setting_save",
        changes: { namespace: guardada.namespace, key: guardada.key },
      });
    });
    revalidatePath("/settings");
    return { ok: `Se guardó ${namespace}.${key}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se pudo guardar la opción." };
  }
}

export async function deleteSettingAction(_estado: SettingsState, formData: FormData): Promise<SettingsState> {
  const actor = await requireUserManagementAccess();
  const namespace = String(formData.get("namespace") ?? "").trim();
  const key = String(formData.get("key") ?? "").trim();

  try {
    await withTransaction(async (client) => {
      const eliminada = await deleteSetting(client, namespace, key);
      if (!eliminada) throw new Error(`La opción ${namespace}.${key} no existe.`);
      await recordAuditEvent(client, {
        actorId: actor.id,
        entityKey: "app_setting",
        recordId: null,
        action: "setting_delete",
        changes: { namespace, key, previous: eliminada.value },
      });
    });
    revalidatePath("/settings");
    return { ok: `Se eliminó ${namespace}.${key}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se pudo eliminar la opción." };
  }
}
