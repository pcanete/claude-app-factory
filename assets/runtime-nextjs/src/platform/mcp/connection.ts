import { runtimeSpec } from "@/lib/spec";

/**
 * El nombre con el que una credencial se registra en la máquina de quien la usa.
 *
 * Cada cliente MCP guarda sus servidores en una lista donde el nombre es la clave. Si
 * dos entradas comparten nombre, la segunda reemplaza a la primera **en silencio**: no
 * hay error, simplemente desaparece una conexión y parece que "no anda". Pasa apenas
 * alguien conecta dos aplicaciones generadas por esta fábrica, porque el nombre por
 * defecto solía ser el mismo para todas.
 *
 * Por eso el nombre lleva la clave de la aplicación adelante: dos aplicaciones distintas
 * nunca chocan, aunque sus agentes se llamen igual. Dentro de una misma aplicación, la
 * unicidad la garantiza el servidor al crear el agente.
 */
export function connectionSlug(agentName: string) {
  const propio = agentName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const aplicacion = runtimeSpec.app.key.replace(/_/g, "-");
  return propio ? `${aplicacion}-${propio}` : aplicacion;
}

/** El nombre de la variable de entorno que guarda la credencial en esa máquina. */
export function connectionEnvVar(agentName: string) {
  return `${connectionSlug(agentName).replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_TOKEN`;
}
