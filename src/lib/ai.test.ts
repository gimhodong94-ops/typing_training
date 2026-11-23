import { describe, expect, it } from "vitest";
import { normalizeFeedback } from "./ai";

describe("AI feedback response normalization", () => {
  it("normalizes a malformed response without optional weakness fields", () => {
    expect(normalizeFeedback({
      headline: 42,
      strengths: ["잘한 점", { text: "꾸준히 입력했어요", evidence: 3 }, null],
      weaknesses: [{ title: "공백", evidence: "근거", advice: "천천히 입력해요" }, null],
    })).toEqual({
      headline: "",
      strengths: [{ text: "잘한 점", evidence: "" }, { text: "꾸준히 입력했어요", evidence: "" }],
      weaknesses: [],
      watchItems: [{ title: "공백", confidence: "낮음", evidence: "근거", factIds: [], possibleCauses: [], checkNext: "", advice: "천천히 입력해요" }],
      freeNotes: [],
      nextStep: "",
    });
  });

  it("returns null for a response that is not an object", () => {
    expect(normalizeFeedback("invalid")).toBeNull();
  });

  it("preserves fact references on strengths", () => {
    expect(normalizeFeedback({ strengths: [{ text: "정확했어요", factIds: ["F01", 3] }] })?.strengths)
      .toEqual([{ text: "정확했어요", evidence: "", factIds: ["F01"] }]);
  });
});
