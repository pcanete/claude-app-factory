import Link from "next/link";
import { notFound } from "next/navigation";
import { FichaForm } from "@/components/ficha-form";
import { canManageUsers, requireUser } from "@/lib/auth";
import { motorDisponible } from "@/platform/processes/engine";

export const dynamic = "force-dynamic";

/** Alta de un proceso: su ficha. El método vive en la skill que nombra. */
export default async function NuevoProcesoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!motorDisponible() || !canManageUsers(user)) notFound();
  const pedido = await searchParams;
  const error = typeof pedido.error === "string" ? pedido.error : null;
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow"><Link className="record-link" href="/procesos">Procesos</Link></p>
          <h1>Nuevo proceso</h1>
          <p className="subtitle">Algo que el equipo ya sabe hacer: qué hace, con qué skill y cómo pedirlo. Nace publicado como v1.</p>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      <FichaForm cancelarHref="/procesos" />
    </>
  );
}
