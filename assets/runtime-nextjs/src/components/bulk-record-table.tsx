"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkSetRecordsAction } from "@/app/record-operations/actions";
import { formatDateTimeValue, formatFieldValue, formatValue } from "@/lib/presentation";
import type { EntitySpec, FieldSpec } from "@/lib/spec";

export function BulkRecordTable({
  entity,
  fields,
  records,
  bulkFields,
  canRead,
  locale,
  viewKey,
}: {
  entity: EntitySpec;
  fields: FieldSpec[];
  records: Array<Record<string, unknown>>;
  bulkFields: FieldSpec[];
  canRead: boolean;
  locale?: string;
  viewKey: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [fieldKey, setFieldKey] = useState(bulkFields[0]?.key ?? "");
  const [rawValue, setRawValue] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const operationField = bulkFields.find((field) => field.key === fieldKey) ?? bulkFields[0];
  const valueOptions = useMemo(() => operationField?.type === "boolean"
    ? [{ key: "true", label: "Sí" }, { key: "false", label: "No" }]
    : operationField?.options ?? [], [operationField]);
  const pageIds = records.map((record) => String(record.id));
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));

  function togglePage() {
    setSelected((current) => allSelected ? current.filter((id) => !pageIds.includes(id)) : [...new Set([...current, ...pageIds])]);
  }

  function applyBulk() {
    if (!selected.length || !operationField || !rawValue) {
      setMessage({ kind: "error", text: "Seleccioná registros, un campo y un valor." });
      return;
    }
    startTransition(async () => {
      const result = await bulkSetRecordsAction(viewKey, selected, operationField.key, rawValue);
      if (result.ok) {
        setMessage({ kind: "success", text: `${result.updated} registro${result.updated === 1 ? "" : "s"} actualizado${result.updated === 1 ? "" : "s"}.` });
        setSelected([]);
        router.refresh();
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  }

  return (
    <div className="bulk-table">
      <div className="bulk-toolbar">
        <strong>{selected.length} seleccionado{selected.length === 1 ? "" : "s"}</strong>
        <select aria-label="Campo para editar" className="control" disabled={pending} onChange={(event) => { setFieldKey(event.target.value); setRawValue(""); }} value={operationField?.key ?? ""}>
          {bulkFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
        </select>
        <select aria-label="Nuevo valor" className="control" disabled={pending} onChange={(event) => setRawValue(event.target.value)} value={rawValue}>
          <option value="">Elegir valor…</option>
          {valueOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
        <button className="button" disabled={pending || !selected.length || !rawValue} onClick={applyBulk} type="button">{pending ? "Aplicando…" : "Aplicar al lote"}</button>
      </div>
      {message && <div aria-live="polite" className={`notice ${message.kind === "success" ? "success" : "import-error"}`}>{message.text}</div>}
      <div className="table-wrap">
        {records.length ? (
          <table>
            <thead>
              <tr>
                <th className="selection-cell"><input aria-label="Seleccionar esta página" checked={allSelected} onChange={togglePage} type="checkbox" /></th>
                {fields.map((field) => <th key={field.key}>{field.label}</th>)}
                <th>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const id = String(record.id);
                return (
                  <tr key={id}>
                    <td className="selection-cell"><input aria-label={`Seleccionar ${formatValue(record[entity.title_field], locale)}`} checked={selected.includes(id)} onChange={() => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])} type="checkbox" /></td>
                    {fields.map((field) => (
                      <td key={field.key}>
                        {field.key === entity.title_field && canRead ? <Link className="record-link" href={`/records/${entity.key}/${id}`}>{formatFieldValue(field, record[field.key], locale)}</Link> : formatFieldValue(field, record[field.key], locale)}
                      </td>
                    ))}
                    <td>{formatDateTimeValue(record.updated_at, locale)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <div className="empty">Todavía no hay registros para estos filtros.</div>}
      </div>
    </div>
  );
}
