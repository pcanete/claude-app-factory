import Link from "next/link";
import { createUserAction } from "@/app/users/actions";
import { isLocalPreviewIdentity, isPendingIdentity, listManagedUsers } from "@/features/users/store";
import { requireUserManagementAccess } from "@/lib/auth";
import { runtimeSpec } from "@/lib/spec";

export const dynamic = "force-dynamic";

const errorMessages: Record<string, string> = {
  invalid_input: "Revisá el nombre, el correo y el rol.",
  email_exists: "Ya existe un usuario con ese correo.",
  not_found: "El usuario solicitado no existe.",
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; error?: string }>;
}) {
  await requireUserManagementAccess();
  const requested = await searchParams;
  const query = requested.q?.trim().slice(0, 120) || undefined;
  const active = requested.status === "active" ? true : requested.status === "inactive" ? false : undefined;
  const [users, allUsers] = await Promise.all([listManagedUsers({ query, active }), listManagedUsers()]);
  const activeCount = allUsers.filter((user) => user.active).length;
  const pendingCount = allUsers.filter((user) => isPendingIdentity(user.authSubject)).length;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Acceso y responsabilidades</p>
          <h1>Usuarios</h1>
          <p className="subtitle">Administrá quién puede entrar y qué rol cumple. Los permisos de cada rol siguen definidos en AppSpec.</p>
        </div>
      </div>
      {requested.error && errorMessages[requested.error] && <div className="notice import-error">{errorMessages[requested.error]}</div>}
      <div className="user-stats">
        <article className="card"><div className="card-label">Usuarios</div><div className="metric">{allUsers.length}</div></article>
        <article className="card"><div className="card-label">Activos</div><div className="metric">{activeCount}</div></article>
        <article className="card"><div className="card-label">Pendientes de vincular</div><div className="metric">{pendingCount}</div></article>
      </div>
      <div className="user-layout">
        <section className="form-card user-create-card">
          <h2>Agregar usuario</h2>
          <p className="subtitle">Quedará pendiente hasta vincular su identidad con el proveedor de acceso elegido.</p>
          <form action={createUserAction}>
            <div className="form-grid user-create-grid">
              <label className="field">
                <span className="field-label">Nombre</span>
                <input className="control" maxLength={120} name="display_name" required />
              </label>
              <label className="field">
                <span className="field-label">Correo</span>
                <input className="control" maxLength={254} name="email" required type="email" />
              </label>
              <label className="field">
                <span className="field-label">Rol</span>
                <select className="control" name="role_key" required>
                  <option value="">Seleccionar rol</option>
                  {runtimeSpec.roles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
                </select>
              </label>
              <label className="checkbox"><input defaultChecked name="active" type="checkbox" /> Activo</label>
            </div>
            <div className="form-actions"><button className="button" type="submit">Crear usuario</button></div>
          </form>
        </section>
        <aside className="card role-card">
          <h2>Roles disponibles</h2>
          <p className="subtitle">Este módulo asigna roles; no modifica sus permisos en tiempo de ejecución.</p>
          <div className="role-list">
            {runtimeSpec.roles.map((role) => <div key={role.key}><strong>{role.label}</strong><code>{role.key}</code></div>)}
          </div>
        </aside>
      </div>
      <form className="toolbar user-toolbar">
        <input className="control search" defaultValue={query ?? ""} name="q" placeholder="Buscar por nombre o correo" />
        <select className="control audit-filter" defaultValue={requested.status ?? ""} name="status">
          <option value="">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
        <button className="button secondary" type="submit">Filtrar</button>
      </form>
      <div className="table-wrap">
        {users.length ? (
          <table className="users-table">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Identidad</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {users.map((user) => {
                const identity = isLocalPreviewIdentity(user.authSubject) ? "Local" : isPendingIdentity(user.authSubject) ? "Pendiente" : "Vinculada";
                return (
                  <tr key={user.id}>
                    <td><strong>{user.displayName}</strong><div className="table-secondary">{user.email}</div></td>
                    <td>{user.roleLabel}</td>
                    <td><span className={`identity-badge ${identity.toLowerCase()}`}>{identity}</span></td>
                    <td><span className={`user-status ${user.active ? "on" : "off"}`}>{user.active ? "Activo" : "Inactivo"}</span></td>
                    <td><Link className="record-link" href={`/users/${user.id}`}>Administrar</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <div className="empty">No hay usuarios que coincidan con el filtro.</div>}
      </div>
    </>
  );
}
