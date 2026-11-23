import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "./ai";

afterEach(() => vi.unstubAllGlobals());

function responseSentences() {
  return [
    ...Array.from({ length: 9 }, (_, i) => ({ text: `${i < 2 ? "뷰뷰" : "뷰"}${i} 빛나는 하루를 천천히 걷는다`, focus: "B(ㅠ) 키 연습" })),
    ...Array.from({ length: 4 }, (_, i) => ({ text: `맑은 바람${i} 따라 들판을 걷는다`, focus: "마음의 여유" })),
  ];
}

function stubGemini() {
  const request = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ sentences: responseSentences() }) }] } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", request);
  return request;
}

describe("AI practice selection", () => {
  it("sends only medium-or-higher weaknesses, selects 7 covered and 3 general sentences, and filters unverified focus", async () => {
    const fetchMock = stubGemini();
    const result = await handleApi("/api/practice", {
      count: 10, baselineMean: 15,
      summary: { weakKeys: [
        { key: "B(ㅠ)", confidence: "중간", n: 20 },
        { key: "A(ㅁ)", confidence: "낮음", n: 10 },
      ] },
      feedback: { weaknesses: [{ title: "A(ㅁ)", confidence: "낮음" }, { title: "B(ㅠ)", confidence: "중간" }] },
    }, { GEMINI_API_KEY: "test-key" });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.contents[0].parts[0].text).toContain('"key":"B(ㅠ)"');
    expect(body.contents[0].parts[0].text).not.toContain('"key":"A(ㅁ)"');
    const response = result.body as { sentences: { text: string; focus?: string }[]; generalPractice: boolean };
    expect(result.status).toBe(200);
    expect(response.sentences).toHaveLength(10);
    expect(response.sentences.filter((sentence) => sentence.focus === "B(ㅠ)")).toHaveLength(7);
    expect(response.sentences.filter((sentence) => sentence.text.startsWith("뷰뷰"))).toHaveLength(2);
    expect(response.sentences.filter((sentence) => !sentence.focus)).toHaveLength(3);
    expect(response.generalPractice).toBe(false);
  });

  it("switches to general practice when there are no medium-or-higher weaknesses", async () => {
    stubGemini();
    const result = await handleApi("/api/practice", {
      count: 10, baselineMean: 15, summary: { weakKeys: [{ key: "B(ㅠ)", confidence: "낮음" }] },
    }, { GEMINI_API_KEY: "test-key" });
    const response = result.body as { sentences: { focus?: string }[]; generalPractice: boolean };
    expect(result.status).toBe(200);
    expect(response.generalPractice).toBe(true);
    expect(response.sentences.every((sentence) => !sentence.focus)).toBe(true);
  });
});
