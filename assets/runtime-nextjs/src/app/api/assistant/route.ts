import {
  createAgentUIStreamResponse,
  createIdGenerator,
  validateUIMessages,
  type UIMessage,
} from "ai";
import { canUseApplicationAssistant } from "@/features/ai/access";
import { createApplicationAssistant, type ApplicationAssistantMessage } from "@/features/ai/agent";
import { aiProviderIsConfigured, requireAllowedAiModel } from "@/features/ai/config";
import {
  completeAiRun,
  createAiRun,
  failAiRun,
  getAiConversation,
  isAiConversationId,
  loadAiMessages,
  recordAiRunStep,
  saveAiMessages,
} from "@/features/ai/store";
import { getCurrentUser } from "@/lib/auth";

export const maxDuration = 60;

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("Sesión requerida.", 401);
  if (!canUseApplicationAssistant(user)) return errorResponse("No tenés acceso al asistente.", 403);
  if (!aiProviderIsConfigured()) return errorResponse("El proveedor de IA todavía no está configurado.", 503);

  let body: { id?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Solicitud inválida.", 400);
  }
  if (typeof body.id !== "string" || !isAiConversationId(body.id) || !body.message || typeof body.message !== "object") {
    return errorResponse("Faltan la conversación o el mensaje.", 400);
  }
  const incoming = body.message as UIMessage;
  if (incoming.role !== "user" || typeof incoming.id !== "string" || !Array.isArray(incoming.parts)) {
    return errorResponse("El mensaje recibido no es válido.", 400);
  }

  const conversation = await getAiConversation(user.id, body.id);
  if (!conversation) return errorResponse("Conversación inexistente.", 404);
  requireAllowedAiModel(conversation.modelId);
  const previousMessages = await loadAiMessages(user.id, conversation.id);
  if (previousMessages.length >= 120) {
    return errorResponse("Esta conversación alcanzó el límite de mensajes. Creá una nueva.", 413);
  }

  const agent = createApplicationAssistant(user, conversation.modelId);
  let messages: ApplicationAssistantMessage[];
  try {
    messages = await validateUIMessages<ApplicationAssistantMessage>({
      messages: [...previousMessages, incoming],
      tools: agent.tools,
    });
  } catch {
    return errorResponse("El historial de la conversación no superó la validación.", 400);
  }

  await saveAiMessages(user.id, conversation.id, messages);
  const runId = await createAiRun(user.id, conversation.id, conversation.modelId);

  try {
    return await createAgentUIStreamResponse({
      agent,
      uiMessages: messages,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      timeout: 55_000,
      consumeSseStream: ({ stream }) => stream.pipeTo(new WritableStream()),
      onStepEnd: async ({ usage, toolCalls }) => {
        await recordAiRunStep(
          runId,
          usage,
          toolCalls.map((call) => ({ id: call.toolCallId, name: call.toolName, input: call.input })),
        );
      },
      onEnd: async ({ messages: completedMessages, isAborted }) => {
        await saveAiMessages(user.id, conversation.id, completedMessages);
        await completeAiRun(runId, isAborted);
      },
      onError(error) {
        void failAiRun(runId, error);
        return "No pude completar la consulta. Revisá la configuración o intentá nuevamente.";
      },
    });
  } catch (error) {
    await failAiRun(runId, error);
    throw error;
  }
}
