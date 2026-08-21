export type AiModelOption = {
  id: string;
  label: string;
  provider: string;
};

export type AiProviderMode = "gateway" | "openai";

const GATEWAY_DEFAULT_MODELS: AiModelOption[] = [
  { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", provider: "Anthropic" },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini", provider: "OpenAI" },
  { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", provider: "Google" },
];

const OPENAI_DEFAULT_MODELS: AiModelOption[] = [
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini", provider: "OpenAI" },
  { id: "openai/gpt-5", label: "GPT-5", provider: "OpenAI" },
];

const KNOWN_MODELS = [...GATEWAY_DEFAULT_MODELS, ...OPENAI_DEFAULT_MODELS];

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,47}\/[a-z0-9][a-z0-9._-]{0,95}$/i;

function titleCase(value: string) {
  return value
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function optionFromId(id: string): AiModelOption {
  const known = KNOWN_MODELS.find((model) => model.id === id);
  if (known) return known;
  const [provider, model] = id.split("/");
  return { id, provider: titleCase(provider), label: titleCase(model) };
}

function gatewayIsConfigured() {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);
}

export function getAiProviderMode(): AiProviderMode | null {
  const requested = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (requested === "openai") return process.env.OPENAI_API_KEY ? "openai" : null;
  if (requested === "gateway") return gatewayIsConfigured() ? "gateway" : null;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (gatewayIsConfigured()) return "gateway";
  return null;
}

export function getAllowedAiModels(): AiModelOption[] {
  const providerMode = getAiProviderMode();
  const configured = process.env.AI_ALLOWED_MODELS
    ?.split(",")
    .map((model) => model.trim())
    .filter((model) => MODEL_ID.test(model));
  const compatible = providerMode === "openai"
    ? configured?.filter((model) => model.startsWith("openai/"))
    : configured;
  const defaults = providerMode === "openai" ? OPENAI_DEFAULT_MODELS : GATEWAY_DEFAULT_MODELS;
  const ids = [...new Set(compatible?.length ? compatible : defaults.map((model) => model.id))].slice(0, 12);
  return ids.map(optionFromId);
}

export function requireAllowedAiModel(modelId: string) {
  const model = getAllowedAiModels().find((candidate) => candidate.id === modelId);
  if (!model) throw new Error("El modelo solicitado no está habilitado para esta aplicación.");
  return model;
}

export function defaultAiModel() {
  return getAllowedAiModels()[0];
}

export function aiProviderIsConfigured() {
  return getAiProviderMode() !== null;
}
