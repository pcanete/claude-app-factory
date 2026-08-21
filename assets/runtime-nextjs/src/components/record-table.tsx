import Link from "next/link";
import { formatFieldValue, formatValue } from "@/lib/presentation";
import type { EntitySpec, FieldSpec } from "@/lib/spec";

export function RecordTable({
  entity,
  fields,
  records,
  canRead,
  locale,
}: {
  entity: EntitySpec;
  fields: FieldSpec[];
  records: Array<Record<string, unknown>>;
  canRead: boolean;
  locale?: string;
}) {
  return (
    <div className="table-wrap">
      {records.length ? (
        <table>
          <thead>
            <tr>
              {fields.map((field) => <th key={field.key}>{field.label}</th>)}
              <th>Actualizado</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={String(record.id)}>
                {fields.map((field) => (
                  <td key={field.key}>
                    {field.key === entity.title_field && canRead ? (
                      <Link className="record-link" href={`/records/${entity.key}/${record.id}`}>
                        {formatFieldValue(field, record[field.key], locale)}
                      </Link>
                    ) : formatFieldValue(field, record[field.key], locale)}
                  </td>
                ))}
                <td>{formatValue(record.updated_at, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="empty">Todavía no hay registros para estos filtros.</div>}
    </div>
  );
}
