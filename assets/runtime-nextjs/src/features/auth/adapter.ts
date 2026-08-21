import { auth, currentUser } from "@clerk/nextjs/server";
import type { ProductionAuthAdapter } from "@/lib/auth-types";
import { clerkAuthConfigured } from "@/features/auth/config";

/**
 * Client-owned production extension point.
 *
 * Clerk proves identity. Application roles and active status remain in
 * PostgreSQL and are never trusted from a browser cookie or provider metadata.
 */
export const productionAuthAdapter: ProductionAuthAdapter = {
  signInPath: "/sign-in",
  async currentSubject() {
    if (!clerkAuthConfigured()) return null;
    const session = await auth();
    return session.userId;
  },
  async provisioningIdentity(subject) {
    if (!clerkAuthConfigured()) return null;
    const user = await currentUser();
    if (!user || user.id !== subject) return null;
    const primary = user.emailAddresses.find((candidate) => candidate.id === user.primaryEmailAddressId);
    const verified = primary?.verification?.status === "verified"
      ? primary
      : user.emailAddresses.find((candidate) => candidate.verification?.status === "verified");
    const emailAddress = verified?.emailAddress.trim().toLowerCase();
    if (!emailAddress) {
      return {
        subject,
        email: primary?.emailAddress.trim().toLowerCase() ?? "",
        displayName: user.fullName ?? user.firstName ?? "Usuario",
        emailVerified: false,
      };
    }
    return {
      subject,
      email: emailAddress,
      displayName: user.fullName ?? user.firstName ?? emailAddress,
      emailVerified: true,
    };
  },
};
