export type PersonalAiProviderKey = "openai" | "anthropic";

export type AiModelOption = {
  id: string;
  label: string;
  provider: string;
  providerKey: "openai" | "anthropic" | "google";
  directModelId: string;
};

export const PERSONAL_AI_PROVIDERS = [
  {
    key: "openai" as const,
    label: "OpenAI",
    description: "GPT para conversaciones, análisis y uso de herramientas.",
    placeholder: "sk-...",
  },
  {
    key: "anthropic" as const,
    label: "Anthropic",
    description: "Claude para análisis y tareas agentivas.",
    placeholder: "sk-ant-...",
  },
];

// Catalogo de plataforma: se actualiza con el kernel, no se edita por cliente.
// Para restringir o reordenar lo que ve un cliente, usar AI_ALLOWED_MODELS.
// El `id` es el identificador del gateway; `directModelId` es el del proveedor.
// Verificar cada id contra la documentacion del proveedor antes de un release:
// los catalogos de modelos cambian varias veces al ano.
export const AI_MODEL_CATALOG: AiModelOption[] = [
  { id: "anthropic/claude-opus-5", directModelId: "claude-opus-5", label: "Claude Opus 5", provider: "Anthropic", providerKey: "anthropic" },
  { id: "anthropic/claude-sonnet-5", directModelId: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "Anthropic", providerKey: "anthropic" },
  { id: "anthropic/claude-haiku-4.5", directModelId: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "Anthropic", providerKey: "anthropic" },
  { id: "openai/gpt-5.4", directModelId: "gpt-5.4", label: "GPT-5.4", provider: "OpenAI", providerKey: "openai" },
  { id: "openai/gpt-5.4-mini", directModelId: "gpt-5.4-mini", label: "GPT-5.4 Mini", provider: "OpenAI", providerKey: "openai" },
  { id: "google/gemini-3.1-flash-lite", directModelId: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", provider: "Google", providerKey: "google" },
];

export function isPersonalAiProviderKey(value: string): value is PersonalAiProviderKey {
  return PERSONAL_AI_PROVIDERS.some((provider) => provider.key === value);
}

export function findAiModel(modelId: string) {
  return AI_MODEL_CATALOG.find((model) => model.id === modelId);
}

