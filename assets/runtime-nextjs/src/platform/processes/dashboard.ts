import "server-only";
import { hasCapability } from "@/lib/auth";
import type { RuntimeUser } from "@/lib/auth-types";
import { sql } from "@/lib/db";
import { getEntity } from "@/lib/spec";
import { motorDisponible } from "@/platform/processes/engine";
import { medirProceso, type EtapaDefinida, type Tablero } from "@/platform/processes/metrics";

/**
 * Lo que lee la base para el tablero del trabajo. El cálculo está en `metrics.ts`.
 *
 * Lo ve quien puede ver toda la actividad (`view_audit`): ya ve cada cambio en `/audit`, y el
 * tablero sólo lo resume. Por eso lee las tablas directo, sin el alcance por registro, igual
 * que la auditoría. La tabla por persona es parte del tablero y sigue esa misma puerta: no se
 * muestra a quien opera, para que medir el trabajo no se vuelva un ranking a la vista de todos.
 */

export const DIAS_POR_DEFECTO = 90;
const ACTIVOS = ["en_cola", "tomada", "esperando", "en_revision", "devuelta"];
const LIMITE_CASOS = 2000;
const LIMITE_EVENTOS = 50_000;

export function rolesVenTablero(roles: readonly string[]) {
  return roles.length > 0 && roles.every((roleKey) => hasCapability({ roleKey } as RuntimeUser, "view_audit"));
}

export type ProcesoListado = { id: string; nombre: string; estado: string; version: number | null };

export async function listarProcesos(): Promise<ProcesoListado[]> {
  if (!motorDisponible()) return [];
  const filas = await sql<{ id: string; nombre: string; estado: string; version: number | null }>(
    `SELECT id, nombre, estado, ${columnaVersion()} AS version FROM "proceso" ORDER BY nombre ASC LIMIT 200`,
  );
  return filas.map((fila) => ({ ...fila, version: fila.version === null ? null : Number(fila.version) }));
}

/** `version` no lo exige el motor: si la aplicación no lo tiene, no se lista. */
function columnaVersion() {
  return getEntity("proceso")?.fields.some((field) => field.key === "version") ? '"version"' : "NULL";
}

function etapasDe(definicion: unknown): EtapaDefinida[] {
  const etapas = definicion && typeof definicion === "object" ? (definicion as { etapas?: unknown }).etapas : null;
  if (!Array.isArray(etapas)) return [];
  return etapas
    .filter((etapa): etapa is { orden: unknown; nombre: unknown } => Boolean(etapa) && typeof etapa === "object")
    .map((etapa) => ({ orden: Number(etapa.orden), nombre: String(etapa.nombre ?? `Etapa ${String(etapa.orden)}`) }))
    .filter((etapa) => Number.isInteger(etapa.orden))
    .sort((a, b) => a.orden - b.orden);
}

async function nombresDe(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const filas = await sql<{ id: string; display_name: string | null; email: string | null }>(
    "SELECT id, display_name, email FROM app_user WHERE id = ANY($1::uuid[])",
    [ids],
  );
  return new Map(filas.map((fila) => [fila.id, fila.display_name || fila.email || fila.id]));
}

export type TableroDeProceso = {
  proceso: { id: string; nombre: string; estado: string };
  dias: number;
  recortado: boolean;
  tablero: Tablero;
};

/**
 * El tablero de un proceso: los casos abiertos, más los que se crearon en los últimos `dias`.
 * Un caso cuenta entero, con toda su bitácora, aunque haya empezado antes del período.
 */
export async function tableroDeProceso(procesoId: string, dias = DIAS_POR_DEFECTO): Promise<TableroDeProceso | null> {
  if (!motorDisponible()) return null;
  const periodo = Math.min(Math.max(Math.trunc(dias) || DIAS_POR_DEFECTO, 1), 730);
  const [proceso] = await sql<{ id: string; nombre: string; estado: string; definicion: unknown }>(
    'SELECT id, nombre, estado, definicion FROM "proceso" WHERE id = $1',
    [procesoId],
  );
  if (!proceso) return null;
  const casos = await sql<{ id: string; titulo: string; etapa: string | number; estado: string; updated_at: Date }>(
    `SELECT id, titulo, etapa, estado, updated_at FROM "instancia"
      WHERE proceso_id = $1
        AND (created_at >= now() - make_interval(days => $2) OR estado = ANY($3::text[]))
      ORDER BY created_at DESC
      LIMIT ${LIMITE_CASOS + 1}`,
    [procesoId, periodo, ACTIVOS],
  );
  const recortadoCasos = casos.length > LIMITE_CASOS;
  const elegidos = casos.slice(0, LIMITE_CASOS);
  const eventos = elegidos.length
    ? await sql<{
      instancia_id: string; tipo: string; etapa: string | number; autor: string | null;
      created_at: Date; resumen: string | null; receta: unknown; salidas: unknown;
    }>(
      `SELECT instancia_id, tipo, etapa, autor, created_at, resumen, receta, salidas FROM "evento"
        WHERE instancia_id = ANY($1::uuid[])
        ORDER BY created_at ASC
        LIMIT ${LIMITE_EVENTOS + 1}`,
      [elegidos.map((caso) => caso.id)],
    )
    : [];
  const recortadoEventos = eventos.length > LIMITE_EVENTOS;

  const tablero = medirProceso({
    etapas: etapasDe(proceso.definicion),
    casos: elegidos.map((caso) => ({
      id: caso.id,
      titulo: caso.titulo,
      etapa: Number(caso.etapa),
      estado: caso.estado,
      actualizado: caso.updated_at,
    })),
    eventos: eventos.slice(0, LIMITE_EVENTOS).map((evento) => ({
      instancia: evento.instancia_id,
      tipo: evento.tipo,
      etapa: Number(evento.etapa),
      autor: evento.autor,
      fecha: evento.created_at,
      resumen: evento.resumen,
      receta: evento.receta,
      salidas: evento.salidas,
    })),
    ahora: new Date(),
  });

  const nombres = await nombresDe(tablero.personas.map((persona) => persona.persona));
  tablero.personas = tablero.personas.map((persona) => ({ ...persona, persona: nombres.get(persona.persona) ?? persona.persona }));

  return {
    proceso: { id: proceso.id, nombre: proceso.nombre, estado: proceso.estado },
    dias: periodo,
    recortado: recortadoCasos || recortadoEventos,
    tablero,
  };
}
