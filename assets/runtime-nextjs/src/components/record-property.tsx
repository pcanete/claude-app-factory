"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecordFieldAction } from "@/app/record-operations/actions";
import type { FieldSpec } from "@/lib/spec";

/**
 * Una propiedad de opciones o de sí o no que se cambia en la ficha, sin abrir el
 * formulario. Si una regla frena el cambio, el selector vuelve al valor guardado y el
 * mensaje queda debajo.
 */
export function RecordProperty({ entityKey, recordId, field, value }: {
  entityKey: string;
  recordId: string;
  field: FieldSpec;
  value: unknown;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const actual = value === null || value === undefined ? "" : String(value);
  const opciones = field.type === "boolean"
    ? [{ key: "true", label: "Sí" }, { key: "false", label: "No" }]
    : field.options ?? [];

  function cambiar(select: HTMLSelectElement) {
    const nuevo = select.value;
    startTransition(async () => {
      const result = await setRecordFieldAction(entityKey, recordId, field.key, nuevo);
      if (!result.ok) {
        select.value = actual;
        setError(result.error);
        return;
      }
      setError("");
      router.refresh();
    });
  }

  return (
    <>
      <select
        aria-label={field.label}
        className={`list-select property-select${actual ? "" : " empty"}`}
        defaultValue={actual}
        disabled={pending}
        key={actual}
        onChange={(event) => cambiar(event.currentTarget)}
      >
        {(!actual || !field.required) && <option value="">—</option>}
        {opciones.map((opcion) => <option key={opcion.key} value={opcion.key}>{opcion.label}</option>)}
      </select>
      {error && <div aria-live="polite" className="property-error">{error}</div>}
    </>
  );
}
