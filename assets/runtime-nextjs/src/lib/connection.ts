/**
 * Resolución de la conexión a PostgreSQL.
 *
 * `DATABASE_URL` y `DATABASE_URL_DIRECT` son el contrato documentado. Las
 * integraciones de PostgreSQL del marketplace de Vercel (Supabase, Neon) inyectan
 * en cambio `POSTGRES_URL` y `POSTGRES_URL_NON_POOLING` al conectar el recurso al
 * proyecto. Aceptar ambas convenciones evita copiar una credencial a mano solo
 * para renombrarla.
 *
 * Los scripts de `scripts/` repiten esta lógica en `scripts/db-connection.mjs`
 * porque corren fuera del bundle de Next. Cambiar una implica cambiar la otra.
 */

export const MISSING_CONNECTION_MESSAGE =
  "Falta la cadena de conexión: definí DATABASE_URL (o conectá una integración de PostgreSQL que exponga POSTGRES_URL).";

export function pooledConnectionString() {
  return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || "";
}

/** Conexión sin pooler, preferida para migraciones y trabajos de arranque. */
export function directConnectionString() {
  return (
    process.env.DATABASE_URL_DIRECT?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    pooledConnectionString()
  );
}

/**
 * Configuración TLS.
 *
 * Los PostgreSQL gestionados (Supabase, Neon, RDS) presentan certificados firmados
 * por su propia autoridad, que Node no trae. Desde pg 8.16 `sslmode=require` en la
 * cadena de conexión se trata como `verify-full`, así que esas conexiones fallan con
 * SELF_SIGNED_CERT_IN_CHAIN salvo que se declare en quién confiar.
 *
 * Orden: el certificado de la autoridad si está declarado (lo correcto), luego el
 * modo explícito, y si no hay nada se deja decidir a la cadena de conexión.
 */
export function databaseSsl() {
  const ca = process.env.DATABASE_CA_CERT?.trim();
  if (ca) return { ca, rejectUnauthorized: true };

  switch (process.env.DATABASE_SSL?.trim().toLowerCase()) {
    case "off":
      return false;
    // Cifra el tráfico pero no autentica al servidor: aceptable dentro de la red
    // del proveedor, no frente a una red hostil.
    case "relaxed":
      return { rejectUnauthorized: false };
    default:
      return undefined;
  }
}

/**
 * `sslmode` en la cadena de conexión gana sobre la opción `ssl` del cliente, así que
 * un `sslmode=require` inyectado por el proveedor descarta el certificado declarado
 * en `DATABASE_CA_CERT` y la conexión vuelve a fallar. Cuando la configuración TLS
 * es explícita, esa parte de la cadena sobra.
 */
function withoutSslMode(connectionString: string) {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("uselibpqcompat");
    return url.toString();
  } catch {
    return connectionString;
  }
}

/** Configuración lista para `new Pool(...)` o `new Client(...)`. */
export function databaseConfig(options: { direct?: boolean } = {}) {
  const raw = options.direct ? directConnectionString() : pooledConnectionString();
  if (!raw) throw new Error(MISSING_CONNECTION_MESSAGE);
  const ssl = databaseSsl();
  if (ssl === undefined) return { connectionString: raw };
  return { connectionString: withoutSslMode(raw), ssl };
}
