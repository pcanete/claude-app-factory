import Link from "next/link";
import { notFound } from "next/navigation";
import { confirmImportAction } from "@/app/records/[entity]/import/actions";
import { ImportUploadForm } from "@/components/import-upload-form";
import { requirePermission } from "@/lib/auth";
import { IMPORT_PREVIEW_ROWS, importColumns } from "@/lib/data-transfer";
import { getImportBatch } from "@/lib/import-batches";
import { formatValue } from "@/lib/presentation";
import { getEntity, runtimeSpec } from "@/lib/spec";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ entity: string }>;
  searchParams: Promise<{ batch?: string; error?: string }>;
};

export default async function ImportPage({ params, searchParams }: Props) {
  const [{ entity: entityKey }, query] = await Promise.all([params, searchParams]);
  const entity = getEntity(entityKey);
  if (!entity) notFound();
  const user = await requirePermission(entity.key, "create");
  const batch = query.batch ? await getImportBatch(query.batch, user.id, entity.key) : null;
  const columns = importColumns(entity);
  const appliedRuleCount = batch?.rows.reduce((total, row) => total + (row.rules?.length ?? 0), 0) ?? 0;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Importación</p>
          <h1>Importar {entity.label_plural.toLowerCase()}</h1>
          <p className="subtitle">Creá registros desde una planilla. Primero validamos todo; la base sólo cambia cuando confirmás.</p>
        </div>
        <Link className="button secondary" href={`/records/${entity.key}`}>Volver</Link>
      </div>

      {!batch && (
        <>
          <div className="import-guide">
            <div className="card">
              <h2>1. Descargá una plantilla</h2>
              <p className="subtitle">Excel incluye un diccionario de campos. No cambies los encabezados técnicos.</p>
              <div className="form-actions compact">
                <a className="button secondary" href={`/records/${entity.key}/export?format=xlsx&template=1`}>Plantilla Excel</a>
                <a className="button secondary" href={`/records/${entity.key}/export?format=csv&template=1`}>Plantilla CSV</a>
              </div>
            </div>
            <div className="card">
              <h2>2. Validá antes de guardar</h2>
              <p className="subtitle">Las relaciones aceptan el ID o el nombre exacto. Esta versión sólo crea registros nuevos.</p>
            </div>
          </div>
          <ImportUploadForm entityKey={entity.key} />
          {query.batch && <div className="notice warning">La vista previa no existe, venció o pertenece a otra sesión.</div>}
        </>
      )}

      {batch && (
        <>
          {query.error === "commit" && <div className="notice import-error">No se importó ninguna fila. Los datos cambiaron después de la validación o la vista previa ya fue utilizada.</div>}
          <div className="notice success">Archivo validado: <strong>{batch.file_name}</strong> · {batch.row_count} filas listas.</div>
          {appliedRuleCount > 0 && <div className="notice rules-applied">La vista previa incluye {appliedRuleCount} aplicaciones automáticas de reglas.</div>}
          <div className="table-wrap import-preview">
            <table>
              <thead><tr><th>Fila</th>{columns.map((column) => <th key={column.key}>{column.label}<span className="table-secondary">{column.key}</span></th>)}<th>Reglas</th></tr></thead>
              <tbody>
                {batch.rows.slice(0, IMPORT_PREVIEW_ROWS).map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    {columns.map((column) => <td key={column.key}>{formatValue(row.values[column.key], runtimeSpec.app.locale)}</td>)}
                    <td>{row.rules?.length ? row.rules.map((rule) => rule.label).join(", ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {batch.row_count > IMPORT_PREVIEW_ROWS && <p className="subtitle import-preview-note">Vista previa de las primeras {IMPORT_PREVIEW_ROWS} filas.</p>}
          <div className="form-actions import-confirm-actions">
            {batch.status === "ready" ? (
              <form action={confirmImportAction.bind(null, entity.key, batch.id)}>
                <button className="button" type="submit">Importar {batch.row_count} registros</button>
              </form>
            ) : <span className="notice success">Este lote ya fue importado.</span>}
            <Link className="button secondary" href={`/records/${entity.key}/import`}>Elegir otro archivo</Link>
          </div>
        </>
      )}
    </>
  );
}
