"use client";

import { SignOutButton } from "@clerk/nextjs";

export function SessionSignOut() {
  return (
    <SignOutButton redirectUrl="/sign-in">
      <button className="session-action" type="button">Cerrar sesión</button>
    </SignOutButton>
  );
}
