import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { databaseConfig } from "./db-connection.mjs";

const { Client } = pg;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const displayName = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || email;

if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Falta BOOTSTRAP_ADMIN_EMAIL válido.");

const spec = JSON.parse(await readFile(resolve("app-spec.json"), "utf8"));

/**
 * El rol del primer administrador sale de la AppSpec, no de un nombre fijo: una
 * aplicación neutral no tiene por qué llamar `admin` a nadie. Se elige el rol que
 * declara la capacidad `manage_users`; si la AppSpec no declara capacidades, el
 * que tiene todos los permisos sobre todas las entidades, que es la misma
 * heurística que aplica el runtime.
 */
function administratorRole() {
  const configured = process.env.BOOTSTRAP_ADMIN_ROLE?.trim();
  if (configured) {
    if (!spec.roles.some((role) => role.key === configured)) {
      throw new Error(`BOOTSTRAP_ADMIN_ROLE=${configured} no es un rol de la AppSpec.`);
    }
    return configured;
  }

  const declared = spec.roles.find((role) => role.capabilities?.includes("manage_users"));
  if (declared) return declared.key;

  const actions = ["list", "read", "create", "update", "delete"];
  const inferred = spec.roles.find((role) =>
    spec.entities.every((entity) =>
      actions.every((action) => (entity.permissions?.[role.key] ?? []).includes(action)),
    ),
  );
  if (inferred) return inferred.key;

  throw new Error(
    `Ningún rol puede administrar usuarios. Declará la capacidad manage_users en la AppSpec, ` +
      `o elegí uno con BOOTSTRAP_ADMIN_ROLE (disponibles: ${spec.roles.map((r) => r.key).join(", ")}).`,
  );
}

const roleKey = administratorRole();

const client = new Client(databaseConfig({ direct: true }));
await client.connect();
try {
  const role = await client.query("SELECT 1 FROM app_role WHERE key = $1", [roleKey]);
  if (!role.rowCount) {
    throw new Error(`El rol ${roleKey} no existe en la base: aplicá las migraciones antes de crear el administrador.`);
  }
  const existing = await client.query(
    `SELECT id, email, auth_subject, active
       FROM app_user
      WHERE lower(email) = $1
      LIMIT 1`,
    [email],
  );
  if (existing.rowCount) {
    console.log(JSON.stringify({ status: "exists", user: existing.rows[0] }, null, 2));
  } else {
    const created = await client.query(
      `INSERT INTO app_user (auth_subject, email, display_name, role_key, active)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, email, auth_subject, role_key, active`,
      [`pending:${randomUUID()}`, email, displayName, roleKey],
    );
    console.log(JSON.stringify({ status: "created", user: created.rows[0] }, null, 2));
  }
} finally {
  await client.end();
}
