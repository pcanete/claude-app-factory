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

  function cambiar(recordId: string, field: FieldSpec, select: HTMLSelectElement, anterior: string) {
    const value = select.value;
    startTransition(async () => {
      const result = await bulkSetRecordsAction(viewKey, [recordId], field.key, value);
      if (!result.ok) {
        // El valor guardado no cambió, así que la página refrescada trae el mismo y React no
        // vuelve a montar el selector: hay que devolverlo a mano, o queda mostrando un valor
        // que la regla rechazó.
        select.value = anterior;
        setError(result.error);
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
        className={`list-select${actual ? "" : " empty"}`}
        disabled={pending}
        // La `key` con el valor vuelve a montar el selector cuando el valor guardado cambia
        // (por ejemplo, desde otra pestaña).
        key={`${id}-${field.key}-${actual}`}
        defaultValue={actual}
        onChange={(event) => cambiar(id, field, event.currentTarget, actual)}
        title={field.label}
      >
        {!actual && <option value="">—</option>}
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
                        // Un dato vacío deja su lugar vacío: si desaparece, las columnas de esa
                        // fila se corren y dejan de alinearse con las de las otras.
                        const valor = formatFieldValue(field, record[field.key], locale);
                        return <span className="list-row-field" key={field.key} title={field.label}>{valor === "—" ? "" : valor}</span>;
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
