import Link from "next/link";
import { clearDevelopmentRoleAction } from "@/app/dev-access/actions";
import { SessionSignOut } from "@/components/session-sign-out";
import { clerkAuthConfigured } from "@/features/auth/config";
import { canUseApplicationAssistant } from "@/features/ai/access";
import { canManageUsers, canViewAudit, canViewRules, getCurrentUser, hasPermission, hasViewAccess } from "@/lib/auth";
import { localPreviewAuthEnabled } from "@/lib/runtime-access";
import { runtimeSpec } from "@/lib/spec";

export async function Sidebar() {
  const user = await getCurrentUser();
  const entityLinks = runtimeSpec.entities.filter((entity) => user && hasPermission(user, entity.key, "list")).map((entity) => ({
    key: entity.key,
    label: entity.label_plural,
    href: `/records/${entity.key}`,
  }));
  const viewLinks = runtimeSpec.views
    .filter((view) => view.navigation && ["table", "kanban", "calendar", "dashboard"].includes(view.type))
    .filter((view) => user && hasViewAccess(user, view))
    .map((view) => ({ key: view.key, label: view.label, href: `/views/${view.key}` }));

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-name">{runtimeSpec.app.name}</div>
        <div className="brand-description">{runtimeSpec.app.description}</div>
      </div>
      <nav className="nav" aria-label="Navegación principal">
        <Link className="nav-link home" href="/">Resumen</Link>
        {entityLinks.map((link) => (
          <Link className="nav-link" href={link.href} key={link.key}>{link.label}</Link>
        ))}
        {viewLinks.length > 0 && <div className="nav-section">Vistas</div>}
        {viewLinks.map((link) => (
          <Link className="nav-link" href={link.href} key={link.key}>{link.label}</Link>
        ))}
        {user && canUseApplicationAssistant(user) && (
          <Link className="nav-link assistant-link" href="/assistant">Asistente IA</Link>
        )}
        {user && canManageUsers(user) && <Link className="nav-link" href="/users">Usuarios</Link>}
        {user && canViewAudit(user) && <Link className="nav-link audit-link" href="/audit">Auditoría</Link>}
        {user && canViewRules(user) && <Link className="nav-link" href="/rules">Reglas</Link>}
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
    </aside>
  );
}
