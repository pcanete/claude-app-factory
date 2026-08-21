import "server-only";
import type { PoolClient } from "pg";
import type { PersonalAiProviderKey } from "@/features/settings/catalog";
import { decryptSecret, type EncryptedSecret } from "@/features/settings/crypto";
import { sql, transactionSql } from "@/lib/db";

type SecretRow = {
  key: string;
  ciphertext: string;
  initialization_vector: string;
  authentication_tag: string;
  key_version: number;
  updated_at: Date;
};

type SettingRow = { key: string; value: unknown };

export async function getUserAiSettings(userId: string) {
  const [secrets, settings] = await Promise.all([
    sql<SecretRow>(
      `SELECT key, ciphertext, initialization_vector, authentication_tag, key_version, updated_at
         FROM app_user_secret
        WHERE user_id = $1 AND namespace = 'ai'`,
      [userId],
    ),
    sql<SettingRow>(
      `SELECT key, value
         FROM app_user_setting
        WHERE user_id = $1 AND namespace = 'ai'`,
      [userId],
    ),
  ]);
  const preference = settings.find((setting) => setting.key === "preferred_model")?.value;
  return {
    connectedProviders: new Set(secrets.map((secret) => secret.key as PersonalAiProviderKey)),
    preferredModelId: typeof preference === "string" ? preference : null,
    updatedAt: Object.fromEntries(secrets.map((secret) => [secret.key, secret.updated_at])) as Partial<Record<PersonalAiProviderKey, Date>>,
  };
}

export async function getUserAiSecret(userId: string, providerKey: PersonalAiProviderKey) {
  const rows = await sql<SecretRow>(
    `SELECT key, ciphertext, initialization_vector, authentication_tag, key_version, updated_at
       FROM app_user_secret
      WHERE user_id = $1 AND namespace = 'ai' AND key = $2
      LIMIT 1`,
    [userId, providerKey],
  );
  const row = rows[0];
  if (!row) return null;
  return decryptSecret({
    ciphertext: row.ciphertext,
    initializationVector: row.initialization_vector,
    authenticationTag: row.authentication_tag,
    keyVersion: row.key_version,
  });
}

export async function upsertUserAiSecret(
  client: PoolClient,
  userId: string,
  providerKey: PersonalAiProviderKey,
  secret: EncryptedSecret,
) {
  await transactionSql(
    client,
    `INSERT INTO app_user_secret
       (user_id, namespace, key, ciphertext, initialization_vector, authentication_tag, key_version)
     VALUES ($1, 'ai', $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, namespace, key) DO UPDATE
       SET ciphertext = EXCLUDED.ciphertext,
           initialization_vector = EXCLUDED.initialization_vector,
           authentication_tag = EXCLUDED.authentication_tag,
           key_version = EXCLUDED.key_version,
           updated_at = now()`,
    [userId, providerKey, secret.ciphertext, secret.initializationVector, secret.authenticationTag, secret.keyVersion],
  );
}

export async function deleteUserAiSecret(client: PoolClient, userId: string, providerKey: PersonalAiProviderKey) {
  await transactionSql(
    client,
    `DELETE FROM app_user_secret WHERE user_id = $1 AND namespace = 'ai' AND key = $2`,
    [userId, providerKey],
  );
}

export async function setUserAiPreferredModel(client: PoolClient, userId: string, modelId: string) {
  await transactionSql(
    client,
    `INSERT INTO app_user_setting (user_id, namespace, key, value)
     VALUES ($1, 'ai', 'preferred_model', to_jsonb($2::text))
     ON CONFLICT (user_id, namespace, key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now()`,
    [userId, modelId],
  );
}

export async function getApplicationSettings() {
  const rows = await sql<SettingRow>(
    `SELECT key, value FROM app_setting WHERE namespace = 'general'`,
  );
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    locale: typeof values.locale === "string" ? values.locale : "es-AR",
    timezone: typeof values.timezone === "string" ? values.timezone : "America/Buenos_Aires",
  };
}

export async function setApplicationGeneralSettings(
  client: PoolClient,
  actorId: string,
  input: { locale: string; timezone: string },
) {
  for (const [key, value] of Object.entries(input)) {
    await transactionSql(
      client,
      `INSERT INTO app_setting (namespace, key, value, updated_by)
       VALUES ('general', $1, to_jsonb($2::text), $3)
       ON CONFLICT (namespace, key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, value, actorId],
    );
  }
}

