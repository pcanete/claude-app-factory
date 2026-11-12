import Link from "next/link";
import { notFound } from "next/navigation";
import { FichaForm } from "@/components/ficha-form";
import { canManageUsers, requireUser } from "@/lib/auth";
import { USER_SCOPES } from "@/platform/mcp/store";
import { iteracionesDeProceso, motorDisponible } from "@/platform/processes/engine";

export const dynamic = "force-dynamic";

/** Modificar un proceso. Se cambia en el lugar: el historial del método está en su skill. */
export default async function EditarProcesoPage({
  params,
  searchParams,
}: {
  params: Promise<{ familia: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!motorDisponible() || !canManageUsers(user)) notFound();
  const [{ familia }, pedido] = await Promise.all([params, searchParams]);
  const error = typeof pedido.error === "string" ? pedido.error : null;
  let datos: Awaited<ReturnType<typeof iteracionesDeProceso>>;
  try {
    datos = await iteracionesDeProceso({ id: user.id, name: user.displayName, roleKey: user.roleKey, scopes: [...USER_SCOPES], kind: "user" }, familia, 1);
  } catch {
    notFound();
  }
  // Sin ficha todavía, se arranca del resumen que ya muestra la tarjeta.
  const ficha = datos.ficha ?? { resumen: datos.resumen };
  const proceso = { ficha, metodo: datos.metodo ?? undefined, requisitos: datos.requisitos, registro: datos.registro, carpeta: datos.carpeta ?? undefined };
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow"><Link className="record-link" href={`/procesos/${familia}`}>{datos.nombre}</Link></p>
          <h1>Editar proceso</h1>
          <p className="subtitle">Lo que guardes reemplaza la ficha actual. Cómo cambia el método queda en el historial de la skill.</p>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      <FichaForm cancelarHref={`/procesos/${familia}`} familia={familia} nombre={datos.nombre} proceso={proceso} />
    </>
  );
}
