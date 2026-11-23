import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "./ai";

afterEach(() => vi.unstubAllGlobals());

describe("feedback response shape", () => {
  it("returns structured strengths and complete weaknesses with safe defaults", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        headline: "꾸준히 입력했어요",
        strengths: ["정확하게 쳤어요"],
        weaknesses: [{ title: "한영 전환", evidence: "오류 기록", advice: "키를 확인해요" }],
        nextStep: "천천히 이어서 연습해요",
      }) }] } }],
    }), { status: 200 })));
    const result = await handleApi("/api/feedback", { summary: {} }, { GEMINI_API_KEY: "test-key" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ feedback: {
      strengths: [{ text: "정확하게 쳤어요", evidence: "" }],
      weaknesses: [{ title: "한영 전환", confidence: "낮음", possibleCauses: [], checkNext: "", evidence: "오류 기록", advice: "키를 확인해요" }],
    } });
  });
});
