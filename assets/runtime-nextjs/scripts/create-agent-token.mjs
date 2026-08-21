import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const { Client } = pg;

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

const name = argument("name");
const roleKey = argument("role");
const expiresDaysRaw = argument("expires-days");
const access = argument("access") ?? "read";
if (!name || !roleKey) {
  throw new Error('Uso: pnpm mcp:agent:create -- --name "Riel" --role admin [--access read|write|full] [--expires-days 90]');
}
if (name.length > 120 || !/^[a-z][a-z0-9_]{0,47}$/.test(roleKey)) {
  throw new Error("Nombre o rol inválido.");
}
const expiresDays = expiresDaysRaw === undefined ? null : Number(expiresDaysRaw);
if (expiresDays !== null && (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 3650)) {
  throw new Error("--expires-days debe estar entre 1 y 3650.");
}
if (!new Set(["read", "write", "full"]).has(access)) {
  throw new Error("--access debe ser read, write o full.");
}
const scopes = [
  "schema:read",
  "records:read",
  ...(access === "write" || access === "full" ? ["records:write"] : []),
  ...(access === "full" ? ["records:delete"] : []),
];

const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!connectionString) throw new Error("Falta DATABASE_URL.");

const token = `factory_mcp_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
const client = new Client({ connectionString });
await client.connect();

try {
  const role = await client.query("SELECT key FROM app_role WHERE key = $1", [roleKey]);
  if (!role.rowCount) throw new Error(`El rol ${roleKey} no existe en AppSpec.`);
  const expiresAt = expiresDays === null
    ? null
    : new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1_000).toISOString();
  await client.query(
    `INSERT INTO app_agent (name, token_hash, role_key, scopes, expires_at)
     VALUES ($1, $2, $3, $4::text[], $5)`,
    [name, tokenHash, roleKey, scopes, expiresAt],
  );
  console.log("Agente MCP creado. Guardá este token ahora; no puede recuperarse después:");
  console.log(token);
} finally {
  await client.end();
}
