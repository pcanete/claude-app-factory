"use client";

import { useActionState } from "react";
import { deleteSettingAction, saveSettingAction, type SettingsState } from "@/app/settings/actions";

const inicial: SettingsState = {};

type Setting = {
  namespace: string;
  key: string;
  value: unknown;
  updated_at: string;
  updated_by_name: string | null;
};

function comoTexto(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function SettingsEditor({ groups }: { groups: Array<{ namespace: string; items: Setting[] }> }) {
  const [guardado, guardar, guardando] = useActionState(saveSettingAction, inicial);
  const [borrado, borrar, borrando] = useActionState(deleteSettingAction, inicial);
  const estado = guardado.error || guardado.ok ? guardado : borrado;

  return (
    <>
      {estado.error && <div className="notice error">{estado.error}</div>}
      {estado.ok && <div className="notice success">{estado.ok}</div>}

      <section className="form-card">
        <h2>Nueva opción</h2>
        <p className="subtitle">
          Guardar sobre un espacio y clave que ya existen reemplaza el valor anterior.
        </p>
        <form action={guardar} className="settings-form">
          <label className="field">
            <span className="field-label">Espacio</span>
            <input className="control" name="namespace" placeholder="por ejemplo: integraciones" required />
          </label>
          <label className="field">
            <span className="field-label">Clave</span>
            <input className="control" name="key" placeholder="por ejemplo: horario_resumen" required />
          </label>
          <label className="field settings-value">
            <span className="field-label">Valor</span>
            <textarea className="control" name="value" placeholder='42, "texto", [1,2] o {"a":true}' required rows={3} />
          </label>
          <button className="button" disabled={guardando} type="submit">
            {guardando ? "Guardando…" : "Guardar opción"}
          </button>
        </form>
      </section>

      {groups.length === 0 ? (
        <div className="empty-state">Todavía no hay opciones guardadas.</div>
      ) : (
        groups.map((group) => (
          <section key={group.namespace}>
            <h2>{group.namespace}</h2>
            <table className="record-table">
              <thead>
                <tr>
                  <th>Clave</th>
                  <th>Valor</th>
                  <th>Última modificación</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {group.items.map((setting) => (
                  <tr key={`${setting.namespace}.${setting.key}`}>
                    <td><code>{setting.key}</code></td>
                    <td><pre className="setting-value">{comoTexto(setting.value)}</pre></td>
                    <td>
                      {new Date(setting.updated_at).toLocaleString()}
                      {setting.updated_by_name ? ` · ${setting.updated_by_name}` : ""}
                    </td>
                    <td>
                      <form action={borrar}>
                        <input name="namespace" type="hidden" value={setting.namespace} />
                        <input name="key" type="hidden" value={setting.key} />
                        <button className="button secondary" disabled={borrando} type="submit">Eliminar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </>
  );
}
