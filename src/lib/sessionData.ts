import type { PauseInterval, Session } from "./types";

function readFeedback(raw: unknown): Session["feedback"] {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Record<string, unknown>;
  const strengths = Array.isArray(data.strengths) ? data.strengths.map((item) => {
    if (typeof item === "string") return { text: item, evidence: "" };
    const value = item as Record<string, unknown>;
    return { text: String(value?.text ?? ""), evidence: String(value?.evidence ?? ""), ...(Array.isArray(value?.factIds) ? { factIds: value.factIds.map(String) } : {}) };
  }) : [];
  const normalizeItem = (item: unknown) => {
    const value = item as Record<string, unknown>;
    const confidence: NonNullable<Session["feedback"]>["weaknesses"][number]["confidence"] =
      value?.confidence === "높음" || value?.confidence === "중간" ? value.confidence : "낮음";
    return {
      title: String(value?.title ?? ""), confidence,
      evidence: String(value?.evidence ?? ""),
      possibleCauses: Array.isArray(value?.possibleCauses) ? value.possibleCauses.map(String) : [],
      checkNext: String(value?.checkNext ?? ""), advice: String(value?.advice ?? ""),
      factIds: Array.isArray(value?.factIds) ? value.factIds.map(String) : [],
    };
  };
  const items = Array.isArray(data.weaknesses) ? data.weaknesses.map(normalizeItem) : [];
  const weaknesses = items.filter((item) => item.confidence !== "낮음").slice(0, 2);
  const watchItems = [...(Array.isArray(data.watchItems) ? data.watchItems.map(normalizeItem) : []), ...items.filter((item) => item.confidence === "낮음")].slice(0, 3);
  const freeNotes = Array.isArray(data.freeNotes) ? data.freeNotes.map((item) => {
    const value = item as Record<string, unknown>;
    return { text: String(value?.text ?? ""), factIds: Array.isArray(value?.factIds) ? value.factIds.map(String) : [] };
  }) : [];
  return { headline: String(data.headline ?? ""), strengths, weaknesses, watchItems, freeNotes, nextStep: String(data.nextStep ?? "") };
}

export function readSession(raw: Session): Session {
  return {
    ...raw,
    roundCount: raw.roundCount ?? raw.rounds.length,
    pauses: raw.pauses ?? [],
    feedback: readFeedback(raw.feedback),
  };
}

export const sessionRoundCount = (session: Session) => session.roundCount ?? session.rounds.length;
export const sessionPauses = (session: Session) => session.pauses ?? [];

export function createDesktopSession(session: Omit<Session, "roundCount" | "pauses" | "schemaVersion">, roundCount: number, pauses: PauseInterval[], hintOn = false): Session {
  return { ...session, roundCount, pauses, hintOn, schemaVersion: 4 };
}
