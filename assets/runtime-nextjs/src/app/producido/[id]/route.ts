import { getCurrentUser, hasPermission } from "@/lib/auth";
import { recordAccessForUser } from "@/lib/record-access";
import { getRecord } from "@/lib/repository";
import { almacenConfigurado, direccionDeDescarga } from "@/platform/storage/almacen";
import { archivoPorId } from "@/platform/storage/archivos";

export const dynamic = "force-dynamic";

/**
 * Bajar un archivo de lo producido desde el panel.
 *
 * Igual que un adjunto: el archivo hereda la autorización de su registro padre, que se
 * consulta con la identidad de quien pide, y todo lo que no se puede entregar responde 404
 * para no confirmar que existe. Si se puede, redirige a una dirección firmada del almacén
 * que vale cinco minutos: los bytes no pasan por este servidor.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!almacenConfigurado()) return new Response("Archivo no encontrado", { status: 404 });
  const [user, archivo] = await Promise.all([getCurrentUser(), archivoPorId(id)]);
  if (!user) return new Response("Autenticación requerida", { status: 401 });
  if (!archivo || archivo.status !== "guardado") return new Response("Archivo no encontrado", { status: 404 });
  if (!hasPermission(user, archivo.entity_key, "read")) return new Response("Archivo no encontrado", { status: 404 });
  const padre = await getRecord(archivo.entity_key, archivo.record_id, undefined, false, recordAccessForUser(user));
  if (!padre) return new Response("Archivo no encontrado", { status: 404 });
  const { url } = direccionDeDescarga(archivo.object_key, { nombre: archivo.original_name, tipo: archivo.content_type }, 300);
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
}
