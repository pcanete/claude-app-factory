import { openai } from "@ai-sdk/openai";
import { gateway, type GatewayModelId, type LanguageModel } from "ai";
import { getAiProviderMode } from "@/features/ai/config";

export type AiModelAdapter = {
  key: string;
  model(modelId: string): LanguageModel;
};

const gatewayModelAdapter: AiModelAdapter = {
  key: "vercel-ai-gateway",
  model: (modelId) => gateway(modelId as GatewayModelId),
};

const openAiModelAdapter: AiModelAdapter = {
  key: "openai-direct",
  model(modelId) {
    if (!modelId.startsWith("openai/")) {
      throw new Error("Una clave directa de OpenAI solo puede usar modelos openai/*.");
    }
    return openai(modelId.slice("openai/".length));
  },
};

export function getAiModelAdapter(): AiModelAdapter {
  const providerMode = getAiProviderMode();
  if (providerMode === "openai") return openAiModelAdapter;
  if (providerMode === "gateway") return gatewayModelAdapter;
  throw new Error("El proveedor de IA todavía no está configurado.");
}
