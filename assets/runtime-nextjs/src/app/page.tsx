import Link from "next/link";
import { hasPermission, requireUser } from "@/lib/auth";
import { countRecords } from "@/lib/repository";
import { localPreviewAuthEnabled } from "@/lib/runtime-access";
import { runtimeSpec } from "@/lib/spec";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  const visibleEntities = runtimeSpec.entities.filter((entity) => hasPermission(user, entity.key, "list"));
  const counts = await Promise.all(
    visibleEntities.map(async (entity) => ({
      entity,
      count: await countRecords(entity.key),
    })),
  );

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Aplicación generada</p>
          <h1>{runtimeSpec.app.name}</h1>
          <p className="subtitle">{runtimeSpec.app.description}</p>
        </div>
      </div>
      <div className="notice">
        {localPreviewAuthEnabled()
          ? `Sesión local de desarrollo · rol ${user.roleKey}. Esta vía queda bloqueada automáticamente en producción.`
          : `Sesión autenticada como ${user.displayName}.`}
      </div>
      <section className="grid" aria-label="Entidades">
        {counts.map(({ entity, count }) => (
          <article className="card" key={entity.key}>
            <div className="card-label">{entity.label_plural}</div>
            <div className="metric">{count}</div>
            <Link className="card-link" href={`/records/${entity.key}`}>Administrar →</Link>
          </article>
        ))}
      </section>
    </>
  );
}
