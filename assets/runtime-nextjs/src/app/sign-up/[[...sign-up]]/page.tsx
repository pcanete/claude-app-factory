import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { clerkAuthConfigured } from "@/platform/auth/config";
import { localPreviewAuthEnabled } from "@/lib/runtime-access";

export const dynamic = "force-dynamic";

export default function SignUpPage() {
  if (localPreviewAuthEnabled()) redirect("/dev-access");
  if (!clerkAuthConfigured()) redirect("/sign-in");
  return (
    <section className="auth-state clerk-auth-state">
      <SignUp forceRedirectUrl="/" path="/sign-up" routing="path" signInUrl="/sign-in" />
    </section>
  );
}
