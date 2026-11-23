import { describe, expect, it } from "vitest";
import { capSessionQuestions, chunkSentenceAnalysis, selectSentenceAnalysisRounds, shouldSendSentenceAnalysis, validateSentenceAnalysis } from "./sentenceAnalysis";
import type { Session } from "./types";

function session(count: number, tweak?: (events: any[], index: number) => void): Session {
  return { id: 1, at: "2026-11-23T00:00:00.000Z", keyboard: "desktop", rounds: Array.from({ length: count }, (_, index) => {
    const events: any[] = Array.from({ length: 100 }, (_, i) => ({ t: i, code: "KeyA", kind: "char" as const, pos: i, shift: false, caps: false, ok: true }));
    events[0] = { ...events[0], ok: false, err: "다른 키", episodeId: 1, episodeRole: "first" };
    events[1] = { ...events[1], ok: false, err: "다른 키", episodeId: 2, episodeRole: "first" };
    tweak?.(events, index);
    return { id: `r${index + 1}`, text: `문장 ${index + 1}`, events };
  }) };
}

describe("sentence analysis selection and validation", () => {
  it.each([10, 20, 30])("selects at most three eligible sentences per ten-round block (%i rounds)", (count) => {
    const selected = selectSentenceAnalysisRounds(session(count));
    expect(selected).toHaveLength(Math.ceil(count / 10) * 3);
    for (let block = 0; block < count / 10; block++) expect(selected.filter((row) => Math.floor((row.roundIndex - 1) / 10) === block)).toHaveLength(3);
  });

  it("never selects a localStorage-only history record for sentence analysis", () => {
    expect(selectSentenceAnalysisRounds({ ...session(10), isLocalStorageOnly: true })).toEqual([]);
  });

  it("excludes error rate below 2%, one episode, and omission cascades with one first error", () => {
    const input = session(10, (events, index) => {
      if (index === 0) {
        events[0] = { ...events[0], ok: true, err: undefined, episodeId: undefined, episodeRole: undefined };
        events[1] = { ...events[1], ok: true, err: undefined, episodeId: undefined, episodeRole: undefined };
      }
      if (index === 1) events[1] = { ...events[1], ok: false, err: "다른 키", episodeId: 1, episodeRole: "cascade" };
    });
    expect(selectSentenceAnalysisRounds(input).map((row) => row.roundIndex)).not.toContain(1);
    expect(selectSentenceAnalysisRounds(input).map((row) => row.roundIndex)).not.toContain(2);
  });

  it("caps requests at two groups of five", () => {
    expect(chunkSentenceAnalysis(Array.from({ length: 12 }, (_, i) => i))).toEqual([[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]]);
  });
  it("caps questions across the entire session at five", () => {
    const rows = capSessionQuestions(Array.from({ length: 4 }, (_, i) => ({ questions: Array.from({ length: 2 }, (_, j) => `${i}-${j}`) })));
    expect(rows.flatMap((row) => row.questions)).toHaveLength(5);
  });

  it("does not send without consent, when disabled, or without a Gemini key", () => {
    expect(shouldSendSentenceAnalysis({ enabled: true, consent: false, provider: "gemini", hasKey: true })).toBe(false);
    expect(shouldSendSentenceAnalysis({ enabled: false, consent: true, provider: "gemini", hasKey: true })).toBe(false);
    expect(shouldSendSentenceAnalysis({ enabled: true, consent: true, provider: "gemini", hasKey: false })).toBe(false);
    expect(shouldSendSentenceAnalysis({ enabled: true, consent: true, provider: "multi-ai", hasKey: true })).toBe(false);
    expect(shouldSendSentenceAnalysis({ enabled: true, consent: true, provider: "gemini", hasKey: true })).toBe(true);
  });

  it("drops unknown rounds, missing kinds, injected numbers and health claims and caps questions", () => {
    const result = validateSentenceAnalysis({ analyses: [
      { roundId: "r1", kind: "other", summary: "잘 입력했어요 {errorCount}", evidence: "검증된 집계 {round}", questions: Array.from({ length: 4 }, (_, i) => ({ id: `q${i}`, prompt: "다음에는 어떻게 느꼈나요?", checkMethod: "다음 연습에서 확인해요." })) },
      { roundId: "absent", kind: "other", summary: "문장", evidence: "증거" },
      { roundId: "r1", summary: "종류 누락", evidence: "증거" },
      { roundId: "r1", kind: "other", summary: "손목 통증이 있어요", evidence: "증거" },
      { roundId: "r1", kind: "other", summary: "오타율 30%예요", evidence: "증거" },
      { roundId: "r1", kind: "other", summary: "", evidence: "증거", questions: [{ id: "missing", prompt: "질문" }] },
    ] }, new Set(["r1"]));
    expect(result).toHaveLength(1);
    expect(result[0].questions).toHaveLength(2);
    expect(result[0].questions.map((question: { id: string }) => question.id)).toEqual(["r1-q0", "r1-q1"]);
  });
});
