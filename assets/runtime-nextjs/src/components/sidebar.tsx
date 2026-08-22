import Link from "next/link";
import { clearDevelopmentRoleAction } from "@/app/dev-access/actions";
import { SessionSignOut } from "@/components/session-sign-out";
import { clerkAuthConfigured } from "@/platform/auth/config";
import { canManageUsers, canViewAudit, canViewRules, getCurrentUser, hasPermission, hasViewAccess } from "@/lib/auth";
import { localPreviewAuthEnabled } from "@/lib/runtime-access";
import { runtimeSpec } from "@/lib/spec";

export async function Sidebar() {
  const user = await getCurrentUser();

  const entityLinks = runtimeSpec.entities
    .filter((entity) => user && hasPermission(user, entity.key, "list"))
    .map((entity) => ({
      key: entity.key,
      label: entity.label_plural,
      href: `/records/${entity.key}`,
    }));

  // La página de una entidad ya aplica la configuración de su vista de tabla: campos,
  // orden y edición masiva. Así que una vista de tabla que se llama igual que su
  // entidad lleva al mismo lugar con el mismo nombre, y en el menú sólo agrega ruido.
  const nombresDeEntidad = new Set(entityLinks.map((link) => link.label.toLowerCase()));
  const viewLinks = runtimeSpec.views
    .filter((view) => view.navigation && ["table", "kanban", "calendar", "dashboard"].includes(view.type))
    .filter((view) => user && hasViewAccess(user, view))
    .filter((view) => !(view.type === "table" && nombresDeEntidad.has(view.label.toLowerCase())))
    .map((view) => ({ key: view.key, label: view.label, href: `/views/${view.key}` }));

  const systemLinks = [
    ...(user ? [{ key: "settings", label: "Configuración", href: "/settings" }] : []),
    ...(user && canManageUsers(user) ? [{ key: "users", label: "Usuarios", href: "/users" }] : []),
    ...(user && canViewAudit(user) ? [{ key: "agents", label: "Agentes", href: "/agents" }] : []),
    ...(user && canViewAudit(user) ? [{ key: "audit", label: "Auditoría", href: "/audit" }] : []),
    ...(user && canViewRules(user) ? [{ key: "rules", label: "Reglas", href: "/rules" }] : []),
  ];

  return (
    <aside className="sidebar">
      {/*
        En pantalla chica la navegación se pliega: con dieciocho enlaces desplegados
        ocupaba casi toda la pantalla y había que desplazarse para ver un solo dato.
        Se usa `details` en vez de un menú con JavaScript porque el navegador ya sabe
        abrirlo, cerrarlo y anunciarlo; en escritorio el CSS lo deja siempre abierto.
      */}
      <details className="nav-shell">
        <summary className="nav-toggle">
          <div className="brand">
            <div className="brand-name">{runtimeSpec.app.name}</div>
            <div className="brand-description">{runtimeSpec.app.description}</div>
          </div>
          <span aria-hidden="true" className="nav-toggle-icon" />
        </summary>

        <nav className="nav" aria-label="Navegación principal">
          <Link className="nav-link home" href="/">Resumen</Link>

          {entityLinks.length > 0 && <div className="nav-section">Datos</div>}
          {entityLinks.map((link) => (
            <Link className="nav-link" href={link.href} key={link.key}>{link.label}</Link>
          ))}

          {viewLinks.length > 0 && <div className="nav-section">Vistas</div>}
          {viewLinks.map((link) => (
            <Link className="nav-link" href={link.href} key={link.key}>{link.label}</Link>
          ))}

          {systemLinks.length > 0 && <div className="nav-section">Sistema</div>}
          {systemLinks.map((link) => (
            <Link className="nav-link" href={link.href} key={link.key}>{link.label}</Link>
          ))}
        </nav>

        <div className="session-panel">
          {user ? (
            <>
              <div className="session-name">{user.displayName}</div>
              <div className="session-email">{user.email}</div>
              {localPreviewAuthEnabled() && (
                <form action={clearDevelopmentRoleAction}>
                  <button className="session-action" type="submit">Cambiar rol</button>
                </form>
              )}
              {!localPreviewAuthEnabled() && clerkAuthConfigured() && <SessionSignOut />}
            </>
          ) : (
            <Link className="session-action" href={localPreviewAuthEnabled() ? "/dev-access" : "/sign-in"}>Acceder</Link>
          )}
        </div>
      </details>
    </aside>
  );
}
