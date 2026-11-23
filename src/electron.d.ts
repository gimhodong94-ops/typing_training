import type { ApiResult } from "../server/ai";
import type { AIProvider, AISettings } from "../shared/aiModels";
import type { Session } from "./lib/types";

declare global {
  interface Window {
    typingCoach?: {
      request(path: string, body: unknown): Promise<ApiResult>;
      getAISettings(): Promise<AISettings>;
      saveAISettings(provider: AIProvider, model: string, apiKey: string): Promise<void>;
      clearAIKey(provider: AIProvider): Promise<void>;
      hasApiKey(): Promise<boolean>;
      getFeatureSettings(): Promise<{ sentenceAnalysisEnabled: boolean; questionCardsEnabled: boolean; sentenceAnalysisConsent: boolean; sentenceAnalysisConsentAt: string | null }>;
      saveFeatureSettings(settings: Partial<{ sentenceAnalysisEnabled: boolean; questionCardsEnabled: boolean; sentenceAnalysisConsent: boolean; sentenceAnalysisConsentAt: string | null }>): Promise<{ sentenceAnalysisEnabled: boolean; questionCardsEnabled: boolean; sentenceAnalysisConsent: boolean; sentenceAnalysisConsentAt: string | null }>;
      appendSession(sessionId: number, initial: boolean, records: unknown[]): Promise<void>;
      loadSessions(): Promise<Session[]>;
    };
  }
}

export {};
