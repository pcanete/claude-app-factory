import { requireUserManagementAccess } from "@/lib/auth";
import { listSettings } from "@/platform/settings/store";
import { SettingsEditor } from "@/components/settings-editor";

export const dynamic = "force-dynamic";

// Cambiar la configuración del sistema es una acción administrativa: se gobierna con
// la misma capacidad que administra personas y credenciales de agente.
export default async function SettingsPage() {
  await requireUserManagementAccess();
  const settings = await listSettings();

  const porEspacio = new Map<string, typeof settings>();
  for (const setting of settings) {
    const grupo = porEspacio.get(setting.namespace) ?? [];
    grupo.push(setting);
    porEspacio.set(setting.namespace, grupo);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Configuración del sistema</p>
          <h1>Opciones</h1>
          <p className="subtitle">
            Pares clave/valor para lo que la aplicación necesita recordar. El valor es JSON: admite un
            número, un texto, una lista o un objeto.
          </p>
        </div>
      </div>

      <div className="notice">
        Esto es para configuración, no para datos de negocio. Lo que pertenece al dominio va como
        entidad, donde tiene tipos, permisos, reglas y auditoría por registro.
      </div>

      <SettingsEditor groups={[...porEspacio.entries()].map(([namespace, items]) => ({ namespace, items }))} />
    </>
  );
}
