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

function databaseSsl() {
  const ca = process.env.DATABASE_CA_CERT?.trim();
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
