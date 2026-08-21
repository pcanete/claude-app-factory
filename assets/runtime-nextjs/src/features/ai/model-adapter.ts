import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { gateway, type GatewayModelId, type LanguageModel } from "ai";
import { getGlobalAiProviderMode } from "@/features/ai/config";
import { findAiModel } from "@/features/settings/catalog";
import { getUserAiSecret } from "@/features/settings/store";

export type AiModelAdapter = {
  key: string;
  model: LanguageModel;
};

export async function getAiModelAdapter(userId: string, modelId: string): Promise<AiModelAdapter> {
  const model = findAiModel(modelId);
  if (!model) throw new Error("El modelo solicitado no existe en el catálogo.");
  const globalProviderMode = getGlobalAiProviderMode();

  if (model.providerKey === "openai") {
    const personalKey = await getUserAiSecret(userId, "openai");
    if (personalKey) {
      return { key: "openai-personal", model: createOpenAI({ apiKey: personalKey })(model.directModelId) };
    }
    if (globalProviderMode === "openai") {
      return { key: "openai-application", model: openai(model.directModelId) };
    }
  }

  if (model.providerKey === "anthropic") {
    const personalKey = await getUserAiSecret(userId, "anthropic");
    if (personalKey) {
      return { key: "anthropic-personal", model: createAnthropic({ apiKey: personalKey })(model.directModelId) };
    }
  }

  if (globalProviderMode === "gateway") {
    return { key: "vercel-ai-gateway", model: gateway(model.id as GatewayModelId) };
  }
  throw new Error("No hay una credencial disponible para el modelo seleccionado.");
}
