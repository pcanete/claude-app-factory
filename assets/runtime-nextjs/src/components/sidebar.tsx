import Link from "next/link";
import { clearDevelopmentRoleAction } from "@/app/dev-access/actions";
import { SessionSignOut } from "@/components/session-sign-out";
import { clerkAuthConfigured } from "@/platform/auth/config";
import { canManageUsers, canViewAudit, canViewRules, getCurrentUser, hasPermission, hasViewAccess } from "@/lib/auth";
import { localPreviewAuthEnabled } from "@/lib/runtime-access";
import { runtimeSpec } from "@/lib/spec";
import { motorDisponible } from "@/platform/processes/engine";

/** Las entidades del motor de procesos: tienen su propia sección. */
const ENTIDADES_DE_PROCESO = new Set(["proceso", "instancia", "evento"]);

type Enlace = { key: string; label: string; href: string };

/**
 * El menú se ordena por lo que la persona viene a hacer, no por el tipo de dato.
 *
 * Antes eran tres listas —entidades, vistas, sistema— y lo mismo aparecía dos veces con
 * otro nombre: «Instancias» y «Procesos en curso» llevaban a los mismos casos. Ahora:
 *
 *   Mi trabajo   lo que la persona tiene para hacer, si la aplicación opera procesos
 *   Operación    las vistas del dominio
 *   Procesos     definiciones, casos, bitácora y el tablero del trabajo
 *   Datos        las entidades sin vista propia, plegadas: para cargar o buscar
 *   Sistema      administración
 *
 * Una entidad que tiene una vista en el menú no se repite en Datos: se llega por su vista,
 * y la vista tiene «Abrir listado base». Una sección vacía no se muestra.
 */
export async function Sidebar() {
  const user = await getCurrentUser();
  const motor = motorDisponible();
  const deProceso = (entityKey?: string) => motor && Boolean(entityKey) && ENTIDADES_DE_PROCESO.has(entityKey!);

  const vistas = runtimeSpec.views
    .filter((view) => view.navigation && ["table", "kanban", "calendar", "dashboard"].includes(view.type))
    .filter((view) => user && hasViewAccess(user, view));
  const entidadesConVista = new Set(vistas.map((view) => view.entity).filter((key): key is string => Boolean(key)));
  const enlaceDeVista = (view: (typeof vistas)[number]): Enlace => ({ key: `view:${view.key}`, label: view.label, href: `/views/${view.key}` });
  const entidades = runtimeSpec.entities
    .filter((entity) => user && hasPermission(user, entity.key, "list"))
    .filter((entity) => !entidadesConVista.has(entity.key));
  const enlaceDeEntidad = (entity: (typeof entidades)[number]): Enlace => ({ key: `entity:${entity.key}`, label: entity.label_plural, href: `/records/${entity.key}` });

  const miTrabajo: Enlace[] = motor && user && hasPermission(user, "instancia", "read")
    ? [{ key: "pendientes", label: "Mis pendientes", href: "/pendientes" }]
    : [];
  const operacion = vistas.filter((view) => !deProceso(view.entity)).map(enlaceDeVista);
  const procesos: Enlace[] = [
    ...vistas.filter((view) => deProceso(view.entity)).map(enlaceDeVista),
    ...entidades.filter((entity) => deProceso(entity.key)).map(enlaceDeEntidad),
    ...(user && motor && canViewAudit(user) ? [{ key: "trabajo", label: "Trabajo", href: "/trabajo" }] : []),
  ];
  const datos = entidades.filter((entity) => !deProceso(entity.key)).map(enlaceDeEntidad);
  const sistema: Enlace[] = [
    ...(user && canManageUsers(user) ? [{ key: "users", label: "Usuarios", href: "/users" }] : []),
    ...(user && canViewAudit(user) ? [{ key: "agents", label: "Agentes", href: "/agents" }] : []),
    ...(user && canViewAudit(user) ? [{ key: "audit", label: "Actividad", href: "/audit" }] : []),
    ...(user && canViewRules(user) ? [{ key: "rules", label: "Reglas", href: "/rules" }] : []),
    ...(user ? [{ key: "settings", label: "Configuración", href: "/settings" }] : []),
  ];
  // Sin vistas de dominio, los datos son lo único que hay para hacer: van abiertos.
  const datosAbiertos = operacion.length === 0;
  const lista = (enlaces: Enlace[]) => enlaces.map((link) => (
    <Link className="nav-link" href={link.href} key={link.key}>{link.label}</Link>
  ));

  return (
    <aside className="sidebar">
      {/*
        En pantalla chica la navegación se pliega: con dieciocho enlaces desplegados
        ocupaba casi toda la pantalla y había que desplazarse para ver un solo dato.

        El plegado es una casilla, no un `details`, por cómo falla cada uno. Un `details`
        cerrado esconde su contenido por decisión del navegador, y sólo el CSS lo vuelve
        a mostrar en escritorio: si esa hoja tarda o no llega —un despliegue a mitad de
        camino alcanza—, el menú entero desaparece. Una casilla sin CSS es una casilla
        sin marcar al lado de una lista de enlaces visible: lo que la esconde vive en
        la hoja de estilos, así que si la hoja falta, no esconde nada. Feo, pero navegable.
      */}
      <input
        aria-label="Mostrar u ocultar la navegación"
        className="nav-switch"
        id="nav-switch"
        type="checkbox"
      />
      <label className="nav-toggle" htmlFor="nav-switch">
        <div className="brand">
          <div className="brand-name">{runtimeSpec.app.name}</div>
          <div className="brand-description">{runtimeSpec.app.description}</div>
        </div>
        <span aria-hidden="true" className="nav-toggle-icon" />
      </label>

      <nav className="nav" aria-label="Navegación principal">
        <Link className="nav-link home" href="/">Por dónde empezar</Link>

        {miTrabajo.length > 0 && <div className="nav-section">Mi trabajo</div>}
        {lista(miTrabajo)}

        {operacion.length > 0 && <div className="nav-section">Operación</div>}
        {lista(operacion)}

        {procesos.length > 0 && <div className="nav-section">Procesos</div>}
        {lista(procesos)}

        {datos.length > 0 && (
          <div className="nav-group">
            {/* Una casilla, por lo mismo que la navegación entera: sin CSS, se ve todo. */}
            <input
              aria-label="Mostrar u ocultar los datos"
              className="nav-group-switch"
              defaultChecked={datosAbiertos}
              id="nav-datos"
              type="checkbox"
            />
            <label className="nav-section nav-group-toggle" htmlFor="nav-datos">Datos · {datos.length}</label>
            <div className="nav-group-links">{lista(datos)}</div>
          </div>
        )}

        {sistema.length > 0 && <div className="nav-section">Sistema</div>}
        {lista(sistema)}
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
