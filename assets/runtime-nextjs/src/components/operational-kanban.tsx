"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveRecordAction } from "@/app/record-operations/actions";
import { formatFieldValue, formatValue } from "@/lib/presentation";
import type { FieldSpec } from "@/lib/spec";

type KanbanColumn = { key: string; label: string; records: Array<Record<string, unknown>> };

export function OperationalKanban({
  viewKey, entityKey, titleField, groupField, cardFields, initialColumns, moveOptions, locale, canRead, canMove,
}: {
  viewKey: string;
  entityKey: string;
  titleField?: FieldSpec;
  groupField: FieldSpec;
  cardFields: FieldSpec[];
  initialColumns: KanbanColumn[];
  moveOptions: Array<{ key: string; label: string }>;
  locale?: string;
  canRead: boolean;
  canMove: boolean;
}) {
  const router = useRouter();
  const [columns, setColumns] = useState(initialColumns);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function move(recordId: string, targetKey: string) {
    const source = columns.find((column) => column.records.some((record) => String(record.id) === recordId));
    if (!canMove || !source || source.key === targetKey) return;
    startTransition(async () => {
      const result = await moveRecordAction(viewKey, recordId, targetKey);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const record = source.records.find((candidate) => String(candidate.id) === recordId);
      if (!record) return;
      setError("");
      setColumns((current) => current.map((column) => ({
        ...column,
        records: column.key === source.key
          ? column.records.filter((candidate) => String(candidate.id) !== recordId)
          : column.key === targetKey ? [...column.records, { ...record, [groupField.key]: targetKey }] : column.records,
      })));
      router.refresh();
    });
  }

  return (
    <>
      {canMove && <p className="operation-hint">Arrastrá una tarjeta a otra columna o usá el selector de estado.</p>}
      {error && <div aria-live="polite" className="notice import-error">{error}</div>}
      <div aria-busy={pending} aria-label="Tablero" className="kanban-board">
        {columns.map((column) => (
          <section className="kanban-column" key={column.key} onDragOver={(event) => canMove && column.key !== "__empty" && event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (column.key !== "__empty") move(event.dataTransfer.getData("text/plain"), column.key); }}>
            <div className="kanban-column-header"><h2>{column.label}</h2><span>{column.records.length}</span></div>
            <div className="kanban-cards">
              {column.records.map((record) => {
                const id = String(record.id);
                const title = titleField ? formatFieldValue(titleField, record[titleField.key], locale) : formatValue(record.id, locale);
                return (
                  <article className="kanban-card" draggable={canMove && !pending} key={id} onDragStart={(event) => event.dataTransfer.setData("text/plain", id)}>
                    {canRead ? <Link className="record-link" href={`/records/${entityKey}/${id}`}>{title}</Link> : <strong>{title}</strong>}
                    {cardFields.map((field) => <div className="kanban-field" key={field.key}><span>{field.label}</span>{formatFieldValue(field, record[field.key], locale)}</div>)}
                    {canMove && (
                      <label className="kanban-move-control">
                        <span className="sr-only">Mover {title}</span>
                        <select aria-label={`Mover ${title}`} className="control" disabled={pending} onChange={(event) => move(id, event.target.value)} value={column.key}>
                          {column.key === "__empty" && <option disabled value="__empty">Sin estado</option>}
                          {moveOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                        </select>
                      </label>
                    )}
                  </article>
                );
              })}
              {!column.records.length && <div className="empty compact">Sin registros</div>}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
