import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi, validFeedbackSentence, validFeedbackText } from "./ai";

afterEach(() => vi.unstubAllGlobals());

describe("feedback response shape", () => {
  it("rejects empty placeholders, symbols, and meta sentences", () => {
    expect(validFeedbackText("전체 오입력률은 %이며요.")).toBe(false);
    expect(validFeedbackText("(/)")).toBe(false);
    expect(validFeedbackText("수치는 {F01.rate}예요.")).toBe(false);
    expect(validFeedbackSentence("잘한 점을 정리했어요.")).toBe(false);
    expect(validFeedbackText("수치 %예요.")).toBe(false);
  });
  it("uses a code-rendered grounded headline when the AI leaves an empty percent placeholder", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      headline: "전체 오입력률은 %이며", strengths: [], weaknesses: [], nextStep: "계속 연습해요",
    }) }] } }] }), { status: 200 })));
    const result = await handleApi("/api/feedback", { summary: { facts: [
      { id: "F01", label: "세션 전체 오입력률", k: 3, n: 860, rate: 0.3, basis: "전체 오입력 기준" },
    ] } }, { GEMINI_API_KEY: "test-key" });
    expect(result.status).toBe(200);
    expect((result.body as any).feedback.headline).toBe("문자 시도 860번 중 오입력 3번이 기록됐어요.");
  });
  it("reports Gemini quota exhaustion immediately without retrying other models", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: "Resource has been exhausted (e.g. check quota)." },
    }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleApi("/api/feedback", { summary: {} }, { GEMINI_API_KEY: "test-key" });

    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: "Gemini 사용 한도에 도달했어요. 나중에 다시 시도해 주세요" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps verified sentence analysis and skipped answers available to feedback without raw events", async () => {
    let sent = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent = String(init.body ?? "");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ headline: "연습을 이어가요", strengths: [], weaknesses: [], nextStep: "천천히 해요", watchList: [] }) }] } }] }), { status: 200 });
    }));
    await handleApi("/api/feedback", { summary: { facts: [], weaknessEligibility: { canDiagnose: false }, sentenceAnalyses: [{ roundId: "r1", kind: "space", summary: "공백 위치를 확인해요", evidence: "집계 결과", questions: [{ id: "q1" }] }], answers: [{ questionId: "q1", answer: "건너뜀" }], rawEvents: [{ code: "KeyX" }] } }, { GEMINI_API_KEY: "test-key" });
    const text = JSON.parse(sent).contents[0].parts[0].text;
    expect(text).toContain("공백 위치를 확인해요");
    expect(text).toContain("건너뜀");
    expect(text).not.toContain("rawEvents");
    expect(text).not.toContain("KeyX");
  });

  it("does not let a rejected topic become a weakness and keeps confidence code-derived", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      headline: "연습을 이어가요", strengths: [],
      weaknesses: [{ title: "Shift 오타", factIds: ["F01"], possibleCauses: ["가능성 하나", "가능성 둘"], advice: "연습해요" }],
      nextStep: "이어가요",
    }) }] } }] }), { status: 200 })));
    const result = await handleApi("/api/feedback", { summary: {
      weaknessEligibility: { canDiagnose: true, matchingSessions: 3 },
      facts: [{ id: "F01", label: "Shift 오타율", k: 4, n: 30, rate: 13.3, ci: { lower: 4, upper: 30 }, basis: "첫 오입력 기준", confidence: "높음" }],
      sentenceAnalyses: [{ roundId: "r1", kind: "shift", summary: "Shift 오타 주제", evidence: "검증된 분석", questions: [{ id: "q1" }] }],
      answers: [{ questionId: "q1", answer: "아니에요" }],
    } }, { GEMINI_API_KEY: "test-key" });
    expect((result.body as any).feedback.weaknesses).toEqual([]);
    expect((result.body as any).feedback.headline).toBe("연습을 이어가요");
  });

  it("does not change code-derived confidence when the user confirms a question", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      headline: "연습을 이어가요", strengths: [], weaknesses: [{ title: "D(ㅇ) 키 오타", factIds: ["F01"], possibleCauses: ["가능성 하나", "가능성 둘"], advice: "연습해요" }], nextStep: "이어가요",
    }) }] } }] }), { status: 200 })));
    const result = await handleApi("/api/feedback", { summary: {
      weaknessEligibility: { canDiagnose: true, matchingSessions: 3 },
      facts: [{ id: "F01", label: "D(ㅇ) 키 오타율", k: 5, n: 30, rate: 16.7, ci: { lower: 7, upper: 33 }, basis: "첫 오입력 기준", confidence: "중간" }],
      answers: [{ questionId: "q1", answer: "맞아요" }],
    } }, { GEMINI_API_KEY: "test-key" });
    expect((result.body as any).feedback.weaknesses[0].confidence).toBe("중간");
  });

  it("sends only aggregate facts and baseline eligibility to the feedback model", async () => {
    let sent = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent = String(init.body ?? "");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ headline: "연습을 이어가요", strengths: [], weaknesses: [], nextStep: "이어가요", watchList: [] }) }] } }] }), { status: 200 });
    }));
    await handleApi("/api/feedback", { summary: {
      facts: [{ id: "F01", label: "세션 전체 오입력률", k: 2, n: 100, rate: 2, ci: null, basis: "전체 오입력 기준" }],
      weaknessEligibility: { canDiagnose: false, matchingSessions: 1 },
      typoTendency: { meanDx: 9, repeatPrevPct: 32 }, rawEvents: [{ code: "KeyD" }],
    } }, { GEMINI_API_KEY: "test-key" });
    const userInput = JSON.parse(sent).contents[0].parts[0].text;
    expect(userInput).toContain("F01");
    expect(userInput).not.toContain("meanDx");
    expect(userInput).not.toContain("repeatPrevPct");
    expect(userInput).not.toContain("rawEvents");
    expect(userInput).not.toContain("KeyD");
  });

  it("returns structured strengths and complete weaknesses with safe defaults", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        headline: "꾸준히 입력했어요",
        strengths: [{ text: "정확하게 쳤어요", factIds: ["F01"] }],
        weaknesses: [{ title: "D(ㅇ) 오타", factIds: ["F01"], possibleCauses: ["집중 차이일 수 있어요", "키가 익숙하지 않을 수 있어요"], advice: "키를 확인해요" }],
        nextStep: "천천히 이어서 연습해요",
      }) }] } }],
    }), { status: 200 })));
    const summary = {
      weaknessEligibility: { canDiagnose: true, matchingSessions: 3, requiredSessions: 3 },
      weakKeys: [{ key: "D(ㅇ)", n: 30, err: 5, errPct: 16.7, confidence: "중간" }],
      facts: [{ id: "F01", label: "D(ㅇ) 키 오타율", k: 5, n: 30, rate: 16.7, ci: { lower: 7, upper: 33 }, basis: "첫 오입력 기준", confidence: "중간" }],
    };
    const result = await handleApi("/api/feedback", { summary }, { GEMINI_API_KEY: "test-key" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ feedback: {
      strengths: [{ text: "정확하게 쳤어요", evidence: "", factIds: ["F01"] }],
      weaknesses: [{ title: "D(ㅇ) 오타", confidence: "중간", possibleCauses: ["집중 차이일 수 있어요", "키가 익숙하지 않을 수 있어요"], checkNext: "", evidence: "", factIds: ["F01"], advice: "키를 확인해요" }],
      watchItems: [],
    } });
  });

  it("limits confirmed weakness cards to two and keeps low-confidence items as watch items", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        headline: "몇 개의 키에서 오타가 보였어요",
        strengths: [],
        weaknesses: [
          { title: "D(ㅇ) 오타", factIds: ["F01"], possibleCauses: ["집중 차이일 수 있어요", "키가 익숙하지 않을 수 있어요"], advice: "연습해요" },
          { title: "E(ㄷ) 오타", factIds: ["F02"], possibleCauses: ["집중 차이일 수 있어요", "키가 익숙하지 않을 수 있어요"], advice: "연습해요" },
          { title: "C(ㅊ) 오타", factIds: ["F03"], possibleCauses: ["집중 차이일 수 있어요", "키가 익숙하지 않을 수 있어요"], advice: "연습해요" },
        ],
        nextStep: "이어가요",
      }) }] } }],
    }), { status: 200 })));
    const weakKeys = [
      { key: "D(ㅇ)", confidence: "높음", n: 30, err: 4 },
      { key: "E(ㄷ)", confidence: "중간", n: 30, err: 3 },
      { key: "C(ㅊ)", confidence: "낮음", n: 9, err: 1 },
    ];
    const result = await handleApi("/api/feedback", { summary: {
      weaknessEligibility: { canDiagnose: true, matchingSessions: 3 }, weakKeys,
      facts: [
        { id: "F01", label: "D(ㅇ) 키 오타율", k: 4, n: 30, rate: 13.3, ci: { lower: 4, upper: 30 }, basis: "첫 오입력 기준", confidence: "높음" },
        { id: "F02", label: "E(ㄷ) 키 오타율", k: 3, n: 30, rate: 10, ci: { lower: 2, upper: 25 }, basis: "첫 오입력 기준", confidence: "중간" },
        { id: "F03", label: "C(ㅊ) 키 오타율", k: 1, n: 9, rate: 11, ci: { lower: 1, upper: 40 }, basis: "첫 오입력 기준", confidence: "낮음" },
      ],
    } }, { GEMINI_API_KEY: "test-key" });
    expect((result.body as any).feedback.weaknesses).toHaveLength(2);
    expect((result.body as any).feedback.watchItems).toHaveLength(1);
    expect((result.body as any).feedback.watchItems[0].confidence).toBe("낮음");
  });

  it("suppresses all weakness cards until three matching-session baseline exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        headline: "연습을 이어가요",
        strengths: [],
        weaknesses: [{ title: "D(ㅇ) 오타", factIds: ["F01"], possibleCauses: ["집중 차이일 수 있어요", "키가 익숙하지 않을 수 있어요"], advice: "연습해요" }],
        nextStep: "꾸준히 쳐요",
      }) }] } }],
    }), { status: 200 })));
    const result = await handleApi("/api/feedback", { summary: { weaknessEligibility: { canDiagnose: false }, weakKeys: [], facts: [] } }, { GEMINI_API_KEY: "test-key" });
    expect((result.body as any).feedback.weaknesses).toEqual([]);
    expect((result.body as any).feedback.watchItems).toEqual([]);
    expect((result.body as any).feedback.nextStep).toContain("3번 더");
  });
});
