import { createHash, randomBytes } from "node:crypto";

/**
 * Una credencial de agente: el texto que se entrega una sola vez, su hash (lo único que se
 * guarda) y cuándo vence. La usan crear una conexión y regenerar su clave, para que las dos
 * emitan exactamente lo mismo.
 *
 * Sin dependencias de la aplicación: `scripts/test-agent-rotation-db.mjs` la importa.
 */
export function hashDeCredencial(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function emitirCredencial(dias: number, ahora = new Date()) {
  if (!Number.isInteger(dias) || dias < 1 || dias > 3650) throw new Error("Elegí un vencimiento válido.");
  const token = `factory_mcp_${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashDeCredencial(token),
    expiresAt: new Date(ahora.getTime() + dias * 24 * 60 * 60 * 1_000).toISOString(),
  };
}
