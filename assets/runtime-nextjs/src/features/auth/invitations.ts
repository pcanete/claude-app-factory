import "server-only";

import { clerkClient } from "@clerk/nextjs/server";
import { applicationUrl, clerkAuthConfigured } from "@/features/auth/config";

export type InvitationResult = "sent" | "not_configured" | "failed";

export async function sendApplicationInvitation(email: string): Promise<InvitationResult> {
  if (!clerkAuthConfigured()) return "not_configured";
  try {
    const client = await clerkClient();
    await client.invitations.createInvitation({
      emailAddress: email,
      ignoreExisting: true,
      notify: true,
      redirectUrl: `${applicationUrl()}/sign-up`,
    });
    return "sent";
  } catch (error) {
    console.error("No se pudo enviar la invitación de acceso.", error);
    return "failed";
  }
}
