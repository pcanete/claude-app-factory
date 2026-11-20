/**
 * Regenerar la clave de una conexión, contra PostgreSQL real.
 *
 * Las credenciales de agente vencen (90 días por defecto) y hasta 2.5.7 no había forma de
 * renovarlas: había que crear otra conexión, con otro nombre y sin el historial. Esta
 * prueba ejerce las funciones reales —`emitirCredencial`, `rotateManagedAgentToken` y
 * `authenticateAgentToken`, importadas, no reescritas— y comprueba que:
 *
 *   - una credencial vencida no entra;
 *   - después de regenerar, la clave nueva entra y es el mismo agente (mismo id, nombre y
 *     responsable);
 *   - la clave anterior deja de servir en el acto;
 *   - regenerar no reactiva una conexión revocada;
 *   - regenerar una conexión que no existe no hace nada;
 *   - usar una credencial corre su vencimiento, y una vencida no revive por usarla (2.5.9).
 *
 * Requiere una base descartable con las migraciones aplicadas; borra lo que crea.
 */
import { randomUUID } from "node:crypto";
import { getPool, sql, withTransaction } from "@/lib/db";
import { runtimeSpec } from "@/lib/spec";
import { createManagedAgent, rotateManagedAgentToken, setManagedAgentActive } from "@/platform/mcp/admin";
import { emitirCredencial } from "@/platform/mcp/credencial";
import { authenticateAgentToken } from "@/platform/mcp/store";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? ` -- ${detalle}` : ""}`);
  }
}

const persona = randomUUID();
const rol = runtimeSpec.roles[0].key;
let agente = null;
let enUsoId = null;
let olvidadaId = null;

try {
  await sql(
    `INSERT INTO app_user ("id", "email", "display_name", "role_key", "active", "auth_subject") VALUES ($1, $2, $3, $4, TRUE, $5)`,
    [persona, `rotacion-${persona}@prueba.local`, "Persona de prueba", rol, `prueba:${persona}`],
  );
  // Una conexión que ya venció: se emite con un vencimiento en el pasado.
  const vieja = emitirCredencial(90, new Date(Date.now() - 100 * 24 * 60 * 60 * 1_000));
  agente = await withTransaction((client) => createManagedAgent(client, {
    name: `Rotacion ${persona.slice(0, 8)}`,
    roleKey: rol,
    scopes: ["schema:read", "records:read"],
    tokenHash: vieja.tokenHash,
    expiresAt: vieja.expiresAt,
    ownerUserId: persona,
    createdByUserId: persona,
  }));
  comprobar("una credencial vencida no entra", (await authenticateAgentToken(vieja.token)) === null);

  const nueva = emitirCredencial(90);
  const renovado = await withTransaction((client) => rotateManagedAgentToken(client, agente, nueva.tokenHash, nueva.expiresAt));
  comprobar("regenerar devuelve el mismo agente y el vencimiento anterior",
    renovado?.id === agente && new Date(renovado.expires_at).toISOString() === vieja.expiresAt, JSON.stringify(renovado));
  const principal = await authenticateAgentToken(nueva.token);
  comprobar("la clave nueva entra y es el mismo agente, con su responsable",
    principal?.id === agente && principal.ownerUserId === persona, JSON.stringify(principal));
  comprobar("la clave anterior ya no sirve", (await authenticateAgentToken(vieja.token)) === null);

  const otraVez = emitirCredencial(30);
  await withTransaction((client) => rotateManagedAgentToken(client, agente, otraVez.tokenHash, otraVez.expiresAt));
  comprobar("regenerar de nuevo anula la clave que se acababa de dar", (await authenticateAgentToken(nueva.token)) === null);
  comprobar("y la última entra", (await authenticateAgentToken(otraVez.token))?.id === agente);

  await withTransaction((client) => setManagedAgentActive(client, agente, false));
  const revocada = emitirCredencial(90);
  await withTransaction((client) => rotateManagedAgentToken(client, agente, revocada.tokenHash, revocada.expiresAt));
  comprobar("regenerar no reactiva una conexión revocada", (await authenticateAgentToken(revocada.token)) === null);

  const inexistente = await withTransaction((client) => rotateManagedAgentToken(client, randomUUID(), emitirCredencial(90).tokenHash, nueva.expiresAt));
  comprobar("regenerar una conexión que no existe no hace nada", inexistente === null);

  // 2.5.9: vence a los renew_days días sin uso, no a fecha fija. Usarla corre el plazo.
  const dia = 24 * 60 * 60 * 1_000;
  const enUso = emitirCredencial(90, new Date(Date.now() - 89 * dia)); // le queda un día
  enUsoId = await withTransaction((client) => createManagedAgent(client, {
    name: `En uso ${persona.slice(0, 8)}`,
    roleKey: rol,
    scopes: ["schema:read"],
    tokenHash: enUso.tokenHash,
    expiresAt: enUso.expiresAt,
    renewDays: 90,
    ownerUserId: persona,
    createdByUserId: persona,
  }));
  comprobar("una credencial en uso entra", (await authenticateAgentToken(enUso.token))?.id === enUsoId);
  const [corrida] = await sql("SELECT expires_at FROM app_agent WHERE id = $1", [enUsoId]);
  const faltan = (new Date(corrida.expires_at).getTime() - Date.now()) / dia;
  comprobar("y usarla corre su vencimiento a 90 días desde ahora", faltan > 89.9 && faltan <= 90.01, String(faltan));

  const olvidada = emitirCredencial(90, new Date(Date.now() - 91 * dia)); // venció ayer
  olvidadaId = await withTransaction((client) => createManagedAgent(client, {
    name: `Olvidada ${persona.slice(0, 8)}`,
    roleKey: rol,
    scopes: ["schema:read"],
    tokenHash: olvidada.tokenHash,
    expiresAt: olvidada.expiresAt,
    renewDays: 90,
    ownerUserId: persona,
    createdByUserId: persona,
  }));
  comprobar("una credencial que pasó 90 días sin uso no entra", (await authenticateAgentToken(olvidada.token)) === null);
  const [sigue] = await sql("SELECT expires_at FROM app_agent WHERE id = $1", [olvidadaId]);
  comprobar("y intentar usarla no la revive", new Date(sigue.expires_at).toISOString() === olvidada.expiresAt, String(sigue.expires_at));
} finally {
  for (const id of [agente, enUsoId, olvidadaId].filter(Boolean)) {
    await sql("DELETE FROM app_agent_event WHERE agent_id = $1", [id]).catch(() => undefined);
    await sql("DELETE FROM app_agent WHERE id = $1", [id]);
  }
  await sql("DELETE FROM app_user WHERE id = $1", [persona]).catch(() => undefined);
  await getPool().end();
}

if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nRegenerar la clave: todas las comprobaciones pasaron.");
