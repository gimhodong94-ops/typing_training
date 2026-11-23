import type { Session } from "./types";

export type SelectedSentence = { roundIndex: number; roundId: string; text: string; errorRate: number; firstErrorEpisodes: number };
export const SENTENCE_ANALYSIS_KIND_V1 = ["substitution", "omission", "extra", "transposition", "space", "language", "shift", "timing", "other"] as const;
export type SentenceAnalysisKind = typeof SENTENCE_ANALYSIS_KIND_V1[number];
export type ValidatedQuestion = { id: string; prompt: string; checkMethod: string; roundId: string };

export function selectSentenceAnalysisRounds(session: Session): SelectedSentence[] {
  if (session.isLocalStorageOnly) return [];
  const selected: SelectedSentence[] = [];
  session.rounds.forEach((round, index) => {
    const inputs = round.events.filter((event) => event.kind === "char" || event.kind === "overflow");
    const firstErrorEpisodes = new Set(inputs.filter((event) => (event.err || event.ok === false) && event.episodeRole !== "cascade").map((event) => event.episodeId ?? `${event.pos}:${event.t}`)).size;
    const errorRate = inputs.length ? inputs.filter((event) => event.err || event.ok === false).length / inputs.length : 0;
    if (errorRate >= 0.02 && firstErrorEpisodes >= 2) selected.push({ roundIndex: index + 1, roundId: round.id, text: round.text, errorRate, firstErrorEpisodes });
  });
  const result: SelectedSentence[] = [];
  for (let start = 0; start < session.rounds.length; start += 10) {
    result.push(...selected.filter((row) => row.roundIndex > start && row.roundIndex <= start + 10).slice(0, 3));
  }
  return result;
}

const forbiddenHealth = /건강|질병|병원|의사|진단|치료|통증|마비|장애|증후군|불안|우울|ADHD|손목터널|신체|의학|medical|health|diagnos/i;
const placeholder = /\{(?:F\d+\.)?(?:round|text|kind|expected|typed|evidence)\}/g;
const allowedNumber = /^\{(?:round|errorCount|errorRate|episodeCount)\}$/;

function safeSentence(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  let text = value.replace(/[<>`*_#]/g, "").replace(/\s+/g, " ").trim();
  if (!text || forbiddenHealth.test(text)) return "";
  if (/\d/.test(text.replace(/\{(?:round|errorCount|errorRate|episodeCount)\}/g, ""))) return "";
  text = text.replace(/\{[^{}]*\}/g, (token) => allowedNumber.test(token) ? token : "");
  text = text.replace(placeholder, "");
  return text.slice(0, max);
}

export function validateSentenceAnalysis(value: unknown, roundIds: Set<string>) {
  const root = value && typeof value === "object" ? value as any : {};
  const rows = Array.isArray(root.analyses) ? root.analyses : [];
  const output = rows.flatMap((row: any) => {
    if (!row || !roundIds.has(row.roundId)) return [];
    const kind = SENTENCE_ANALYSIS_KIND_V1.includes(row.kind) ? row.kind : undefined;
    const summary = safeSentence(row.summary, 240);
    const evidence = safeSentence(row.evidence, 240);
    const questionRows = Array.isArray(row.questions) ? row.questions.slice(0, 2) : [];
    const questions = questionRows.flatMap((q: any, index: number) => {
      const prompt = safeSentence(q?.prompt, 180);
      const checkMethod = safeSentence(q?.checkMethod, 180);
      const localId = typeof q?.id === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(q.id) ? q.id : `q${index + 1}`;
      const id = `${row.roundId}-${localId}`;
      return prompt && checkMethod ? [{ id, prompt, checkMethod, roundId: row.roundId }] : [];
    });
    return kind && summary && evidence ? [{ roundId: row.roundId, kind, summary, evidence, questions }] : [];
  });
  return output;
}

export function capSessionQuestions<T extends { questions?: unknown[] }>(rows: T[], limit = 5): T[] {
  let remaining = limit;
  return rows.map((row) => {
    const questions = (row.questions ?? []).slice(0, Math.max(remaining, 0));
    remaining = Math.max(0, remaining - questions.length);
    return { ...row, questions };
  });
}

export function chunkSentenceAnalysis<T>(rows: T[]) {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length && i < 10; i += 5) chunks.push(rows.slice(i, i + 5));
  return chunks;
}

export function shouldSendSentenceAnalysis(settings: { enabled: boolean; consent: boolean; provider: string; hasKey: boolean }) {
  return settings.enabled && settings.consent && settings.provider === "gemini" && settings.hasKey;
}
