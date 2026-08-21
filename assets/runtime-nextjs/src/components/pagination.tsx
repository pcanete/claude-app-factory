import Link from "next/link";
import type { RawSearchParams } from "@/lib/view-query";

function pageHref(baseHref: string, query: RawSearchParams, page: number) {
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(query)) {
    if (key === "page") continue;
    for (const value of Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : []) {
      params.append(key, value);
    }
  }
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `${baseHref}?${suffix}` : baseHref;
}

export function Pagination({
  baseHref,
  query,
  page,
  pageSize,
  total,
}: {
  baseHref: string;
  query: RawSearchParams;
  page: number;
  pageSize: number;
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const start = total ? (current - 1) * pageSize + 1 : 0;
  const end = Math.min(total, current * pageSize);
  return (
    <nav aria-label="Paginación" className="pagination">
      <span>{start}–{end} de {total}</span>
      <div className="pagination-actions">
        {current > 1 ? <Link className="button secondary" href={pageHref(baseHref, query, current - 1)}>← Anterior</Link> : <span className="button secondary disabled">← Anterior</span>}
        <span className="pagination-page">Página {current} de {totalPages}</span>
        {current < totalPages ? <Link className="button secondary" href={pageHref(baseHref, query, current + 1)}>Siguiente →</Link> : <span className="button secondary disabled">Siguiente →</span>}
      </div>
    </nav>
  );
}
