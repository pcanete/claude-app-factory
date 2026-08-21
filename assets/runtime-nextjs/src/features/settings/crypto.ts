import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = {
  ciphertext: string;
  initializationVector: string;
  authenticationTag: string;
  keyVersion: number;
};

function encryptionKey() {
  const configured = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error("Falta SETTINGS_ENCRYPTION_KEY.");
  const key = /^[0-9a-f]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("SETTINGS_ENCRYPTION_KEY debe contener exactamente 32 bytes.");
  return key;
}

export function settingsEncryptionConfigured() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(value: string): EncryptedSecret {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), initializationVector);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    initializationVector: initializationVector.toString("base64"),
    authenticationTag: cipher.getAuthTag().toString("base64"),
    keyVersion: 1,
  };
}

export function decryptSecret(secret: EncryptedSecret) {
  if (secret.keyVersion !== 1) throw new Error("Versión de cifrado no compatible.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(secret.initializationVector, "base64"),
  );
  decipher.setAuthTag(Buffer.from(secret.authenticationTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

