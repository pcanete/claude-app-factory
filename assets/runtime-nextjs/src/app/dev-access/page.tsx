import { notFound } from "next/navigation";
import { selectDevelopmentRoleAction } from "@/app/dev-access/actions";
import { getCurrentUser } from "@/lib/auth";
import { localPreviewAuthEnabled } from "@/lib/runtime-access";
import { runtimeSpec } from "@/lib/spec";

export const dynamic = "force-dynamic";

export default async function DevelopmentAccessPage() {
  if (!localPreviewAuthEnabled()) notFound();
  const user = await getCurrentUser();

  return (
    <section className="auth-card">
      <p className="eyebrow">Sólo desarrollo local</p>
      <h1>Elegí un rol para probar</h1>
      <p className="subtitle">
        Esta pantalla no utiliza contraseñas y queda deshabilitada automáticamente en producción.
      </p>
      <form action={selectDevelopmentRoleAction} className="auth-form">
        <label className="field">
          <span className="field-label">Rol de prueba</span>
          <select className="control" defaultValue={user?.roleKey ?? runtimeSpec.roles[0]?.key} name="role_key">
            {runtimeSpec.roles.map((role) => (
              <option key={role.key} value={role.key}>{role.label}</option>
            ))}
          </select>
        </label>
        <button className="button" type="submit">Ingresar a la aplicación</button>
      </form>
      <div className="notice warning">
        La identidad de producción se conecta en <code>src/platform/auth/adapter.ts</code>; los roles siempre se leen desde PostgreSQL.
      </div>
    </section>
  );
}
