import type { AgentPrincipal } from "@/platform/mcp/store";
import type { RuntimeUser } from "@/lib/auth-types";
import type { EntitySpec } from "@/lib/spec";

/**
 * Permisos a nivel de registro.
 *
 * Los permisos de la AppSpec responden "¿puede este rol modificar clientes?". Esto
 * responde la otra mitad: "¿cuáles?". Una entidad puede declarar que un rol ve todos
 * sus registros o sólo aquellos donde figura como responsable.
 *
 * Tres decisiones que hacen la diferencia entre un control y un adorno:
 *
 * 1. **Falla cerrado.** Si una entidad declara política y quien consulta no trae
 *    identidad, esto lanza una excepción en vez de asumir "todos". Un olvido rompe la
 *    pantalla; nunca abre los datos.
 * 2. **Un rol sin alcance declarado no ve nada.** El silencio no concede.
 * 3. **Un agente no puede exceder a su responsable.** Su alcance es el más restrictivo
 *    entre el de su propio rol y el de la persona que responde por él: una credencial
 *    no es una forma de ver lo que su dueño no puede ver.
 */
export type RecordAccessContext = {
  userId: string;
  roleKeys: readonly string[];
};

export type EffectiveRecordScope = "all" | "own" | "none";

export function recordAccessForUser(user: Pick<RuntimeUser, "id" | "roleKey">): RecordAccessContext {
  return { userId: user.id, roleKeys: [user.roleKey] };
}

export function recordAccessForAgent(agent: AgentPrincipal): RecordAccessContext | undefined {
  // Una persona que opera por MCP es ella misma, con su rol.
  if (agent.kind === "user") return { userId: agent.id, roleKeys: [agent.roleKey] };
  // Una credencial de agente responde por su dueño y queda acotada por el rol de éste.
  if (!agent.ownerUserId) return undefined;
  const roles = agent.ownerRoleKey ? [agent.roleKey, agent.ownerRoleKey] : [agent.roleKey];
  return { userId: agent.ownerUserId, roleKeys: roles };
}

export function effectiveRecordScope(
  entity: EntitySpec,
  access?: RecordAccessContext,
): EffectiveRecordScope {
  const policy = entity.record_access;
  if (!policy) return "all";
  if (!access?.userId || !access.roleKeys.length) {
    throw new Error(
      `La entidad ${entity.key} tiene permisos por registro y la consulta llegó sin identidad.`,
    );
  }
  const alcances = [...new Set(access.roleKeys)].map((roleKey) => policy.roles[roleKey]);
  // Cualquier rol sin alcance declarado reduce todo a nada: el más restrictivo manda.
  if (alcances.some((alcance) => alcance !== "all" && alcance !== "own")) return "none";
  return alcances.every((alcance) => alcance === "all") ? "all" : "own";
}

/** Al crear, el registro nace a nombre de quien lo crea, salvo que pueda ver todo. */
export function prepareRecordCreate(
  entity: EntitySpec,
  values: Record<string, unknown>,
  access?: RecordAccessContext,
) {
  const policy = entity.record_access;
  if (!policy) return values;
  const alcance = effectiveRecordScope(entity, access);
  if (alcance === "none") {
    throw new Error(`Tu rol no tiene alcance sobre los registros de ${entity.label}.`);
  }
  if (alcance === "all") return values;
  const actual = values[policy.owner_field];
  if (actual !== undefined && actual !== null && actual !== "" && actual !== access!.userId) {
    throw new Error("No podés crear un registro a nombre de otra persona.");
  }
  return { ...values, [policy.owner_field]: access!.userId };
}

/** Al modificar, nadie con alcance propio puede pasarle un registro a otro. */
export function assertRecordOwnershipChange(
  entity: EntitySpec,
  values: Record<string, unknown>,
  access?: RecordAccessContext,
) {
  const policy = entity.record_access;
  if (!policy || !(policy.owner_field in values)) return;
  const alcance = effectiveRecordScope(entity, access);
  if (alcance === "none") {
    throw new Error(`Tu rol no tiene alcance sobre los registros de ${entity.label}.`);
  }
  if (alcance === "own" && values[policy.owner_field] !== access!.userId) {
    throw new Error("No podés transferir un registro fuera de tu propio alcance.");
  }
}

/**
 * Un registro que no existe y uno que es de otra persona dan la misma respuesta.
 *
 * Distinguirlos sería confirmar que existe, que es justo lo que el alcance oculta.
 * Las pantallas la traducen a un 404 y el MCP a `found: false`.
 */
export class RecordOutOfScopeError extends Error {
  readonly code = "record_out_of_scope";
}

/**
 * Con alcance propio, el campo que define al dueño sólo puede ofrecer a uno mismo.
 *
 * `prepareRecordCreate` y `assertRecordOwnershipChange` ya rechazan lo demás, así que
 * esto no agrega un control: quita una trampa. Un desplegable que lista a toda la
 * organización cuando sólo una opción va a ser aceptada convierte una regla clara en un
 * error al guardar, y encima muestra el directorio completo a quien tiene alcance
 * acotado. Los demás campos de tipo persona no se tocan: no deciden quién ve qué.
 */
export function ownerFieldRestriction(
  entity: EntitySpec,
  access?: RecordAccessContext,
): { ownerField: string; allowedId: string } | undefined {
  const policy = entity.record_access;
  if (!policy) return undefined;
  if (effectiveRecordScope(entity, access) !== "own") return undefined;
  return { ownerField: policy.owner_field, allowedId: access!.userId };
}
