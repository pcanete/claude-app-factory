import {
  removeAiCredentialAction,
  saveAiCredentialAction,
  saveAiPreferenceAction,
  saveApplicationSettingsAction,
} from "@/app/settings/actions";
import { getUserAiConfiguration } from "@/features/ai/config";
import { AI_MODEL_CATALOG, PERSONAL_AI_PROVIDERS } from "@/features/settings/catalog";
import { settingsEncryptionConfigured } from "@/features/settings/crypto";
import { getApplicationSettings, getUserAiSettings } from "@/features/settings/store";
import { canManageUsers, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const errorMessages: Record<string, string> = {
  invalid_credential: "La clave no tiene un formato válido.",
  invalid_provider: "El proveedor solicitado no es válido.",
  encryption_unavailable: "El servidor todavía no tiene configurada la clave maestra de cifrado.",
  invalid_application_settings: "Revisá el idioma y la zona horaria.",
};

const successMessages: Record<string, string> = {
  credential: "La credencial fue cifrada y guardada.",
  removed: "La credencial fue eliminada.",
  preference: "Tu modelo preferido fue actualizado.",
  application: "Los ajustes generales fueron actualizados.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await requireUser();
  const requested = await searchParams;
  const [stored, aiConfiguration, applicationSettings] = await Promise.all([
    getUserAiSettings(user.id),
    getUserAiConfiguration(user.id),
    canManageUsers(user) ? getApplicationSettings() : Promise.resolve(null),
  ]);
  const encryptionReady = settingsEncryptionConfigured();
  const selectableModels = aiConfiguration.models.length ? aiConfiguration.models : AI_MODEL_CATALOG;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Preferencias y conexiones</p>
          <h1>Configuración</h1>
          <p className="subtitle">Administrá tus proveedores de IA y los ajustes generales permitidos para tu rol.</p>
        </div>
      </div>
      {requested.error && errorMessages[requested.error] && <div className="notice import-error">{errorMessages[requested.error]}</div>}
      {requested.saved && successMessages[requested.saved] && <div className="notice success">{successMessages[requested.saved]}</div>}
      {!encryptionReady && (
        <div className="notice warning">Las credenciales personales permanecerán deshabilitadas hasta configurar <code>SETTINGS_ENCRYPTION_KEY</code> en el servidor.</div>
      )}

      <section className="settings-section">
        <div className="settings-section-header">
          <div><p className="eyebrow">Mi IA</p><h2>Claves personales</h2></div>
          <p className="subtitle">Cada clave se cifra antes de guardarse y nunca vuelve a mostrarse.</p>
        </div>
        <div className="settings-provider-grid">
          {PERSONAL_AI_PROVIDERS.map((provider) => {
            const connected = stored.connectedProviders.has(provider.key);
            return (
              <article className="form-card settings-provider-card" key={provider.key}>
                <div className="settings-provider-heading">
                  <div><h3>{provider.label}</h3><p className="subtitle">{provider.description}</p></div>
                  <span className={`user-status ${connected ? "on" : "off"}`}>{connected ? "Conectado" : "Sin conectar"}</span>
                </div>
                <form action={saveAiCredentialAction}>
                  <input name="provider" type="hidden" value={provider.key} />
                  <label className="field">
                    <span className="field-label">{connected ? "Reemplazar clave API" : "Clave API"}</span>
                    <input autoComplete="off" className="control" disabled={!encryptionReady} maxLength={512} minLength={20} name="api_key" placeholder={provider.placeholder} required type="password" />
                  </label>
                  <div className="form-actions settings-actions">
                    <button className="button" disabled={!encryptionReady} type="submit">{connected ? "Reemplazar" : "Conectar"}</button>
                  </div>
                </form>
                {connected && (
                  <form action={removeAiCredentialAction}>
                    <input name="provider" type="hidden" value={provider.key} />
                    <button className="button secondary settings-remove" type="submit">Eliminar clave</button>
                  </form>
                )}
              </article>
            );
          })}
        </div>
        <article className="form-card settings-preference-card">
          <h3>Modelo preferido</h3>
          <p className="subtitle">Se usará como primera opción al crear conversaciones nuevas.</p>
          <form action={saveAiPreferenceAction} className="settings-preference-form">
            <select className="control" defaultValue={aiConfiguration.preferredModelId ?? selectableModels[0]?.id} disabled={!aiConfiguration.configured} name="model_id">
              {selectableModels.map((model) => <option key={model.id} value={model.id}>{model.provider} · {model.label}</option>)}
            </select>
            <button className="button" disabled={!aiConfiguration.configured} type="submit">Guardar preferencia</button>
          </form>
        </article>
      </section>

      {applicationSettings && (
        <section className="settings-section">
          <div className="settings-section-header">
            <div><p className="eyebrow">Administración</p><h2>Aplicación</h2></div>
            <p className="subtitle">Esta base genérica alojará también los ajustes de conectores y módulos futuros.</p>
          </div>
          <article className="form-card">
            <form action={saveApplicationSettingsAction}>
              <div className="form-grid">
                <label className="field"><span className="field-label">Idioma</span><input className="control" defaultValue={applicationSettings.locale} name="locale" required /></label>
                <label className="field"><span className="field-label">Zona horaria</span><input className="control" defaultValue={applicationSettings.timezone} name="timezone" required /></label>
              </div>
              <div className="form-actions"><button className="button" type="submit">Guardar ajustes</button></div>
            </form>
          </article>
        </section>
      )}
    </>
  );
}

