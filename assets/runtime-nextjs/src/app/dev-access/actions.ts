"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEVELOPMENT_SESSION_COOKIE } from "@/lib/auth";
import { assertLocalPreviewAuthEnabled } from "@/lib/runtime-access";
import { runtimeSpec } from "@/lib/spec";

export async function selectDevelopmentRoleAction(formData: FormData) {
  assertLocalPreviewAuthEnabled();
  const roleKey = formData.get("role_key");
  if (typeof roleKey !== "string" || !runtimeSpec.roles.some((role) => role.key === roleKey)) {
    throw new Error("Rol de desarrollo desconocido.");
  }
  (await cookies()).set(DEVELOPMENT_SESSION_COOKIE, roleKey, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  redirect("/");
}

export async function clearDevelopmentRoleAction() {
  assertLocalPreviewAuthEnabled();
  (await cookies()).delete(DEVELOPMENT_SESSION_COOKIE);
  redirect("/dev-access");
}
