import type { EntitySpec, ViewSpec } from "@/lib/spec";
import type { ListRecordOptions } from "@/lib/repository";

export type RawSearchParams = Record<string, string | string[] | undefined>;
export type ParsedListQuery = ListRecordOptions & {
  filters: Record<string, string>;
  page: number;
  pageSize: number;
};

export function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseListQuery(
  entity: EntitySpec,
  params: RawSearchParams,
  view?: ViewSpec,
): ParsedListQuery {
  const filters = Object.fromEntries(
    entity.fields
      .map((field) => [field.key, firstParam(params[`f_${field.key}`])?.trim() ?? ""] as const)
      .filter(([, value]) => value),
  );
  const requestedDirection = firstParam(params.direction);
  const rawPage = firstParam(params.page);
  const page = rawPage && /^\d+$/.test(rawPage) ? Math.min(100_000, Math.max(1, Number(rawPage))) : 1;
  const pageSize = view?.page_size ?? 50;
  return {
    search: firstParam(params.q)?.trim(),
    filters,
    sort: firstParam(params.sort) ?? view?.default_sort?.field,
    direction: requestedDirection === "asc" || requestedDirection === "desc"
      ? requestedDirection
      : view?.default_sort?.direction,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    page,
    pageSize,
  };
}
