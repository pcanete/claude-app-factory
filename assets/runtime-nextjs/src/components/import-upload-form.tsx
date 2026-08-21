"use client";

import { useActionState } from "react";
import { previewImportAction } from "@/app/records/[entity]/import/actions";

export function ImportUploadForm({ entityKey }: { entityKey: string }) {
  const [state, action, pending] = useActionState(
    previewImportAction.bind(null, entityKey),
    { issues: [] },
  );
  return (
    <form action={action} className="form-card import-upload-form">
      <label className="field full">
        <span className="field-label">Archivo</span>
        <input
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="control"
          name="file"
          required
          type="file"
        />
        <span className="field-help">CSV o XLSX · hasta 5 MB y 1.000 filas.</span>
      </label>
      {state.issues.length > 0 && (
        <div aria-live="polite" className="import-issues">
          <strong>No se puede importar todavía</strong>
          <ul>
            {state.issues.map((issue, index) => (
              <li key={`${issue.row}-${issue.column}-${index}`}>
                {issue.row ? `Fila ${issue.row}` : "Archivo"}{issue.column ? ` · ${issue.column}` : ""}: {issue.message}
              </li>
            ))}
          </ul>
          {state.issues.length === 100 && <p>Se muestran los primeros 100 errores.</p>}
        </div>
      )}
      <div className="form-actions">
        <button className="button" disabled={pending} type="submit">{pending ? "Validando…" : "Validar archivo"}</button>
      </div>
    </form>
  );
}
