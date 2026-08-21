import { requirePermission } from "@/lib/auth";
import { buildCsv, buildXlsx, MAX_EXPORT_ROWS } from "@/lib/data-transfer";
import { listRecordsForExport } from "@/lib/repository";
import { requireEntity } from "@/lib/spec";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ entity: string }> }) {
  const { entity: entityKey } = await context.params;
  const entity = requireEntity(entityKey);
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "xlsx";
  const template = url.searchParams.get("template") === "1";
  if (format !== "csv" && format !== "xlsx") return new Response("Formato no admitido.", { status: 400 });
  await requirePermission(entity.key, template ? "create" : "list");
  const records = template ? [] : await listRecordsForExport(entity.key, MAX_EXPORT_ROWS + 1);
  if (records.length > MAX_EXPORT_ROWS) {
    return new Response(`La exportación supera el límite de ${MAX_EXPORT_ROWS} registros. Aplicá un reporte específico.`, { status: 413 });
  }
  const body = format === "csv" ? buildCsv(entity, records, template) : await buildXlsx(entity, records, template);
  const prefix = template ? "plantilla" : "exportacion";
  return new Response(new Uint8Array(body), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${prefix}-${entity.key}.${format}"`,
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
