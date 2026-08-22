/**
 * Vence la auditoría vieja.
 *
 * El registro de auditoría crece con cada escritura y nunca se achica solo. La salida
 * no es dejar que un administrador borre lo que le moleste --un registro que se puede
 * recortar deja de servir como evidencia justo cuando más importa-- sino una regla
 * pareja: todo lo anterior a la ventana de retención se va, sin elegir qué.
 *
 * La ventana se lee de la configuración del sistema (`auditoria.retencion_dias`), así
 * que cambiarla es a su vez un cambio auditado. El piso de 30 días es deliberado: por
 * debajo de eso la auditoría no alcanza para investigar nada.
 *
 * Pensado para correr en el respaldo diario, después del volcado: primero se guarda,
 * después se borra.
 */
import pg from "pg";
import { databaseConfig } from "./db-connection.mjs";

const { Client } = pg;
const POR_DEFECTO = 365;

const client = new Client(databaseConfig({ direct: true }));
await client.connect();

try {
  const configurada = await client.query(
    "SELECT value FROM app_setting WHERE namespace = 'auditoria' AND key = 'retencion_dias'",
  );
  const crudo = configurada.rows[0]?.value;
  const dias = Number.isInteger(crudo) ? crudo : POR_DEFECTO;

  if (!Number.isInteger(dias) || dias < 30) {
    throw new Error(
      `La retención configurada (${JSON.stringify(crudo)}) no es válida. Debe ser un entero de al menos 30 días.`,
    );
  }

  const anteriores = await client.query("SELECT count(*)::int AS total FROM app_audit_log");
  const borrados = await client.query(
    `WITH borrados AS (
       DELETE FROM app_audit_log
        WHERE created_at < now() - ($1 || ' days')::interval
        RETURNING 1
     )
     SELECT count(*)::int AS eliminados FROM borrados`,
    [String(dias)],
  );

  const eliminados = borrados.rows[0].eliminados;
  const quedan = anteriores.rows[0].total - eliminados;
  console.log(
    eliminados === 0
      ? `Retención de ${dias} días: no había nada vencido. Quedan ${quedan} eventos.`
      : `Retención de ${dias} días: se vencieron ${eliminados} eventos. Quedan ${quedan}.`,
  );
} finally {
  await client.end();
}
