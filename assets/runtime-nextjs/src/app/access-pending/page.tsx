import { SessionSignOut } from "@/components/session-sign-out";
import { clerkAuthConfigured } from "@/features/auth/config";

export const dynamic = "force-dynamic";

const messages: Record<string, { title: string; body: string }> = {
  unverified_email: {
    title: "Verificá tu correo",
    body: "La identidad existe, pero necesitamos un correo verificado antes de vincularla con la aplicación.",
  },
  not_invited: {
    title: "Tu acceso todavía no fue habilitado",
    body: "Un administrador debe agregarte en Usuarios usando el mismo correo con el que ingresaste.",
  },
  inactive: {
    title: "Tu acceso está desactivado",
    body: "La identidad es válida, pero el administrador desactivó esta cuenta en la aplicación.",
  },
};

export default async function AccessPendingPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const requested = await searchParams;
  const message = messages[requested.reason ?? ""] ?? messages.not_invited;
  return (
    <section className="auth-state">
      <p className="eyebrow">Acceso a la aplicación</p>
      <h1>{message.title}</h1>
      <p className="subtitle">{message.body}</p>
      {clerkAuthConfigured() && <SessionSignOut />}
    </section>
  );
}
