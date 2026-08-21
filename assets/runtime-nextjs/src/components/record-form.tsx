import Link from "next/link";
import { createRecordAction, updateRecordAction } from "@/app/actions";
import type { EntitySpec, FieldSpec } from "@/lib/spec";

type Props = {
  entity: EntitySpec;
  record?: Record<string, unknown>;
  relationshipOptions: Record<string, Array<{ id: string; label: string }>>;
};

function inputValue(field: FieldSpec, value: unknown) {
  if (value === null || value === undefined) return "";
  if (field.type === "datetime") {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.valueOf()) ? "" : date.toISOString().slice(0, 16);
  }
  if (field.type === "date") {
    const text = value instanceof Date ? value.toISOString() : String(value);
    return text.slice(0, 10);
  }
  if (field.type === "json" || field.type === "file") return JSON.stringify(value, null, 2);
  return String(value);
}

function FieldControl({ field, value }: { field: FieldSpec; value: unknown }) {
  if (field.type === "boolean") {
    return (
      <label className="checkbox">
        <input defaultChecked={Boolean(value ?? field.default)} id={field.key} name={field.key} type="checkbox" />
        <span>Sí</span>
      </label>
    );
  }
  if (field.type === "enum") {
    return (
      <select className="control" defaultValue={inputValue(field, value ?? field.default)} id={field.key} name={field.key} required={field.required}>
        {!field.required && <option value="">Sin valor</option>}
        {(field.options ?? []).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
    );
  }
  if (field.type === "long_text" || field.type === "json" || field.type === "file") {
    return <textarea className="control" defaultValue={inputValue(field, value)} id={field.key} name={field.key} required={field.required} />;
  }
  const type = {
    integer: "number",
    decimal: "number",
    date: "date",
    datetime: "datetime-local",
    email: "email",
    url: "url",
    text: "text",
  }[field.type] ?? "text";
  return (
    <input
      className="control"
      defaultValue={inputValue(field, value ?? field.default)}
      id={field.key}
      name={field.key}
      required={field.required}
      step={field.type === "decimal" ? "any" : undefined}
      type={type}
    />
  );
}

export function RecordForm({ entity, record, relationshipOptions }: Props) {
  const isEditing = Boolean(record?.id);
  const action = isEditing
    ? updateRecordAction.bind(null, entity.key, String(record?.id))
    : createRecordAction.bind(null, entity.key);
  const relationships = (entity.relationships ?? []).filter((relationship) => relationship.type === "belongs_to");

  return (
    <form action={action} className="form-card">
      <div className="form-grid">
        {entity.fields.map((field) => (
          <div className={`field ${["long_text", "json", "file"].includes(field.type) ? "full" : ""}`} key={field.key}>
            <label className="field-label" htmlFor={field.key}>{field.label}{field.required ? " *" : ""}</label>
            <FieldControl field={field} value={record?.[field.key]} />
            {field.help && <span className="field-help">{field.help}</span>}
            {field.type === "file" && <span className="field-help">Campo legado de metadatos JSON. Para archivos reales usá el panel de adjuntos de la ficha.</span>}
          </div>
        ))}
        {relationships.map((relationship) => (
          <div className="field" key={relationship.key}>
            <label className="field-label" htmlFor={relationship.key}>{relationship.label}{relationship.required ? " *" : ""}</label>
            <select
              className="control"
              defaultValue={String(record?.[`${relationship.key}_id`] ?? "")}
              id={relationship.key}
              name={relationship.key}
              required={relationship.required}
            >
              {!relationship.required && <option value="">Sin asignar</option>}
              {(relationshipOptions[relationship.key] ?? []).map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="form-actions">
        <button className="button" type="submit">{isEditing ? "Guardar cambios" : "Crear registro"}</button>
        <Link className="button secondary" href={`/records/${entity.key}`}>Cancelar</Link>
      </div>
    </form>
  );
}
