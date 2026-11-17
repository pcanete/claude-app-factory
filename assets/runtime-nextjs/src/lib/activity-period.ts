import type { ActivityEvent, ActivitySource } from "@/lib/audit";

/**
 * Cuánto tiempo mira el grafo de actividad.
 *
 * Por defecto dibuja los últimos eventos: responde «¿está vivo ahora?». Con un período
 * responde otra pregunta —«¿quién movió qué esta semana?»— y para eso no sirve traer
 * miles de eventos: se cuentan en la base, agrupados por quién y sobre qué, y el dibujo
 * se arma con esos totales. El grafo pesa lo mismo con 40 eventos que con 40.000.
 *
 * Sin dependencias de servidor: `scripts/test-activity-period.mjs` prueba este archivo.
 */
export const EVENTOS_RECIENTES = 40;

export const PERIODOS = [
  { key: "recientes", label: `Últimos ${EVENTOS_RECIENTES} eventos`, horas: null, frase: "" },
  { key: "24h", label: "Últimas 24 horas", horas: 24, frase: "en las últimas 24 horas" },
  { key: "7d", label: "Últimos 7 días", horas: 24 * 7, frase: "en los últimos 7 días" },
  { key: "30d", label: "Últimos 30 días", horas: 24 * 30, frase: "en los últimos 30 días" },
] as const;

export type Periodo = (typeof PERIODOS)[number]["key"];

/** Lo que llega por la dirección; cualquier otra cosa es el valor por defecto. */
export function periodoValido(valor: string | undefined): Periodo {
  return PERIODOS.find((p) => p.key === valor)?.key ?? "recientes";
}

export function datosDePeriodo(periodo: Periodo) {
  return PERIODOS.find((p) => p.key === periodo) ?? PERIODOS[0];
}

/** Desde cuándo cuenta el período, o nada si se miran los últimos eventos. */
export function desdeDePeriodo(periodo: Periodo, ahora = new Date()): Date | undefined {
  const { horas } = datosDePeriodo(periodo);
  return horas === null ? undefined : new Date(ahora.getTime() - horas * 3_600_000);
}

/**
 * Cuánto hizo un actor sobre una entidad. Es la unidad con que se arma el grafo, venga
 * de agrupar en la base o de agrupar acá los últimos eventos.
 */
export type GrupoDeActividad = {
  source: ActivitySource;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  agent_id: string | null;
  agent_name: string | null;
  responsible_name: string | null;
  entity_key: string | null;
  cantidad: number;
  fallos: number;
  ultimo: Date | string;
};

/** Los últimos eventos, agrupados igual que los agrupa la base para un período. */
export function agruparEventos(eventos: ActivityEvent[]): GrupoDeActividad[] {
  const grupos = new Map<string, GrupoDeActividad>();
  for (const evento of eventos) {
    const clave = [evento.source, evento.actor_id, evento.agent_id, evento.entity_key].join("|");
    const fallo = evento.status === "failed" ? 1 : 0;
    const previo = grupos.get(clave);
    if (previo) {
      previo.cantidad += 1;
      previo.fallos += fallo;
      if (new Date(evento.created_at).getTime() > new Date(previo.ultimo).getTime()) previo.ultimo = evento.created_at;
      continue;
    }
    grupos.set(clave, {
      source: evento.source,
      actor_id: evento.actor_id,
      actor_name: evento.actor_name,
      actor_email: evento.actor_email,
      agent_id: evento.agent_id,
      agent_name: evento.agent_name,
      responsible_name: evento.responsible_name,
      entity_key: evento.entity_key,
      cantidad: 1,
      fallos: fallo,
      ultimo: evento.created_at,
    });
  }
  return [...grupos.values()];
}
