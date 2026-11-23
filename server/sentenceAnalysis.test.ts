import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "./ai";

afterEach(() => vi.unstubAllGlobals());

describe("Gemini sentence analysis endpoint", () => {
  it("accepts only eligible aggregate sentence payload and validates the response schema", async () => {
    let sent = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent = String(init.body ?? "");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ analyses: [
        { roundId: "r1", kind: "omission", summary: "입력 흐름을 확인해요", evidence: "집계된 오타 근거", questions: [{ id: "q1", prompt: "어떤 부분이 어려웠나요?", checkMethod: "다음 입력을 살펴봐요." }, { id: "q2", prompt: "다시 칠 때 무엇을 확인했나요?", checkMethod: "천천히 입력해 봐요." }, { id: "q3", prompt: "잘리면 안 돼요", checkMethod: "확인" }] },
        { roundId: "not-sent", kind: "other", summary: "가짜", evidence: "가짜" },
        { roundId: "r1", kind: "other", summary: "손목 통증 때문이에요", evidence: "의학적 추측" },
      ] }) }] } }] }), { status: 200 });
    }));
    const result = await handleApi("/api/sentence-analysis", { rounds: [
      { roundId: "r1", text: "선별된 문장", errorRate: 0.04, firstErrorEpisodes: 2 },
      { roundId: "r2", text: "너무 낮은 오타율", errorRate: 0.01, firstErrorEpisodes: 3 },
      { roundId: "r3", text: "에피소드 부족", errorRate: 0.1, firstErrorEpisodes: 1 },
    ] }, { GEMINI_API_KEY: "test-key" });
    expect(result.status).toBe(200);
    expect((result.body as any).analyses).toHaveLength(1);
    expect((result.body as any).model).toBe("gemini-3.8-flash");
    expect((result.body as any).analyses[0].questions).toHaveLength(2);
    expect(sent).toContain("선별된 문장");
    expect(sent).not.toContain("너무 낮은 오타율");
    expect(sent).not.toContain("에피소드 부족");
    expect(sent).not.toContain("rawEvents");
  });

  it("falls through the free Gemini models when they all hit quota", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleApi("/api/sentence-analysis", { rounds: [{ roundId: "r1", text: "문장", errorRate: 0.05, firstErrorEpisodes: 2 }] }, { GEMINI_API_KEY: "test-key" });
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: "Gemini 사용 한도에 도달했어요. 나중에 다시 시도해 주세요" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses the next model when the preferred model is overloaded and reports the model used", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const model = String(url).split("/models/")[1].split(":")[0];
      if (model === "gemini-3.8-flash") return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ analyses: [] }) }] } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleApi("/api/sentence-analysis", { rounds: [{ roundId: "r1", text: "문장", errorRate: 0.05, firstErrorEpisodes: 2 }] }, { GEMINI_API_KEY: "test-key" });
    expect(result.status).toBe(200);
    expect((result.body as any).model).toBe("gemini-3.6-flash");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not call Gemini when there are no eligible rounds", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const result = await handleApi("/api/sentence-analysis", { rounds: [{ roundId: "r1", text: "문장", errorRate: 0.01, firstErrorEpisodes: 2 }] }, { GEMINI_API_KEY: "test-key" });
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
