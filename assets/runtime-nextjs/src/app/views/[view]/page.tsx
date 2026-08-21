import Link from "next/link";
import { notFound } from "next/navigation";
import { BulkRecordTable } from "@/components/bulk-record-table";
import { OperationalCalendar } from "@/components/operational-calendar";
import { OperationalKanban } from "@/components/operational-kanban";
import { Pagination } from "@/components/pagination";
import { RecordFilters } from "@/components/record-filters";
import { RecordTable } from "@/components/record-table";
import { hasPermission, requireViewAccess } from "@/lib/auth";
import { recordsForClient } from "@/lib/presentation";
import { aggregateRecords, breakdownRecords, calendarRecords, countFilteredRecords, listRecords } from "@/lib/repository";
import { getEntity, getView, type DashboardWidgetSpec, type EntitySpec, type ViewSpec, runtimeSpec } from "@/lib/spec";
import { firstParam, parseListQuery, type RawSearchParams } from "@/lib/view-query";

export const dynamic = "force-dynamic";

function visibleFields(entity: EntitySpec, view: ViewSpec, maximum = 6) {
  const requested = view.fields?.length ? view.fields : entity.fields.map((field) => field.key);
  const keys = [entity.title_field, ...requested.filter((key) => key !== entity.title_field)].slice(0, maximum);
  return keys.map((key) => entity.fields.find((field) => field.key === key)).filter((field) => field !== undefined);
}

async function TableView({ view, query, canRead, canUpdate }: { view: ViewSpec; query: RawSearchParams; canRead: boolean; canUpdate: boolean }) {
  const entity = getEntity(view.entity ?? "");
  if (!entity) notFound();
  const fields = visibleFields(entity, view);
  const parsed = parseListQuery(entity, query, view);
  let [records, total] = await Promise.all([
    listRecords(entity.key, parsed),
    countFilteredRecords(entity.key, parsed),
  ]);
  const page = Math.min(parsed.page, Math.max(1, Math.ceil(total / parsed.pageSize)));
  if (page !== parsed.page) records = await listRecords(entity.key, { ...parsed, offset: (page - 1) * parsed.pageSize });
  const bulkFields = (view.bulk_edit_fields ?? [])
    .map((key) => entity.fields.find((field) => field.key === key))
    .filter((field) => field !== undefined);
  return (
    <>
      <RecordFilters entity={entity} fields={fields} query={parsed} resetHref={`/views/${view.key}`} />
      {canUpdate && bulkFields.length ? (
        <BulkRecordTable bulkFields={bulkFields} canRead={canRead} entity={entity} fields={fields} locale={runtimeSpec.app.locale} records={recordsForClient(records)} viewKey={view.key} />
      ) : <RecordTable canRead={canRead} entity={entity} fields={fields} locale={runtimeSpec.app.locale} records={records} />}
      <Pagination baseHref={`/views/${view.key}`} page={page} pageSize={parsed.pageSize} query={query} total={total} />
    </>
  );
}

async function KanbanView({ view, canRead, canUpdate }: { view: ViewSpec; canRead: boolean; canUpdate: boolean }) {
  const entity = getEntity(view.entity ?? "");
  if (!entity) notFound();
  const groupField = entity.fields.find((field) => field.key === view.group_by && field.type === "enum");
  if (!groupField) notFound();
  const records = await listRecords(entity.key, { sort: view.default_sort?.field, direction: view.default_sort?.direction, limit: 500 });
  const cardFields = visibleFields(entity, view, 4).filter((field) => field.key !== entity.title_field && field.key !== groupField.key);
  const titleField = entity.fields.find((field) => field.key === entity.title_field);
  const grouped = new Map<string, Array<Record<string, unknown>>>((groupField.options ?? []).map((option) => [option.key, []]));
  const ungrouped: Array<Record<string, unknown>> = [];
  for (const record of records) {
    const key = String(record[groupField.key] ?? "");
    const column = grouped.get(key);
    if (column) column.push(record);
    else ungrouped.push(record);
  }
  const columns = [...(groupField.options ?? []).map((option) => ({ ...option, records: grouped.get(option.key) ?? [] }))];
  if (ungrouped.length) columns.push({ key: "__empty", label: "Sin estado", records: ungrouped });
  return <OperationalKanban
    canMove={Boolean(view.allow_move && canUpdate)}
    canRead={canRead}
    cardFields={cardFields}
    entityKey={entity.key}
    groupField={groupField}
    initialColumns={columns.map((column) => ({ ...column, records: recordsForClient(column.records) }))}
    locale={runtimeSpec.app.locale}
    moveOptions={groupField.options ?? []}
    titleField={titleField}
    viewKey={view.key}
  />;
}

function timezoneDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day) };
}

function recordDateKey(value: unknown, timezone: string) {
  if (value instanceof Date) {
    const parts = timezoneDateParts(value, timezone);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }
  const text = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.valueOf())) return "";
  return recordDateKey(parsed, timezone);
}

function requestedMonth(raw: string | undefined, timezone: string) {
  if (raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
    const [year, month] = raw.split("-").map(Number);
    return { year, month };
  }
  const current = timezoneDateParts(new Date(), timezone);
  return { year: current.year, month: current.month };
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

async function CalendarView({ view, month, canRead, canUpdate }: { view: ViewSpec; month?: string; canRead: boolean; canUpdate: boolean }) {
  const entity = getEntity(view.entity ?? "");
  const dateFieldKey = view.date_field;
  if (!entity || !dateFieldKey) notFound();
  const timezone = runtimeSpec.app.timezone ?? "UTC";
  const selected = requestedMonth(month, timezone);
  const start = `${monthKey(selected.year, selected.month)}-01`;
  const nextDate = new Date(Date.UTC(selected.year, selected.month, 1));
  const end = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const records = await calendarRecords(entity.key, dateFieldKey, start, end, timezone);
  const firstDate = new Date(Date.UTC(selected.year, selected.month - 1, 1));
  const days = new Date(Date.UTC(selected.year, selected.month, 0)).getUTCDate();
  const leading = (firstDate.getUTCDay() + 6) % 7;
  const cells = [...Array.from({ length: leading }, () => null), ...Array.from({ length: days }, (_, index) => index + 1)];
  while (cells.length % 7) cells.push(null);
  const previousDate = new Date(Date.UTC(selected.year, selected.month - 2, 1));
  const label = new Intl.DateTimeFormat(runtimeSpec.app.locale ?? "es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(firstDate);
  return (
    <>
      <div className="calendar-toolbar">
        <Link className="button secondary" href={`/views/${view.key}?month=${monthKey(previousDate.getUTCFullYear(), previousDate.getUTCMonth() + 1)}`}>← Anterior</Link>
        <h2>{label}</h2>
        <Link className="button secondary" href={`/views/${view.key}?month=${monthKey(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1)}`}>Siguiente →</Link>
      </div>
      <OperationalCalendar
        canReschedule={Boolean(view.allow_reschedule && canUpdate)}
        cells={cells.map((day, index) => ({ day, key: day ? `${monthKey(selected.year, selected.month)}-${String(day).padStart(2, "0")}` : `empty-${index}` }))}
        initialEvents={records.map((record) => ({
          id: String(record.id),
          title: String(record[entity.title_field] ?? "—"),
          dateKey: recordDateKey(record[dateFieldKey], timezone),
          href: canRead ? `/records/${entity.key}/${record.id}` : undefined,
        }))}
        viewKey={view.key}
      />
    </>
  );
}

type WidgetResult =
  | { widget: DashboardWidgetSpec; kind: "metric"; value: number }
  | { widget: DashboardWidgetSpec; kind: "breakdown"; rows: Array<{ key: string | boolean | null; count: string }> }
  | { widget: DashboardWidgetSpec; kind: "recent"; records: Array<Record<string, unknown>> };

async function resolveWidget(widget: DashboardWidgetSpec): Promise<WidgetResult> {
  if (widget.type === "metric") {
    return { widget, kind: "metric", value: await aggregateRecords(widget.entity, widget.aggregate ?? "count", widget.field) };
  }
  if (widget.type === "breakdown") {
    return { widget, kind: "breakdown", rows: await breakdownRecords(widget.entity, widget.group_by ?? "") };
  }
  return { widget, kind: "recent", records: await listRecords(widget.entity, { limit: widget.limit ?? 5 }) };
}

async function DashboardView({ view, userRole }: { view: ViewSpec; userRole: string }) {
  const results = await Promise.all((view.widgets ?? []).map(resolveWidget));
  return (
    <div className="dashboard-grid">
      {results.map((result) => {
        const entity = getEntity(result.widget.entity);
        if (!entity) return null;
        if (result.kind === "metric") {
          return (
            <article className="dashboard-widget metric-widget" key={result.widget.key}>
              <div className="card-label">{result.widget.label}</div>
              <div className="metric">{new Intl.NumberFormat(runtimeSpec.app.locale).format(result.value)}</div>
              <div className="table-secondary">{entity.label_plural}</div>
            </article>
          );
        }
        if (result.kind === "breakdown") {
          const groupField = entity.fields.find((field) => field.key === result.widget.group_by);
          const labels = Object.fromEntries((groupField?.options ?? []).map((option) => [option.key, option.label]));
          const maximum = Math.max(1, ...result.rows.map((row) => Number(row.count)));
          return (
            <article className="dashboard-widget breakdown-widget" key={result.widget.key}>
              <h2>{result.widget.label}</h2>
              <div className="breakdown-list">
                {result.rows.map((row) => {
                  const key = String(row.key ?? "Sin valor");
                  const count = Number(row.count);
                  return (
                    <div className="breakdown-row" key={key}>
                      <div className="breakdown-label"><span>{labels[key] ?? (key === "true" ? "Sí" : key === "false" ? "No" : key)}</span><strong>{count}</strong></div>
                      <div className="breakdown-track"><span style={{ width: `${Math.max(4, count / maximum * 100)}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        }
        const fields = (result.widget.fields ?? []).map((key) => entity.fields.find((field) => field.key === key)).filter((field) => field !== undefined);
        const canRead = entity.permissions[userRole]?.includes("read") ?? false;
        return (
          <article className="dashboard-widget recent-widget" key={result.widget.key}>
            <div className="section-heading"><h2>{result.widget.label}</h2><Link className="record-link" href={`/records/${entity.key}`}>Ver todos →</Link></div>
            <RecordTable canRead={canRead} entity={entity} fields={fields} locale={runtimeSpec.app.locale} records={result.records} />
          </article>
        );
      })}
    </div>
  );
}

export default async function NamedViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const [{ view: viewKey }, query] = await Promise.all([params, searchParams]);
  const view = getView(viewKey);
  if (!view || !["table", "kanban", "calendar", "dashboard"].includes(view.type)) notFound();
  const user = await requireViewAccess(view.key);
  const entity = view.entity ? getEntity(view.entity) : null;
  const canRead = entity ? hasPermission(user, entity.key, "read") : false;
  const canUpdate = entity ? hasPermission(user, entity.key, "update") : false;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Vista · {view.type}</p>
          <h1>{view.label}</h1>
          <p className="subtitle">{entity?.description ?? "Resumen configurable generado desde AppSpec."}</p>
        </div>
        {entity && <Link className="button secondary" href={`/records/${entity.key}`}>Abrir listado base</Link>}
      </div>
      {view.type === "table" && <TableView canRead={canRead} canUpdate={canUpdate} query={query} view={view} />}
      {view.type === "kanban" && <KanbanView canRead={canRead} canUpdate={canUpdate} view={view} />}
      {view.type === "calendar" && <CalendarView canRead={canRead} canUpdate={canUpdate} month={firstParam(query.month)} view={view} />}
      {view.type === "dashboard" && <DashboardView userRole={user.roleKey} view={view} />}
    </>
  );
}
