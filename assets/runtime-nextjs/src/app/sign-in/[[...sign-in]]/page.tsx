import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { clerkAuthConfigured } from "@/features/auth/config";
import { localPreviewAuthEnabled } from "@/lib/runtime-access";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  if (localPreviewAuthEnabled()) redirect("/dev-access");
  if (!clerkAuthConfigured()) {
    return (
      <section className="auth-state">
        <p className="eyebrow">Acceso protegido</p>
        <h1>Falta configurar la identidad</h1>
        <p className="subtitle">Definí las claves de Clerk en el entorno del servidor para habilitar el ingreso.</p>
      </section>
    );
  }
  return (
    <section className="auth-state clerk-auth-state">
      <SignIn forceRedirectUrl="/" path="/sign-in" routing="path" signUpUrl="/sign-up" />
    </section>
  );
}
