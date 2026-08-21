import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { productionAuthAdapter } from "@/features/auth/adapter";
import { generatedPermissions } from "@/generated/permissions";
import { recordAuditEvent } from "@/lib/audit";
import type { PermissionAction, RuntimeUser } from "@/lib/auth-types";
import { sql, transactionSql, withTransaction } from "@/lib/db";
import { localPreviewAuthEnabled } from "@/lib/runtime-access";
import { type EntitySpec, type ViewSpec, relationFields, requireEntity, requireView, runtimeSpec } from "@/lib/spec";

export const DEVELOPMENT_SESSION_COOKIE = "riel_development_role";

const permissionMatrix = generatedPermissions as unknown as Record<
  string,
  Record<string, readonly PermissionAction[]>
>;

type AppUserRow = {
  id: string;
  auth_subject: string;
  email: string;
  display_name: string;
  role_key: string;
  active: boolean;
};

export type CurrentAccess =
  | { kind: "granted"; user: RuntimeUser }
  | { kind: "unauthenticated" }
  | { kind: "unverified_email" }
  | { kind: "not_invited" }
  | { kind: "inactive" };

function toRuntimeUser(row: AppUserRow): RuntimeUser {
  return {
    id: row.id,
    authSubject: row.auth_subject,
    email: row.email,
    displayName: row.display_name,
    roleKey: row.role_key,
  };
}

async function developmentUser(roleKey: string): Promise<RuntimeUser | null> {
  const role = runtimeSpec.roles.find((candidate) => candidate.key === roleKey);
  if (!role) return null;
  const values = [`development:${role.key}`, `${role.key}@development.invalid`, `Vista local · ${role.label}`, role.key];
  await sql(
    `INSERT INTO app_user (auth_subject, email, display_name, role_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    values,
  );
  const rows = await sql<AppUserRow>(
    `UPDATE app_user
        SET email = $2, display_name = $3, role_key = $4, active = TRUE
      WHERE auth_subject = $1
      RETURNING id, auth_subject, email, display_name, role_key`,
    values,
  );
  return rows[0] ? toRuntimeUser(rows[0]) : null;
}

async function productionAccess(): Promise<CurrentAccess> {
  const subject = await productionAuthAdapter.currentSubject();
  if (!subject) return { kind: "unauthenticated" };
  const rows = await sql<AppUserRow>(
    `SELECT id, auth_subject, email, display_name, role_key, active
       FROM app_user
      WHERE auth_subject = $1
      LIMIT 1`,
    [subject],
  );
  if (rows[0]) {
    return rows[0].active
      ? { kind: "granted", user: toRuntimeUser(rows[0]) }
      : { kind: "inactive" };
  }

  const identity = await productionAuthAdapter.provisioningIdentity(subject);
  if (!identity?.emailVerified || !identity.email) return { kind: "unverified_email" };

  return withTransaction(async (client): Promise<CurrentAccess> => {
    const candidates = await transactionSql<AppUserRow>(
      client,
      `SELECT id, auth_subject, email, display_name, role_key, active
         FROM app_user
        WHERE auth_subject = $1
           OR (lower(email) = $2 AND auth_subject LIKE 'pending:%')
        FOR UPDATE`,
      [subject, identity.email],
    );
    const alreadyLinked = candidates.find((candidate) => candidate.auth_subject === subject);
    if (alreadyLinked) {
      return alreadyLinked.active
        ? { kind: "granted", user: toRuntimeUser(alreadyLinked) }
        : { kind: "inactive" };
    }
    const pending = candidates.find((candidate) => candidate.auth_subject.startsWith("pending:"));
    if (!pending) return { kind: "not_invited" };
    if (!pending.active) return { kind: "inactive" };

    const linked = await transactionSql<AppUserRow>(
      client,
      `UPDATE app_user
          SET auth_subject = $2,
              identity_linked_at = now(),
              updated_at = now()
        WHERE id = $1 AND auth_subject LIKE 'pending:%'
        RETURNING id, auth_subject, email, display_name, role_key, active`,
      [pending.id, subject],
    );
    if (!linked[0]) return { kind: "not_invited" };
    await recordAuditEvent(client, {
      actorId: linked[0].id,
      entityKey: "app_user",
      recordId: linked[0].id,
      action: "user_link",
      changes: { provider: "clerk", email: identity.email },
    });
    return { kind: "granted", user: toRuntimeUser(linked[0]) };
  });
}

const currentAccess = cache(async (): Promise<CurrentAccess> => {
  if (!localPreviewAuthEnabled()) return productionAccess();
  const roleKey = (await cookies()).get(DEVELOPMENT_SESSION_COOKIE)?.value;
  const user = roleKey ? await developmentUser(roleKey) : null;
  return user ? { kind: "granted", user } : { kind: "unauthenticated" };
});

export async function getCurrentUser(): Promise<RuntimeUser | null> {
  const access = await currentAccess();
  return access.kind === "granted" ? access.user : null;
}

export async function requireUser(): Promise<RuntimeUser> {
  const access = await currentAccess();
  if (access.kind === "granted") return access.user;
  if (localPreviewAuthEnabled()) redirect("/dev-access");
  if (access.kind === "unauthenticated") redirect(productionAuthAdapter.signInPath);
  redirect(`/access-pending?reason=${access.kind}`);
}

export function hasPermission(user: RuntimeUser, entityKey: string, action: PermissionAction) {
  return permissionMatrix[entityKey]?.[user.roleKey]?.includes(action) ?? false;
}

export async function requirePermission(entityKey: string, action: PermissionAction) {
  requireEntity(entityKey);
  const user = await requireUser();
  if (!hasPermission(user, entityKey, action)) redirect("/forbidden");
  return user;
}

function viewEntityKeys(view: ViewSpec) {
  if (view.type === "dashboard") return [...new Set((view.widgets ?? []).map((widget) => widget.entity))];
  return view.entity ? [view.entity] : [];
}

export function hasViewAccess(user: RuntimeUser, view: ViewSpec) {
  const entities = viewEntityKeys(view);
  return entities.length > 0 && entities.every((entityKey) => hasPermission(user, entityKey, "list"));
}

export async function requireViewAccess(viewKey: string) {
  const view = requireView(viewKey);
  const user = await requireUser();
  if (!hasViewAccess(user, view)) redirect("/forbidden");
  return user;
}

export function canAccessRelationshipOptions(user: RuntimeUser, entity: EntitySpec) {
  return relationFields(entity).every((relationship) =>
    hasPermission(user, relationship.target, "list"),
  );
}

export function canViewAudit(user: RuntimeUser) {
  return runtimeSpec.entities.every(
    (entity) =>
      hasPermission(user, entity.key, "list") &&
      hasPermission(user, entity.key, "read") &&
      hasPermission(user, entity.key, "delete"),
  );
}

export async function requireAuditAccess() {
  const user = await requireUser();
  if (!canViewAudit(user)) redirect("/forbidden");
  return user;
}

export const canManageUsers = canViewAudit;

export async function requireUserManagementAccess() {
  const user = await requireUser();
  if (!canManageUsers(user)) redirect("/forbidden");
  return user;
}

export const canViewRules = canViewAudit;

export async function requireRulesAccess() {
  const user = await requireUser();
  if (!canViewRules(user)) redirect("/forbidden");
  return user;
}
