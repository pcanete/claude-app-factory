import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const displayName = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || email;

if (!connectionString) throw new Error("Falta DATABASE_URL_DIRECT o DATABASE_URL.");
if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Falta BOOTSTRAP_ADMIN_EMAIL válido.");

const client = new Client({ connectionString });
await client.connect();
try {
  const role = await client.query("SELECT 1 FROM app_role WHERE key = 'admin'");
  if (!role.rowCount) throw new Error("Aplicá las migraciones antes de crear el administrador.");
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
       VALUES ($1, $2, $3, 'admin', TRUE)
       RETURNING id, email, auth_subject, active`,
      [`pending:${randomUUID()}`, email, displayName],
    );
    console.log(JSON.stringify({ status: "created", user: created.rows[0] }, null, 2));
  }
} finally {
  await client.end();
}
