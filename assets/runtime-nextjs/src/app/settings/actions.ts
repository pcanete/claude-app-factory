"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAllowedAiModel } from "@/features/ai/config";
import { isPersonalAiProviderKey } from "@/features/settings/catalog";
import { encryptSecret, settingsEncryptionConfigured } from "@/features/settings/crypto";
import {
  deleteUserAiSecret,
  setApplicationGeneralSettings,
  setUserAiPreferredModel,
  upsertUserAiSecret,
} from "@/features/settings/store";
import { recordAuditEvent } from "@/lib/audit";
import { requireUser, requireUserManagementAccess } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

function refreshSettings() {
  revalidatePath("/settings");
  revalidatePath("/assistant");
  revalidatePath("/audit");
}

export async function saveAiCredentialAction(formData: FormData) {
  const user = await requireUser();
  const providerKey = String(formData.get("provider") ?? "");
  const apiKey = String(formData.get("api_key") ?? "").trim();
  if (!isPersonalAiProviderKey(providerKey) || apiKey.length < 20 || apiKey.length > 512 || /\s/.test(apiKey)) {
    redirect("/settings?error=invalid_credential");
  }
  if (!settingsEncryptionConfigured()) redirect("/settings?error=encryption_unavailable");
  const encrypted = encryptSecret(apiKey);
  await withTransaction(async (client) => {
    await upsertUserAiSecret(client, user.id, providerKey, encrypted);
    await recordAuditEvent(client, {
      actorId: user.id,
      entityKey: "app_user_secret",
      recordId: user.id,
      action: "ai_credential_save",
      changes: { provider: providerKey },
    });
  });
  refreshSettings();
  redirect(`/settings?saved=credential&provider=${providerKey}`);
}

export async function removeAiCredentialAction(formData: FormData) {
  const user = await requireUser();
  const providerKey = String(formData.get("provider") ?? "");
  if (!isPersonalAiProviderKey(providerKey)) redirect("/settings?error=invalid_provider");
  await withTransaction(async (client) => {
    await deleteUserAiSecret(client, user.id, providerKey);
    await recordAuditEvent(client, {
      actorId: user.id,
      entityKey: "app_user_secret",
      recordId: user.id,
      action: "ai_credential_remove",
      changes: { provider: providerKey },
    });
  });
  refreshSettings();
  redirect(`/settings?saved=removed&provider=${providerKey}`);
}

export async function saveAiPreferenceAction(formData: FormData) {
  const user = await requireUser();
  const modelId = String(formData.get("model_id") ?? "");
  const model = await requireAllowedAiModel(user.id, modelId);
  await withTransaction(async (client) => {
    await setUserAiPreferredModel(client, user.id, model.id);
    await recordAuditEvent(client, {
      actorId: user.id,
      entityKey: "app_user_setting",
      recordId: user.id,
      action: "ai_preference_update",
      changes: { modelId: model.id },
    });
  });
  refreshSettings();
  redirect("/settings?saved=preference");
}

export async function saveApplicationSettingsAction(formData: FormData) {
  const user = await requireUserManagementAccess();
  const locale = String(formData.get("locale") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale) || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(timezone)) {
    redirect("/settings?error=invalid_application_settings");
  }
  await withTransaction(async (client) => {
    await setApplicationGeneralSettings(client, user.id, { locale, timezone });
    await recordAuditEvent(client, {
      actorId: user.id,
      entityKey: "app_setting",
      recordId: "general",
      action: "application_settings_update",
      changes: { locale, timezone },
    });
  });
  refreshSettings();
  redirect("/settings?saved=application");
}
