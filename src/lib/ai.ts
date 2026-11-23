import type { Feedback } from "./types";
import type { Sentence } from "./sentences";
import thresholds from "../../config/thresholds.json";

const confidenceRank: Record<string, number> = { 낮음: 1, 중간: 2, 높음: 3 };
const meetsPracticeConfidence = (value: unknown) => typeof value === "string" &&
  (confidenceRank[value] ?? 0) >= (confidenceRank[thresholds.detection.practiceWeaknessMinimumConfidence] ?? 2);

export function normalizeFeedback(value: unknown): Feedback | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const confidence = (value: unknown): Feedback["weaknesses"][number]["confidence"] =>
    value === "높음" || value === "중간" || value === "낮음" ? value : "낮음";
  const clean = (value: unknown) => typeof value === "string" ? value : "";
  const strengths = Array.isArray(raw.strengths) ? raw.strengths.map((item) => {
    if (typeof item === "string") return { text: item, evidence: "" };
    const strength = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      text: clean(strength.text), evidence: clean(strength.evidence),
      ...(Array.isArray(strength.factIds) ? { factIds: strength.factIds.filter((id): id is string => typeof id === "string") } : {}),
    };
  }).filter((item) => item.text) : [];
  const normalizeWeakness = (item: unknown) => {
    const weakness = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      title: clean(weakness.title),
      confidence: confidence(weakness.confidence),
      evidence: clean(weakness.evidence),
      possibleCauses: Array.isArray(weakness.possibleCauses) ? weakness.possibleCauses.filter((cause): cause is string => typeof cause === "string") : [],
      checkNext: clean(weakness.checkNext),
      advice: clean(weakness.advice),
      factIds: Array.isArray(weakness.factIds) ? weakness.factIds.filter((id): id is string => typeof id === "string") : [],
    };
  };
  const rawWeaknesses = Array.isArray(raw.weaknesses) ? raw.weaknesses.map(normalizeWeakness).filter((item) => item.title) : [];
  const weaknesses = rawWeaknesses.filter((item) => item.confidence !== "낮음").slice(0, 2);
  const watchItems = [...(Array.isArray(raw.watchItems) ? raw.watchItems.map(normalizeWeakness) : []),
    ...rawWeaknesses.filter((item) => item.confidence === "낮음")].filter((item) => item.title).slice(0, 3);
  return {
    headline: clean(raw.headline),
    strengths,
    weaknesses,
    watchItems,
    freeNotes: Array.isArray(raw.freeNotes) ? raw.freeNotes.filter((item) => item && typeof item === "object").slice(0, 3).map((item) => ({
      text: clean((item as Record<string, unknown>).text),
      factIds: Array.isArray((item as Record<string, unknown>).factIds) ? ((item as Record<string, unknown>).factIds as unknown[]).filter((id): id is string => typeof id === "string") : [],
    })) : [],
    nextStep: clean(raw.nextStep),
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let data: any;
  if (window.typingCoach) {
    try { const result = await window.typingCoach.request(path, body); data = result.body; if (result.status < 200 || result.status >= 300) throw new Error(data?.error ?? "요청에 실패했어요. 잠시 뒤 다시 시도해 주세요."); }
    catch (error) { if (error instanceof Error && error.message !== "Failed to fetch") throw error; throw new Error("서버에 연결하지 못했어요. 네트워크를 확인해 주세요."); }
    return data as T;
  }
  let res: Response;
  try { res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new Error("서버에 연결하지 못했어요. 네트워크를 확인해 주세요."); }
  data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "요청에 실패했어요. 잠시 뒤 다시 시도해 주세요.");
  return data as T;
}

export const requestFeedback = (summary: unknown) =>
  post<{ feedback?: unknown; fallbackToLocal?: boolean }>("/api/feedback", { summary }).then((r) => r.fallbackToLocal ? null : normalizeFeedback(r.feedback));

export const requestPractice = (summary: unknown, feedback: Feedback | undefined, count: number, baselineMean: number) => {
  const raw = summary && typeof summary === "object" ? summary as Record<string, unknown> : {};
  const weakKeys = Array.isArray(raw.weakKeys) ? raw.weakKeys.filter((weak) => {
    if (!weak || typeof weak !== "object") return false;
    const confidence = (weak as Record<string, unknown>).confidence;
    return meetsPracticeConfidence(confidence);
  }) : [];
  const practiceSummary = { ...raw, weakKeys };
  const practiceFeedback = feedback ? { ...feedback, weaknesses: feedback.weaknesses.filter((weak) => meetsPracticeConfidence(weak.confidence)) } : undefined;
  return post<{ sentences: Sentence[]; generalPractice?: boolean }>("/api/practice", { summary: practiceSummary, feedback: practiceFeedback, count, baselineMean })
    .then((r) => ({ sentences: r.sentences, generalPractice: r.generalPractice ?? weakKeys.length === 0 }));
};

export const requestSentenceAnalysis = (rounds: unknown[]) =>
  post<{ analyses?: unknown[]; model?: string }>("/api/sentence-analysis", { rounds }).then((r) => ({ analyses: r.analyses ?? [], model: r.model ?? "알 수 없음" }));
