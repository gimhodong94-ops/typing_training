export const AI_MODELS = {
  gemini: ["gemini-3.5-flash-lite", "gemini-3.8-flash"],
  "multi-ai": [
    "gpt-6.2-sol", "gpt-6.1-terra", "gpt-6-luna",
    "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5",
    "gemini-4-carbon", "gemini-4-neon", "gemini-4-hydrogen", "gemini-4-argon",
  ],
} as const;

export type AIProvider = keyof typeof AI_MODELS;
export type AISettings = {
  provider: AIProvider;
  model: string;
  hasGeminiKey: boolean;
  hasMultiAIKey: boolean;
};

export function isAIProvider(value: unknown): value is AIProvider {
  return value === "gemini" || value === "multi-ai";
}

export function isAIModel(provider: AIProvider, value: unknown): value is string {
  return typeof value === "string" && (AI_MODELS[provider] as readonly string[]).includes(value);
}
