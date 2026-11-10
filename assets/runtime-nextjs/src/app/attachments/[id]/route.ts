import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getAttachmentContent, getAttachmentMetadata } from "@/lib/attachments";
import { recordAccessForUser } from "@/lib/record-access";
import { getRecord } from "@/lib/repository";

export const dynamic = "force-dynamic";

function fallbackFileName(value: string) {
  const fallback = value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return fallback || "archivo";
}

/**
 * Descargar un adjunto.
 *
 * El orden de los pasos es la mitad del control:
 *
 * 1. **Primero los metadatos, nunca los bytes.** Traer el contenido antes de saber si se
 *    puede entregar carga en memoria un archivo que quizá no corresponde. Con archivos
 *    grandes e identificadores adivinados, eso sólo sirve para hacer daño.
 * 2. **Un adjunto hereda la autorización de su registro padre.** Tener permiso de lectura
 *    sobre la entidad no alcanza si el registro concreto está fuera de alcance, así que
 *    se consulta el padre con la identidad de quien pide.
 * 3. **Todo lo que no se puede entregar responde 404.** Distinguir "no existe" de "no es
 *    tuyo" confirmaría que existe, que es justo lo que el alcance oculta.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, attachment] = await Promise.all([getCurrentUser(), getAttachmentMetadata(id)]);
  if (!user) return new Response("Autenticación requerida", { status: 401 });
  if (!attachment) return new Response("Archivo no encontrado", { status: 404 });
  if (!hasPermission(user, attachment.entity_key, "read")) {
    return new Response("Archivo no encontrado", { status: 404 });
  }

  const parent = await getRecord(
    attachment.entity_key,
    String(attachment.record_id),
    undefined,
    false,
    recordAccessForUser(user),
  );
  if (!parent) return new Response("Archivo no encontrado", { status: 404 });

  const content = await getAttachmentContent(id);
  if (!content) return new Response("Archivo no encontrado", { status: 404 });

  const encodedName = encodeURIComponent(content.original_name);
  // `?ver=1` muestra una imagen en la página (una galería de láminas) en vez de descargarla.
  // Sólo imágenes: un PDF o un HTML mostrados en línea abren otra superficie de ataque.
  const enLinea = new URL(request.url).searchParams.get("ver") === "1" && /^image\/(jpeg|png|webp|gif)$/.test(content.content_type);
  return new Response(new Uint8Array(content.content), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${enLinea ? "inline" : "attachment"}; filename="${fallbackFileName(content.original_name)}"; filename*=UTF-8''${encodedName}`,
      "Content-Length": String(content.size_bytes),
      "Content-Type": content.content_type,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
