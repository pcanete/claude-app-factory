import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getAttachmentContent } from "@/lib/attachments";

export const dynamic = "force-dynamic";

function fallbackFileName(value: string) {
  const fallback = value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return fallback || "archivo";
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, attachment] = await Promise.all([getCurrentUser(), getAttachmentContent(id)]);
  if (!attachment) return new Response("Archivo no encontrado", { status: 404 });
  if (!user) return new Response("Autenticación requerida", { status: 401 });
  if (!hasPermission(user, attachment.entity_key, "read")) return new Response("Acceso denegado", { status: 403 });

  const encodedName = encodeURIComponent(attachment.original_name);
  return new Response(new Uint8Array(attachment.content), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fallbackFileName(attachment.original_name)}"; filename*=UTF-8''${encodedName}`,
      "Content-Length": String(attachment.size_bytes),
      "Content-Type": attachment.content_type,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
