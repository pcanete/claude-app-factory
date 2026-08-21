import Link from "next/link";
import type { ListRecordOptions } from "@/lib/repository";
import type { EntitySpec, FieldSpec } from "@/lib/spec";

function FilterControl({ field, value }: { field: FieldSpec; value: string }) {
  if (field.type === "enum") {
    return (
      <select className="control" defaultValue={value} name={`f_${field.key}`}>
        <option value="">Todos</option>
        {(field.options ?? []).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
    );
  }
  if (field.type === "boolean") {
    return (
      <select className="control" defaultValue={value} name={`f_${field.key}`}>
        <option value="">Todos</option>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
    );
  }
  const type = field.type === "date" || field.type === "datetime"
    ? "date"
    : field.type === "integer" || field.type === "decimal" ? "number" : "text";
  return <input className="control" defaultValue={value} name={`f_${field.key}`} placeholder="Cualquier valor" step={field.type === "decimal" ? "any" : undefined} type={type} />;
}

export function RecordFilters({
  entity,
  fields,
  query,
  resetHref,
}: {
  entity: EntitySpec;
  fields: FieldSpec[];
  query: ListRecordOptions & { filters: Record<string, string> };
  resetHref: string;
}) {
  const searchable = entity.fields.some((field) => field.searchable);
  const sortable = [...fields, ...entity.fields.filter((field) => !fields.some((visible) => visible.key === field.key))];
  return (
    <form className="filter-panel">
      <div className="filter-primary">
        {searchable && <input className="control search" defaultValue={query.search} name="q" placeholder="Buscar en campos indexados…" type="search" />}
        <select aria-label="Ordenar por" className="control sort-control" defaultValue={query.sort ?? "updated_at"} name="sort">
          <option value="updated_at">Última modificación</option>
          <option value="created_at">Fecha de creación</option>
          {sortable.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
        </select>
        <select aria-label="Dirección" className="control direction-control" defaultValue={query.direction ?? "desc"} name="direction">
          <option value="desc">Descendente</option>
          <option value="asc">Ascendente</option>
        </select>
        <button className="button" type="submit">Aplicar</button>
        <Link className="button secondary" href={resetHref}>Limpiar</Link>
      </div>
      <details className="filter-details" open={Object.keys(query.filters).length > 0}>
        <summary>Filtros por campo{Object.keys(query.filters).length ? ` · ${Object.keys(query.filters).length} activos` : ""}</summary>
        <div className="filter-grid">
          {fields.map((field) => (
            <label className="field" key={field.key}>
              <span className="field-label">{field.label}</span>
              <FilterControl field={field} value={query.filters[field.key] ?? ""} />
            </label>
          ))}
        </div>
      </details>
    </form>
  );
}
