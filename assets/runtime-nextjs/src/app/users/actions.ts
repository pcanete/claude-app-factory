"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createManagedUser,
  getManagedUserForUpdate,
  isLocalPreviewIdentity,
  isManagedUserId,
  updateManagedUser,
  type ManagedUserInput,
} from "@/features/users/store";
import { recordAuditEvent } from "@/lib/audit";
import { requireUserManagementAccess } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { runtimeSpec } from "@/lib/spec";

function normalizedInput(formData: FormData): ManagedUserInput | null {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const roleKey = String(formData.get("role_key") ?? "");
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return null;
  if (!displayName || displayName.length > 120) return null;
  if (!runtimeSpec.roles.some((role) => role.key === roleKey)) return null;
  return { email, displayName, roleKey, active: formData.get("active") === "on" };
}
function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function refreshUsers(id?: string) {
  revalidatePath("/users");
  if (id) revalidatePath(`/users/${id}`);
  revalidatePath("/audit");
}

export async function createUserAction(formData: FormData) {
  const actor = await requireUserManagementAccess();
  const input = normalizedInput(formData);
  if (!input) redirect("/users?error=invalid_input");
  let id: string;
  try {
    id = await withTransaction(async (client) => {
      const userId = await createManagedUser(client, { ...input, authSubject: `pending:${randomUUID()}` });
      await recordAuditEvent(client, {
        actorId: actor.id,
        entityKey: "app_user",
        recordId: userId,
        action: "user_create",
        changes: { after: input, identity: "pending" },
      });
      return userId;
    });
  } catch (error) {
    if (isUniqueViolation(error)) redirect("/users?error=email_exists");
    throw error;
  }
  refreshUsers(id);
  redirect(`/users/${id}?saved=created`);
}

export async function updateUserAction(id: string, formData: FormData) {
  const actor = await requireUserManagementAccess();
  if (!isManagedUserId(id)) redirect("/users?error=not_found");
  const input = normalizedInput(formData);
  if (!input) redirect(`/users/${id}?error=invalid_input`);
  try {
    await withTransaction(async (client) => {
      const before = await getManagedUserForUpdate(client, id);
      if (!before) throw new Error("USER_NOT_FOUND");
      if (isLocalPreviewIdentity(before.authSubject)) throw new Error("LOCAL_IDENTITY");
      if (actor.id === id && (!input.active || input.roleKey !== before.roleKey)) throw new Error("SELF_PROTECTION");
      await updateManagedUser(client, id, input);
      const changedStatusOnly = before.email === input.email
        && before.displayName === input.displayName
        && before.roleKey === input.roleKey
        && before.active !== input.active;
      await recordAuditEvent(client, {
        actorId: actor.id,
        entityKey: "app_user",
        recordId: id,
        action: changedStatusOnly ? "user_status" : "user_update",
        changes: {
          before: { email: before.email, displayName: before.displayName, roleKey: before.roleKey, active: before.active },
          after: input,
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) redirect(`/users/${id}?error=email_exists`);
    if (error instanceof Error && error.message === "USER_NOT_FOUND") redirect("/users?error=not_found");
    if (error instanceof Error && error.message === "LOCAL_IDENTITY") redirect(`/users/${id}?error=local_identity`);
    if (error instanceof Error && error.message === "SELF_PROTECTION") redirect(`/users/${id}?error=self_protection`);
    throw error;
  }
  refreshUsers(id);
  redirect(`/users/${id}?saved=updated`);
}
