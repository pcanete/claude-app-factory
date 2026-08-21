import type { ProductionAuthAdapter } from "@/lib/auth-types";

/**
 * Client-owned production extension point.
 *
 * Replace this fail-closed adapter with Clerk, Descope, Auth0, or another
 * reviewed identity provider. Return only provider identity here; application
 * roles remain in app_user and are never trusted from a browser cookie or form.
 */
export const productionAuthAdapter: ProductionAuthAdapter = {
  signInPath: "/sign-in",
  async currentIdentity() {
    return null;
  },
};
