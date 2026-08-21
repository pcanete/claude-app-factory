import type { RuntimeUser } from "@/lib/auth-types";
import { hasPermission } from "@/lib/auth";
import { runtimeSpec } from "@/lib/spec";

export function canUseApplicationAssistant(user: RuntimeUser) {
  return runtimeSpec.entities.some(
    (entity) => hasPermission(user, entity.key, "list") || hasPermission(user, entity.key, "read"),
  );
}

export function assistantEntities(user: RuntimeUser) {
  return runtimeSpec.entities.filter(
    (entity) => hasPermission(user, entity.key, "list") || hasPermission(user, entity.key, "read"),
  );
}
