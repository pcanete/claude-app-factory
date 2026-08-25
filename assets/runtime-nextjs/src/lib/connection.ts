import { readFileSync } from "node:fs";

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
 * Algunos PostgreSQL gestionados presentan certificados firmados por su propia
 * autoridad, que Node no trae. Desde pg 8.16 `sslmode=require` en la cadena de conexión
 * se trata como `verify-full`, así que esas conexiones fallan con
 * SELF_SIGNED_CERT_IN_CHAIN salvo que se declare en quién confiar.
 *
 * Ojo al verificar cuál hace falta: el certificado que un proveedor presenta en HTTPS no
 * es el que presenta su PostgreSQL. El pooler de Supabase, por ejemplo, responde en 443
 * con un certificado de Amazon que el almacén del sistema ya valida, y en 5432 con uno
 * de su propia autoridad, que no. Mirar el puerto equivocado lleva a concluir que no
 * hace falta declarar nada.
 *
 * Orden: el certificado de la autoridad si está declarado (lo correcto), luego el
 * modo explícito, y si no hay nada se deja decidir a la cadena de conexión.
 */
/**
 * El certificado de la autoridad no es un secreto: es público y verificable. Puede
 * venir en `DATABASE_CA_CERT` o, más cómodo para trabajar en local, como ruta en
 * `DATABASE_CA_CERT_FILE`. Un PEM que pasa por un archivo `.env` pierde sus saltos
 * de línea, así que se restauran antes de usarlo.
 */
function certificateAuthority() {
  const file = process.env.DATABASE_CA_CERT_FILE?.trim();
  if (file) return readFileSync(file, "utf8");

  const inline = process.env.DATABASE_CA_CERT?.trim();
  if (!inline) return "";
  const restaurado = inline.replaceAll("\\n", "\n");
  // Un valor que no es un PEM no es un certificado. Vercel exporta un marcador corto en
  // lugar del valor cuando la variable está marcada como sensible, así que
  // `vercel env pull` trae el nombre y no el contenido. Aceptarlo hacía que Node fallara
  // con SELF_SIGNED_CERT_IN_CHAIN, un error que no dice nada de lo que realmente pasa.
  if (!restaurado.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error(
      "DATABASE_CA_CERT no contiene un certificado PEM. `vercel env pull` redacta las "
      + "variables sensibles, así que trae el nombre y no el contenido. Apuntá "
      + "DATABASE_CA_CERT_FILE al .crt de tu proveedor; borrar la variable sólo alcanza si "
      + "su PostgreSQL firma con una autoridad pública, que no es el caso más común.",
    );
  }
  return restaurado;
}

export function databaseSsl() {
  const ca = certificateAuthority();
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
