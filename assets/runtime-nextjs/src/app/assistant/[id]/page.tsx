import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAiConversationAction } from "@/app/assistant/actions";
import { ApplicationAssistantChat } from "@/features/ai/components/application-assistant-chat";
import type { ApplicationAssistantMessage } from "@/features/ai/agent";
import { canUseApplicationAssistant } from "@/features/ai/access";
import { getUserAiConfiguration } from "@/features/ai/config";
import { AI_MODEL_CATALOG } from "@/features/settings/catalog";
import { getAiConversation, isAiConversationId, listAiConversations, loadAiMessages } from "@/features/ai/store";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function formatConversationDate(value: Date) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short" }).format(value);
}

export default async function AssistantConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!canUseApplicationAssistant(user)) redirect("/forbidden");
  const { id } = await params;
  if (!isAiConversationId(id)) notFound();
  const [conversation, conversations, initialMessages] = await Promise.all([
    getAiConversation(user.id, id),
    listAiConversations(user.id),
    loadAiMessages(user.id, id),
  ]);
  if (!conversation) notFound();
  const configuration = await getUserAiConfiguration(user.id);
  const models = configuration.models.length ? configuration.models : AI_MODEL_CATALOG;
  const selectedModel = models.find((model) => model.id === conversation.modelId);
  const configured = configuration.configured;

  return (
    <div className="assistant-page">
      <div className="page-header assistant-header">
        <div>
          <div className="eyebrow">Capa agentiva · Solo lectura</div>
          <h1>Asistente</h1>
          <p className="subtitle">
            {selectedModel ? `${selectedModel.provider} · ${selectedModel.label}` : conversation.modelId}
          </p>
        </div>
      </div>
      {!configured && (
        <div className="notice warning assistant-config-notice">
          Conectá una clave personal desde <Link href="/settings">Configuración</Link> para consultar un modelo.
        </div>
      )}
      <div className="assistant-layout">
        <aside className="conversation-sidebar">
          <form action={createAiConversationAction} className="assistant-new-form compact">
            <select aria-label="Modelo para la nueva conversación" className="control" defaultValue={configuration.preferredModelId ?? models[0]?.id} disabled={!configured} name="modelId">
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.provider} · {model.label}</option>
              ))}
            </select>
            <button className="button" disabled={!configured} type="submit">+ Nueva</button>
          </form>
          <div className="conversation-list" aria-label="Conversaciones">
            {conversations.map((item) => (
              <Link
                className={`conversation-link${item.id === conversation.id ? " active" : ""}`}
                href={`/assistant/${item.id}`}
                key={item.id}
              >
                <span>{item.title}</span>
                <small>{formatConversationDate(item.updatedAt)}</small>
              </Link>
            ))}
          </div>
        </aside>
        <ApplicationAssistantChat
          configured={configured}
          conversationId={conversation.id}
          initialMessages={initialMessages as ApplicationAssistantMessage[]}
        />
      </div>
    </div>
  );
}
