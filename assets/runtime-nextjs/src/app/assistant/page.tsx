import { redirect } from "next/navigation";
import { createAiConversationAction } from "@/app/assistant/actions";
import { canUseApplicationAssistant } from "@/features/ai/access";
import { getUserAiConfiguration } from "@/features/ai/config";
import { AI_MODEL_CATALOG } from "@/features/settings/catalog";
import { listAiConversations } from "@/features/ai/store";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AssistantLandingPage() {
  const user = await requireUser();
  if (!canUseApplicationAssistant(user)) redirect("/forbidden");
  const conversations = await listAiConversations(user.id);
  if (conversations[0]) redirect(`/assistant/${conversations[0].id}`);
  const configuration = await getUserAiConfiguration(user.id);
  const models = configuration.models.length ? configuration.models : AI_MODEL_CATALOG;
  const configured = configuration.configured;

  return (
    <div className="assistant-landing">
      <div className="page-header">
        <div>
          <div className="eyebrow">Capa agentiva</div>
          <h1>Asistente de la aplicación</h1>
          <p className="subtitle">Conversá con las entidades y datos que tu rol puede consultar.</p>
        </div>
      </div>
      {!configured && (
        <div className="notice warning">
          Conectá una clave personal desde <a href="/settings">Configuración</a> para habilitar respuestas reales.
        </div>
      )}
      <section className="assistant-empty card">
        <div className="assistant-orb" aria-hidden="true">✦</div>
        <h2>Creá la primera conversación</h2>
        <p className="subtitle">El asistente comienza en modo de solo lectura y aplica tus permisos en cada consulta.</p>
        <form action={createAiConversationAction} className="assistant-new-form">
          <label className="field">
            <span className="field-label">Modelo</span>
            <select className="control" defaultValue={configuration.preferredModelId ?? models[0]?.id} disabled={!configured} name="modelId">
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.provider} · {model.label}</option>
              ))}
            </select>
          </label>
          <button className="button" disabled={!configured} type="submit">Nueva conversación</button>
        </form>
      </section>
    </div>
  );
}
