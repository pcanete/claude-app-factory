import { ownerFieldRestriction, recordAccessForUser } from "@/lib/record-access";
import { listManagedUsers } from "@/platform/users/store";
import { notFound } from "next/navigation";
import { RecordForm } from "@/components/record-form";
import { canAccessRelationshipOptions, requirePermission } from "@/lib/auth";
import { relationshipOptions } from "@/lib/repository";
import { getEntity } from "@/lib/spec";

export const dynamic = "force-dynamic";

export default async function NewRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<{ rule_error?: string }>;
}) {
  const [{ entity: entityKey }, query] = await Promise.all([params, searchParams]);
  const entity = getEntity(entityKey);
  if (!entity) notFound();
  const user = await requirePermission(entity.key, "create");
  if (!canAccessRelationshipOptions(user, entity)) return notFound();
  const options = await relationshipOptions(entity, recordAccessForUser(user));

  // Sólo se cargan si la entidad tiene algún campo de tipo persona: no vale la pena
  // consultar usuarios para un formulario que no los usa.
  const personas = entity.fields.some((field) => field.type === "person")
    ? (await listManagedUsers({ active: true, limit: 200 })).map((persona) => ({
        id: persona.id,
        name: persona.displayName,
      }))
    : undefined;

  const restriccionDeDueno = ownerFieldRestriction(entity, recordAccessForUser(user));

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Nuevo registro</p>
          <h1>Crear {entity.label.toLowerCase()}</h1>
          <p className="subtitle">Los campos se generan directamente desde AppSpec.</p>
        </div>
      </div>
      {query.rule_error && <div className="notice rule-blocked">{query.rule_error}</div>}
      <RecordForm entity={entity} ownerRestriction={restriccionDeDueno} people={personas} relationshipOptions={options} />
    </>
  );
}
