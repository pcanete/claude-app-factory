import "server-only";
import { AI_MODEL_CATALOG, type AiModelOption } from "@/features/settings/catalog";
import { getUserAiSettings } from "@/features/settings/store";

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,47}\/[a-z0-9][a-z0-9._-]{0,95}$/i;
export type GlobalAiProviderMode = "gateway" | "openai";

export function gatewayIsConfigured() {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);
}

export function getGlobalAiProviderMode(): GlobalAiProviderMode | null {
  const requested = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (requested === "openai") return process.env.OPENAI_API_KEY ? "openai" : null;
  if (requested === "gateway") return gatewayIsConfigured() ? "gateway" : null;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (gatewayIsConfigured()) return "gateway";
  return null;
}

function configuredModelFilter() {
  const configured = process.env.AI_ALLOWED_MODELS
    ?.split(",")
    .map((model) => model.trim())
    .filter((model) => MODEL_ID.test(model));
  return configured?.length ? new Set(configured) : null;
}

function movePreferredFirst(models: AiModelOption[], preferredModelId: string | null) {
  if (!preferredModelId) return models;
  return [...models].sort((left, right) => Number(right.id === preferredModelId) - Number(left.id === preferredModelId));
}

export async function getUserAiConfiguration(userId: string) {
  const settings = await getUserAiSettings(userId);
  const globalProviderMode = getGlobalAiProviderMode();
  const filter = configuredModelFilter();
  const models = AI_MODEL_CATALOG.filter((model) => {
    if (filter && !filter.has(model.id)) return false;
    if (globalProviderMode === "gateway") return true;
    if (model.providerKey === "openai") return globalProviderMode === "openai" || settings.connectedProviders.has("openai");
    if (model.providerKey === "anthropic") return settings.connectedProviders.has("anthropic");
    return false;
  }).slice(0, 12);
  const ordered = movePreferredFirst(models, settings.preferredModelId);
  return {
    configured: ordered.length > 0,
    models: ordered,
    preferredModelId: ordered.some((model) => model.id === settings.preferredModelId)
      ? settings.preferredModelId
      : ordered[0]?.id ?? null,
  };
}

export async function getAllowedAiModels(userId: string) {
  return (await getUserAiConfiguration(userId)).models;
}

export async function requireAllowedAiModel(userId: string, modelId: string) {
  const model = (await getAllowedAiModels(userId)).find((candidate) => candidate.id === modelId);
  if (!model) throw new Error("El modelo solicitado no está habilitado para este usuario.");
  return model;
}

export async function defaultAiModel(userId: string) {
  return (await getUserAiConfiguration(userId)).models[0];
}

export async function aiProviderIsConfigured(userId: string) {
  return (await getUserAiConfiguration(userId)).configured;
}
