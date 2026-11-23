import { describe, expect, it } from "vitest";
import { buildFactList } from "./facts";
import type { Analysis } from "./stats";

describe("AI fact list", () => {
  it("marks bases, omits prohibited direction metrics, and gives n<5 facts no weakness confidence", () => {
    const analysis = {
      totals: { presses: 100, errs: 7, first: 480 },
      keyStats: [
        { label: "D(ㅇ)", n: 10, err: 2, confidence: "중간", interval: { lower: 0.05, upper: 0.40 } },
        { label: "C(ㅊ)", n: 4, err: 2, confidence: "낮음", interval: { lower: 0.1, upper: 0.7 } },
      ],
      detection: {
        fingers: [{ key: "왼손 중지", n: 4, k: 1, wilson95: { lower: 0.04, upper: 0.62 } }],
        intervals: { n: 8, medianMs: 210 },
      },
      rounds: Array.from({ length: 10 }, () => ({})),
    } as unknown as Analysis;

    const facts = buildFactList(analysis);
    expect(facts.map((fact) => fact.basis)).toContain("전체 오입력 기준");
    expect(facts.map((fact) => fact.basis)).toContain("첫 오입력 기준");
    expect(facts.map((fact) => fact.basis)).toContain("샘플 분석");
    expect(facts.find((fact) => fact.label.startsWith("C(ㅊ)"))).toBeUndefined();
    const smallFact = facts.find((fact) => fact.label === "왼손 중지 손가락 오타율");
    expect(smallFact?.n).toBe(4);
    expect(smallFact?.confidence).toBeUndefined();
    expect(JSON.stringify(facts)).not.toMatch(/meanDx|pressedNextPct|repeatPrevPct|directionMaxKeyDistance|고정 2칸/);
  });
});
