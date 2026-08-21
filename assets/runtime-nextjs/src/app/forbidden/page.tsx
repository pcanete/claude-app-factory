import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { runtimeSpec } from "@/lib/spec";

export const dynamic = "force-dynamic";

export default async function ForbiddenPage() {
  const user = await requireUser();
  const role = runtimeSpec.roles.find((candidate) => candidate.key === user.roleKey);

  return (
    <section className="auth-card">
      <p className="eyebrow">Permiso insuficiente</p>
      <h1>Esta operación no está habilitada</h1>
      <p className="subtitle">
        El rol {role?.label ?? user.roleKey} no tiene el permiso requerido. La comprobación se realizó en el servidor.
      </p>
      <div className="form-actions">
        <Link className="button" href="/">Volver al resumen</Link>
      </div>
    </section>
  );
}
