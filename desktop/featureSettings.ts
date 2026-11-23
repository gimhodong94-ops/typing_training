import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { atomicWriteFile } from "./sessionStore";

export type FeatureSettings = {
  sentenceAnalysisEnabled: boolean;
  questionCardsEnabled: boolean;
  sentenceAnalysisConsent: boolean;
  sentenceAnalysisConsentAt: string | null;
};

const defaults: FeatureSettings = { sentenceAnalysisEnabled: true, questionCardsEnabled: true, sentenceAnalysisConsent: false, sentenceAnalysisConsentAt: null };

export function readFeatureSettings(file: string): FeatureSettings {
  if (!existsSync(file)) return defaults;
  const saved = JSON.parse(readFileSync(file, "utf8"));
  return {
    sentenceAnalysisEnabled: saved.sentenceAnalysisEnabled !== false,
    questionCardsEnabled: saved.questionCardsEnabled !== false,
    sentenceAnalysisConsent: saved.sentenceAnalysisConsent === true,
    sentenceAnalysisConsentAt: typeof saved.sentenceAnalysisConsentAt === "string" ? saved.sentenceAnalysisConsentAt : null,
  };
}

export function saveFeatureSettings(file: string, input: Partial<FeatureSettings>, now = new Date().toISOString()): FeatureSettings {
  const current = readFeatureSettings(file);
  const consent = typeof input.sentenceAnalysisConsent === "boolean" ? input.sentenceAnalysisConsent : current.sentenceAnalysisConsent;
  const next: FeatureSettings = {
    sentenceAnalysisEnabled: typeof input.sentenceAnalysisEnabled === "boolean" ? input.sentenceAnalysisEnabled : current.sentenceAnalysisEnabled,
    questionCardsEnabled: typeof input.questionCardsEnabled === "boolean" ? input.questionCardsEnabled : current.questionCardsEnabled,
    sentenceAnalysisConsent: consent,
    sentenceAnalysisConsentAt: consent ? (input.sentenceAnalysisConsent === true && !current.sentenceAnalysisConsent ? now : current.sentenceAnalysisConsentAt) : null,
  };
  mkdirSync(dirname(file), { recursive: true });
  atomicWriteFile(file, JSON.stringify(next));
  return next;
}
