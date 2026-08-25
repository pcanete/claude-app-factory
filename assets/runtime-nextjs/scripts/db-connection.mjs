import { readFileSync } from "node:fs";

// Espejo de src/lib/connection.ts para los scripts, que corren fuera del bundle de
// Next y no pueden importar TypeScript. Cambiar uno implica cambiar el otro.

function pooled() {
  return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || "";
}

function direct() {
  return (
    process.env.DATABASE_URL_DIRECT?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    pooled()
  );
}

// El certificado de la autoridad no es un secreto: es público y verificable. Puede
// venir en DATABASE_CA_CERT o, más cómodo para trabajar en local, como ruta en
// DATABASE_CA_CERT_FILE. Un PEM que pasa por un archivo .env pierde sus saltos de
// línea, así que se restauran antes de usarlo.
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

function databaseSsl() {
  const ca = certificateAuthority();
  if (ca) return { ca, rejectUnauthorized: true };
  const mode = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (mode === "off") return false;
  if (mode === "relaxed") return { rejectUnauthorized: false };
  return undefined;
}

// sslmode en la cadena gana sobre la opción ssl del cliente y descartaría el
// certificado declarado en DATABASE_CA_CERT.
function withoutSslMode(connectionString) {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("uselibpqcompat");
    return url.toString();
  } catch {
    return connectionString;
  }
}

/** Configuración lista para `new Client(...)`. */
export function databaseConfig({ direct: useDirect = false } = {}) {
  const raw = useDirect ? direct() : pooled();
  if (!raw) {
    throw new Error(
      "Falta la cadena de conexión: definí DATABASE_URL (o conectá una integración de PostgreSQL que exponga POSTGRES_URL).",
    );
  }
  const ssl = databaseSsl();
  if (ssl === undefined) return { connectionString: raw };
  return { connectionString: withoutSslMode(raw), ssl };
}
