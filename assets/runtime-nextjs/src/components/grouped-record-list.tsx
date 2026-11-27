"use client";

import Link from "@/components/enlace";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkSetRecordsAction } from "@/app/record-operations/actions";
import { formatFieldValue } from "@/lib/presentation";
import type { FieldSpec } from "@/lib/spec";

type Grupo = { key: string; label: string; records: Array<Record<string, unknown>> };

/**
 * Una lista agrupada, densa: un encabezado por grupo con cuántos hay, y una fila por
 * registro con el título y los datos al costado.
 *
 * Los campos editables de la vista (`bulk_edit_fields`) se cambian en la misma fila. Cada
 * cambio pasa por la misma acción que la edición masiva, con un solo registro: los mismos
 * permisos, las mismas reglas y la misma auditoría. Si una regla lo frena, el mensaje se ve
 * arriba de la lista y el valor vuelve a como estaba.
 */
export function GroupedRecordList({
  viewKey, entityKey, titleField, groupField, fields, editableFields, groups, canRead, canUpdate, locale,
}: {
  viewKey: string;
  entityKey: string;
  titleField?: FieldSpec;
  groupField: FieldSpec;
  fields: FieldSpec[];
  editableFields: string[];
  groups: Grupo[];
  canRead: boolean;
  canUpdate: boolean;
  locale?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const editable = new Set(canUpdate ? editableFields : []);

  function cambiar(recordId: string, field: FieldSpec, value: string) {
    startTransition(async () => {
      const result = await bulkSetRecordsAction(viewKey, [recordId], field.key, value);
      if (!result.ok) {
        setError(result.error);
        router.refresh();
        return;
      }
      setError("");
      router.refresh();
    });
  }

  function valorEditable(field: FieldSpec, record: Record<string, unknown>) {
    const id = String(record.id);
    const actual = record[field.key] === null || record[field.key] === undefined ? "" : String(record[field.key]);
    const opciones = field.type === "boolean"
      ? [{ key: "true", label: "Sí" }, { key: "false", label: "No" }]
      : field.options ?? [];
    return (
      <select
        aria-label={`${field.label} de ${String(record[titleField?.key ?? "id"] ?? "")}`}
        className="list-select"
        disabled={pending}
        // La `key` con el valor hace que, si una regla frena el cambio y la página se
        // refresca con el valor de antes, el selector vuelva a mostrarlo.
        key={`${id}-${field.key}-${actual}`}
        defaultValue={actual}
        onChange={(event) => cambiar(id, field, event.target.value)}
      >
        {!actual && <option value="">{field.label}…</option>}
        {opciones.map((opcion) => <option key={opcion.key} value={opcion.key}>{opcion.label}</option>)}
      </select>
    );
  }

  if (!groups.length) return <div className="empty">Todavía no hay registros para estos filtros.</div>;

  return (
    <>
      {error && <div aria-live="polite" className="notice rule-blocked">{error}</div>}
      <div aria-busy={pending} className="group-list">
        {groups.map((grupo) => (
          <details className="group-section" key={grupo.key} open>
            <summary className="group-header">
              <span className="group-label">{grupo.label}</span>
              <span className="group-count">{grupo.records.length}</span>
            </summary>
            <ul className="list-rows">
              {grupo.records.map((record) => {
                const id = String(record.id);
                const titulo = titleField ? formatFieldValue(titleField, record[titleField.key], locale) : id;
                return (
                  <li className="list-row" key={id}>
                    {editable.has(groupField.key) && <span className="list-row-group">{valorEditable(groupField, record)}</span>}
                    <span className="list-row-title">
                      {canRead ? <Link className="record-link" href={`/records/${entityKey}/${id}`}>{titulo}</Link> : titulo}
                    </span>
                    <span className="list-row-meta">
                      {fields.map((field) => {
                        if (editable.has(field.key)) return <span className="list-row-field" key={field.key}>{valorEditable(field, record)}</span>;
                        const valor = formatFieldValue(field, record[field.key], locale);
                        if (valor === "—") return null;
                        return <span className="list-row-field" key={field.key} title={field.label}>{valor}</span>;
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>
    </>
  );
}
