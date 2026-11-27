import Link from "@/components/enlace";
import { clearDevelopmentRoleAction } from "@/app/dev-access/actions";
import { SessionSignOut } from "@/components/session-sign-out";
import { clerkAuthConfigured } from "@/platform/auth/config";
import { canManageUsers, canViewAudit, canViewRules, getCurrentUser, hasPermission, hasViewAccess } from "@/lib/auth";
import { localPreviewAuthEnabled } from "@/lib/runtime-access";
import { getEntity, runtimeSpec } from "@/lib/spec";
import { agruparVistas } from "@/lib/view-groups";
import { Icono } from "@/components/icono";
import { motorDisponible } from "@/platform/processes/engine";

/** Las entidades del motor de procesos: se ven desde la página de cada proceso, no desde el menú. */
const ENTIDADES_DE_PROCESO = new Set(["proceso", "iteracion"]);

type Enlace = { key: string; label: string; href: string; icon?: string };

/**
 * El menú se ordena por lo que la persona viene a hacer, no por el tipo de dato.
 *
 * Antes eran tres listas —entidades, vistas, sistema— y lo mismo aparecía dos veces con
 * otro nombre: «Instancias» y «Procesos en curso» llevaban a los mismos casos. Ahora:
 *
 *   Trabajo      los procesos, si la aplicación los tiene
 *   Operación    una entrada por entidad con vistas (sus vistas son pestañas) y las vistas
 *                que no son de una entidad, como un panorama
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
  const entidades = runtimeSpec.entities
    .filter((entity) => user && hasPermission(user, entity.key, "list"))
    .filter((entity) => !entidadesConVista.has(entity.key));
  const enlaceDeEntidad = (entity: (typeof entidades)[number]): Enlace => ({ key: `entity:${entity.key}`, label: entity.label_plural, href: `/records/${entity.key}`, icon: entity.icon });

  // Procesos e iteraciones se ven desde la página de cada proceso: en el menú, una entrada.
  const miTrabajo: Enlace[] = [
    ...(motor && user && hasPermission(user, "proceso", "list") ? [{ key: "familias", label: "Procesos", href: "/procesos", icon: "layers" }] : []),
  ];
  // Una entrada por entidad, no por vista: la tabla, la agenda y el tablero de los mismos
  // compromisos son una sola cosa vista de tres maneras, y adentro se eligen por pestaña.
  const operacion = agruparVistas(vistas.filter((view) => !deProceso(view.entity)), (clave) => getEntity(clave)?.label_plural)
    .map((grupo): Enlace => ({
      key: grupo.key,
      label: grupo.label,
      href: grupo.href,
      // Una entidad lleva el ícono que declara; una vista suelta (un panorama), el suyo.
      icon: grupo.entity
        ? getEntity(grupo.entity)?.icon
        : vistas.find((vista) => `vista:${vista.key}` === grupo.key)?.icon ?? "chart",
    }));
  const datos = entidades.filter((entity) => !deProceso(entity.key)).map(enlaceDeEntidad);
  const sistema: Enlace[] = [
    ...(user && canManageUsers(user) ? [{ key: "users", label: "Usuarios", href: "/users", icon: "user" }] : []),
    ...(user && canViewAudit(user) ? [{ key: "agents", label: "Agentes", href: "/agents", icon: "bot" }] : []),
    ...(user && canViewAudit(user) ? [{ key: "audit", label: "Actividad", href: "/audit", icon: "clock" }] : []),
    ...(user && canViewRules(user) ? [{ key: "rules", label: "Reglas", href: "/rules", icon: "shield" }] : []),
    ...(user ? [{ key: "settings", label: "Configuración", href: "/settings", icon: "sliders" }] : []),
  ];
  // Sin vistas de dominio, los datos son lo único que hay para hacer: van abiertos.
  const datosAbiertos = operacion.length === 0;
  // Sin precarga (ver components/enlace): con ella, cada visita renderizaba en el servidor
  // todos los destinos del menú, una docena de páginas dinámicas, aunque nadie hiciera clic.
  const lista = (enlaces: Enlace[]) => enlaces.map((link) => (
    <Link className="nav-link" href={link.href} key={link.key}><Icono nombre={link.icon} /><span>{link.label}</span></Link>
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
        <Link className="nav-link home" href="/"><Icono nombre="compass" /><span>Por dónde empezar</span></Link>

        {miTrabajo.length > 0 && <div className="nav-section">Trabajo</div>}
        {lista(miTrabajo)}

        {operacion.length > 0 && <div className="nav-section">Operación</div>}
        {lista(operacion)}


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
