import { describe, expect, it } from "vitest";
import { confidenceForWeakness, evidenceHasOnlySummaryNumbers } from "./ai";

describe("AI evidence number validation", () => {
  const summary = { weakKeys: [{ n: 23, err: 4, errPct: 17.4, wilson95: { lowerPct: 7.3, upperPct: 36.9 } }] };

  it("accepts summary numbers with one-decimal rounding", () => {
    expect(evidenceHasOnlySummaryNumbers("weakKeys 4 / 23, 17.36% (7.31~36.91)", summary)).toBe(true);
  });

  it("rejects a number that is absent from the summary", () => {
    expect(evidenceHasOnlySummaryNumbers("weakKeys 4 / 23, 99%", summary)).toBe(false);
  });

  it("uses the code-provided confidence value rather than the AI answer", () => {
    expect(confidenceForWeakness(
      { title: "B(ㅠ) 오타", confidence: "낮음", evidence: "B(ㅠ)" },
      { weakKeys: [{ key: "B(ㅠ)", confidence: "높음" }] },
    )).toBe("높음");
  });

  it("does not trust model confidence without a matching key fact", () => {
    expect(confidenceForWeakness({ title: "손목 방향", confidence: "높음" }, { weakKeys: [] })).toBe("낮음");
  });
});
