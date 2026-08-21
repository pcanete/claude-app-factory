import Link from "next/link";
import { notFound } from "next/navigation";
import { BulkRecordTable } from "@/components/bulk-record-table";
import { Pagination } from "@/components/pagination";
import { RecordFilters } from "@/components/record-filters";
import { RecordTable } from "@/components/record-table";
import { hasPermission, requirePermission } from "@/lib/auth";
import { recordsForClient } from "@/lib/presentation";
import { countFilteredRecords, listRecords } from "@/lib/repository";
import { getEntity, runtimeSpec } from "@/lib/spec";
import { firstParam, parseListQuery, type RawSearchParams } from "@/lib/view-query";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ entity: string }>;
  searchParams: Promise<RawSearchParams>;
};

export default async function EntityListPage({ params, searchParams }: Props) {
  const [{ entity: entityKey }, requested] = await Promise.all([params, searchParams]);
  const entity = getEntity(entityKey);
  if (!entity) notFound();
  const user = await requirePermission(entity.key, "list");
  const canCreate = hasPermission(user, entity.key, "create");
  const canRead = hasPermission(user, entity.key, "read");
  const canUpdate = hasPermission(user, entity.key, "update");
  const imported = firstParam(requested.imported);
  const configuredView = runtimeSpec.views.find(
    (view) => view.entity === entity.key && view.type === "table",
  );
  const configuredFields = configuredView?.fields ?? [];
  const requestedFields = configuredFields.length ? configuredFields : entity.fields.map((field) => field.key);
  const visibleKeys = [entity.title_field, ...requestedFields.filter((key) => key !== entity.title_field)].slice(0, 6);
  const visibleFields = visibleKeys.map((key) => entity.fields.find((field) => field.key === key)).filter((field) => field !== undefined);
  const query = parseListQuery(entity, requested, configuredView);
  let [records, total] = await Promise.all([
    listRecords(entity.key, query),
    countFilteredRecords(entity.key, query),
  ]);
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
  if (page !== query.page) records = await listRecords(entity.key, { ...query, offset: (page - 1) * query.pageSize });
  const bulkFields = (configuredView?.bulk_edit_fields ?? [])
    .map((key) => entity.fields.find((field) => field.key === key))
    .filter((field) => field !== undefined);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Entidad</p>
          <h1>{entity.label_plural}</h1>
          <p className="subtitle">{entity.description ?? `Administrá registros de ${entity.label_plural.toLowerCase()}.`}</p>
        </div>
        <div className="header-actions">
          <a className="button secondary" href={`/records/${entity.key}/export?format=csv`}>Exportar CSV</a>
          <a className="button secondary" href={`/records/${entity.key}/export?format=xlsx`}>Exportar Excel</a>
          {canCreate && <Link className="button secondary" href={`/records/${entity.key}/import`}>Importar</Link>}
          {canCreate && <Link className="button" href={`/records/${entity.key}/new`}>Nuevo {entity.label.toLowerCase()}</Link>}
        </div>
      </div>
      {imported && /^\d+$/.test(imported) && <div className="notice success">Se importaron {imported} registros correctamente.</div>}
      <RecordFilters entity={entity} fields={visibleFields} query={query} resetHref={`/records/${entity.key}`} />
      {configuredView && canUpdate && bulkFields.length ? (
        <BulkRecordTable bulkFields={bulkFields} canRead={canRead} entity={entity} fields={visibleFields} locale={runtimeSpec.app.locale} records={recordsForClient(records)} viewKey={configuredView.key} />
      ) : <RecordTable canRead={canRead} entity={entity} fields={visibleFields} locale={runtimeSpec.app.locale} records={records} />}
      <Pagination baseHref={`/records/${entity.key}`} page={page} pageSize={query.pageSize} query={requested} total={total} />
    </>
  );
}
