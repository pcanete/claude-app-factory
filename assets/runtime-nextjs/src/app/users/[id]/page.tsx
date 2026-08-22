import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteUserAction, sendUserInvitationAction, updateUserAction } from "@/app/users/actions";
import { clerkAuthConfigured } from "@/platform/auth/config";
import { getManagedUser, isLocalPreviewIdentity, isManagedUserId, isPendingIdentity } from "@/platform/users/store";
import { requireUserManagementAccess } from "@/lib/auth";
import { runtimeSpec } from "@/lib/spec";

export const dynamic = "force-dynamic";

const messages: Record<string, string> = {
  invalid_input: "Revisá el nombre, el correo y el rol.",
  email_exists: "Ya existe otro usuario con ese correo.",
  local_identity: "Las identidades de vista local se administran automáticamente.",
  self_protection: "No podés desactivar tu propia cuenta ni quitarte el rol actual.",
  inactive_invitation: "Activá el usuario antes de enviarle una invitación.",
  already_linked: "La identidad de este usuario ya está vinculada.",
  con_historial: "Esta persona ya operó en el sistema. Eliminarla dejaría su actividad sin autor en la auditoría: desactivala y conserva el historial.",
};

const invitationMessages: Record<string, string> = {
  sent: "La invitación de acceso fue enviada por correo.",
  failed: "El usuario quedó guardado, pero Clerk no pudo enviar la invitación. Podés reintentarla.",
  not_configured: "El usuario quedó guardado. Configurá Clerk para poder enviar la invitación.",
};

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; invitation?: string }>;
}) {
  const actor = await requireUserManagementAccess();
  const { id } = await params;
  if (!isManagedUserId(id)) notFound();
  const [user, requested] = await Promise.all([getManagedUser(id), searchParams]);
  if (!user) notFound();
  const local = isLocalPreviewIdentity(user.authSubject);
  const self = actor.id === user.id;
  const pending = isPendingIdentity(user.authSubject);
  const identityLabel = local ? "Vista local" : pending ? "Pendiente de vincular" : "Vinculada";
  const action = updateUserAction.bind(null, user.id);
  const inviteAction = sendUserInvitationAction.bind(null, user.id);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Gestión de usuario</p>
          <h1>{user.displayName}</h1>
          <p className="subtitle">{user.email}</p>
        </div>
        <Link className="button secondary" href="/users">Volver a usuarios</Link>
      </div>
      {requested.saved && <div className="notice success">Los cambios quedaron guardados y auditados.</div>}
      {requested.invitation && invitationMessages[requested.invitation] && (
        <div className={`notice ${requested.invitation === "sent" ? "success" : "warning"}`}>
          {invitationMessages[requested.invitation]}
        </div>
      )}
      {requested.error && messages[requested.error] && <div className="notice import-error">{messages[requested.error]}</div>}
      {local && <div className="notice warning">Esta cuenta pertenece a la vista local y se sincroniza automáticamente desde el selector de roles.</div>}
      {self && !local && <div className="notice">Tu rol y tu acceso activo están protegidos para evitar que te bloquees a vos mismo.</div>}
      <div className="user-layout">
        <section className="form-card">
          <form action={action}>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Nombre</span>
                <input className="control" defaultValue={user.displayName} disabled={local} maxLength={120} name="display_name" required />
              </label>
              <label className="field">
                <span className="field-label">Correo</span>
                <input className="control" defaultValue={user.email} disabled={local} maxLength={254} name="email" required type="email" />
              </label>
              <label className="field">
                <span className="field-label">Rol</span>
                <select className="control" defaultValue={user.roleKey} disabled={local || self} name="role_key">
                  {runtimeSpec.roles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
                </select>
                {(local || self) && <input name="role_key" type="hidden" value={user.roleKey} />}
              </label>
              <label className="checkbox">
                <input defaultChecked={user.active} disabled={local || self} name="active" type="checkbox" /> Activo
                {(local || self) && user.active && <input name="active" type="hidden" value="on" />}
              </label>
            </div>
            <div className="form-actions"><button className="button" disabled={local} type="submit">Guardar cambios</button></div>
          </form>

          {/* Eliminar es para un alta equivocada, no para dar de baja a alguien: quien ya
              trabajó se desactiva arriba y conserva su rastro. La acción se ofrece siempre
              y la respuesta explica cuándo no corresponde, en vez de esconder el botón y
              dejar a la persona adivinando por qué no está. */}
          <form action={deleteUserAction} className="form-actions compact">
            <input name="id" type="hidden" value={user.id} />
            <button className="text-button danger-text" disabled={local || self} type="submit">
              Eliminar del sistema
            </button>
            <span className="field-help">
              Sólo se puede eliminar a quien todavía no registró actividad.
            </span>
          </form>
        </section>
        <aside className="detail-list user-detail-meta">
          <div className="detail-item"><div className="detail-key">Identidad</div><div className="detail-value">{identityLabel}</div></div>
          <div className="detail-item"><div className="detail-key">Estado</div><div className="detail-value">{user.active ? "Activo" : "Inactivo"}</div></div>
          <div className="detail-item"><div className="detail-key">Creado</div><div className="detail-value">{user.createdAt.toLocaleString(runtimeSpec.app.locale)}</div></div>
          <div className="detail-item"><div className="detail-key">Actualizado</div><div className="detail-value">{user.updatedAt.toLocaleString(runtimeSpec.app.locale)}</div></div>
          <div className="detail-item full"><div className="detail-key">ID interno</div><div className="detail-value"><code>{user.id}</code></div></div>
          {pending && !local && clerkAuthConfigured() && (
            <div className="detail-item full">
              <div className="detail-key">Invitación</div>
              <form action={inviteAction}>
                <button className="button secondary" disabled={!user.active} type="submit">Enviar invitación</button>
              </form>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
