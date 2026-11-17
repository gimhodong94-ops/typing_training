import { checkText, computeTags, totalInRange, TOTAL_TOLERANCE } from "../shared/rules";

export type Env = { GEMINI_API_KEY?: string; GEMINI_MODEL?: string };
export type ApiResult = { status: number; body: unknown };

const MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
const API = "https://generativelanguage.googleapis.com/v1beta/models";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Attempt = { done: true; value: unknown } | { done: false; error: string; retriable: boolean };

async function callModel(key: string, model: string, system: string, user: string, temperature: number): Promise<Attempt> {
  let res: Response;
  try {
    res = await fetch(`${API}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    return { done: false, error: "AI 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.", retriable: true };
  }
  const data = (await res.json().catch(() => ({}))) as any;
  if (res.ok) {
    const text: string = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    try {
      return { done: true, value: JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()) };
    } catch {
      return { done: false, error: "AI 답변을 읽지 못했어요. 다시 시도해 주세요.", retriable: true };
    }
  }
  const message: string = data.error?.message ?? `AI 요청이 실패했어요(${res.status}).`;
  if ([400, 401, 403].includes(res.status) && /api key|permission|credential/i.test(message)) {
    throw new ApiError(502, "AI 키가 올바르지 않거나 사용할 수 없어요. 설정을 확인해 주세요.");
  }
  return { done: false, error: message, retriable: [404, 429, 500, 503].includes(res.status) };
}

async function askGemini(env: Env, system: string, user: string, temperature: number): Promise<unknown> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new ApiError(503, "AI 키가 아직 설정되지 않았어요.");
  const models = [...new Set([env.GEMINI_MODEL, ...MODELS].filter(Boolean))] as string[];
  let error = "AI 응답을 받지 못했어요.";
  for (let round = 0; round < 3; round++) {
    if (round > 0) await new Promise((resolve) => setTimeout(resolve, 2500 * round));
    let retriable = false;
    for (const model of models) {
      const result = await callModel(key, model, system, user, temperature);
      if (result.done) return result.value;
      error = result.error;
      retriable ||= result.retriable;
    }
    if (!retriable) break;
  }
  throw new ApiError(502, error);
}

const plain = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/[*#`_>]+/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";

const FEEDBACK_SYSTEM = `당신은 한국어 타자 코치입니다. 사용자의 타자 연습 기록을 요약한 JSON을 보고 약점을 분석해 피드백합니다.

지켜야 할 규칙:
- JSON에 있는 숫자와 사실만 근거로 씁니다. 없는 값은 추측하거나 지어내지 않습니다.
- 표본이 적은 항목(n이 5 미만이거나 라운드가 10 미만)은 단정하지 말고 표본이 적다고 밝힙니다.
- 모든 문장은 해요체입니다. 마크다운 기호(별표, 샵, 목록 기호), 이모지, 영어 약어를 쓰지 않습니다.
- 키 이름은 데이터에 적힌 그대로 씁니다. 예: U(ㅕ), ⇧A(ㅁ). 알파벳을 한글로 음역하지 않습니다. 유, 아이, 비 같은 표기는 금지입니다.
- 손과 손가락은 데이터의 finger, expectedFinger, typedFinger에 적힌 것만 말합니다. 직접 짐작하지 않습니다.
- 칭찬은 데이터로 확인되는 것만 최대 2개. 빈말은 쓰지 않습니다.
- 약점은 영향이 큰 순서로 최대 3개. 오타가 거의 없으면 약점을 1~2개만 쓰고 억지로 채우지 않습니다.
- 시도 횟수 n이 5 미만인 키는 약점 목록에 넣지 않습니다. 필요하면 nextStep에서 표본이 적다고만 언급합니다.
- advice는 오늘 바로 해볼 수 있는 구체적 행동입니다. 어느 손가락으로 칠지, 손을 어디에 두는지, 어떻게 반복 연습하는지처럼 씁니다.

데이터 읽는 법:
- 한글은 두벌식, 영문은 QWERTY입니다. 한글 자모도 같은 키 위치로 칩니다. 키 이름 괄호 안이 그 키의 한글 자모입니다.
- typoPairs의 expected는 눌러야 할 키, typed는 실제로 누른 키입니다. dist는 두 키 사이 거리(키 한 칸 단위), dir은 눌러야 할 키 기준 실제 키의 방향입니다.
- typoTendency의 meanDx는 오른쪽이 +, meanDy는 아래쪽이 +입니다. adjacentPct는 틀린 키가 눌러야 할 키 바로 옆 키였던 비율, repeatPrevPct는 방금 친 키를 또 누른 비율, pressedNextPct는 다음에 칠 키를 먼저 누른 비율입니다.
- errorKinds는 오입력 종류별 횟수입니다. "한/영 상태"는 키는 맞았지만 한글/영문 입력 상태가 문장과 달랐다는 뜻입니다. keys/min은 분당 타수입니다.
- handTransitionMs는 같은 손으로 이어 칠 때와 두 손을 번갈아 칠 때 키 사이 시간(ms)입니다.
- byTag의 tag는 문장 특성이고 kpm이 낮을수록 그 특성의 문장에서 느렸다는 뜻입니다.

반드시 아래 JSON 형식으로만 답합니다.
{"headline":"한 줄 총평(50자 이내)","strengths":["잘한 점"],"weaknesses":[{"title":"약점 제목(15자 이내)","evidence":"근거 숫자를 포함한 설명 1~2문장","advice":"구체적 행동 1~2문장"}],"nextStep":"다음 연습에서 집중할 한 가지(1문장)"}`;

async function feedback(summary: unknown, env: Env): Promise<ApiResult> {
  const raw = (await askGemini(env, FEEDBACK_SYSTEM, `연습 기록 요약:\n${JSON.stringify(summary)}`, 0.4)) as any;
  const weaknesses = (Array.isArray(raw?.weaknesses) ? raw.weaknesses : []).slice(0, 3)
    .map((w: any) => ({ title: plain(w?.title, 30), evidence: plain(w?.evidence, 300), advice: plain(w?.advice, 300) }))
    .filter((w: any) => w.title && w.advice);
  const result = {
    headline: plain(raw?.headline, 120),
    strengths: (Array.isArray(raw?.strengths) ? raw.strengths : []).slice(0, 2).map((s: unknown) => plain(s, 200)).filter(Boolean),
    weaknesses,
    nextStep: plain(raw?.nextStep, 200),
  };
  if (!result.headline && !weaknesses.length) throw new ApiError(502, "AI 답변 형식이 올바르지 않았어요. 다시 시도해 주세요.");
  return { status: 200, body: { feedback: result } };
}

const PRACTICE_SYSTEM = `당신은 한국어 타자 연습 문장을 만드는 작가입니다. 사용자의 약점 데이터를 보고, 그 약점을 집중적으로 연습할 수 있는 문장을 만듭니다.

문장 규칙:
- 자연스러운 한국어 한 문장입니다. 명언, 격언, 일상의 생각처럼 읽히는 내용이고 서로 주제가 겹치지 않습니다.
- 사용 가능한 문자는 한글 완성형, 영문 대소문자, 숫자, 스페이스, 그리고 다음 기호뿐입니다: \` ~ ! @ # $ % ^ & * ( ) - _ = + [ ] { } \\ | ; : ' " , . < > / ?
- 한자, 일본어, 이모지, 줄바꿈, 탭, 특수 따옴표(“ ” ‘ ’), 말줄임표(…), 가운뎃점(·)은 쓰지 않습니다.
- 약점 키의 한글 자모가 들어간 글자를 문장마다 여러 번 넣습니다. 예를 들어 약점 키가 U(ㅕ)이면 '며, 려, 면, 였, 별' 같은 ㅕ가 들어간 글자를 씁니다.
- Shift 관련 오입력이 많으면 영문 대문자나 !, ?, 같은 기호를 문장당 1~2개 자연스럽게 넣습니다. 그렇지 않으면 영문과 숫자는 넣지 않아도 됩니다.
- 같은 손 연타나 타자 속도가 느린 키 조합이 데이터에 있으면 그 키가 이어지는 단어를 넣습니다.
- 모든 문장이 같은 패턴이나 같은 단어로 시작하지 않게 합니다.

반드시 아래 JSON 형식으로만 답합니다.
{"sentences":[{"text":"문장","focus":"이 문장이 연습시키는 약점(15자 이내)"}]}`;

type Candidate = { text: string; focus: string };

function pickSet(pool: Candidate[], count: number, target: number): Candidate[] | null {
  const sum = (list: Candidate[]) => list.reduce((s, c) => s + c.text.length, 0);
  const shuffle = <T,>(list: T[]) => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  for (let n = 0; n < 400; n++) {
    const picked = shuffle(pool).slice(0, count);
    if (picked.length === count && totalInRange(sum(picked), target)) return picked;
  }
  return null;
}

async function practice(body: any, env: Env): Promise<ApiResult> {
  const count = Math.min(Math.max(Math.round(Number(body?.count) || 10), 5), 30);
  const mean = Math.min(Math.max(Number(body?.baselineMean) || 40, 15), 100);
  const target = count * mean;
  const lo = Math.round(target * (1 - TOTAL_TOLERANCE));
  const hi = Math.round(target * (1 + TOTAL_TOLERANCE));
  const pool: Candidate[] = [];
  const seen = new Set<string>();
  let note = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const user = `연습 기록 요약:\n${JSON.stringify(body?.summary ?? {})}\n\n${
      body?.feedback ? `코치가 정리한 약점:\n${JSON.stringify(body.feedback.weaknesses ?? [])}\n\n` : ""
    }문장을 ${count + 3}개 만들어 주세요.
- 문장 한 개의 길이는 ${Math.round(mean * 0.6)}~${Math.round(mean * 1.4)}자(공백과 문장부호 포함)입니다. 평균은 ${Math.round(mean)}자 정도가 되게 합니다.
- ${count}개를 골랐을 때 글자 수 합계가 ${lo}~${hi}자 안에 들어가야 합니다.${note}`;
    const raw = (await askGemini(env, PRACTICE_SYSTEM, user, 0.9)) as any;
    const items: unknown[] = Array.isArray(raw?.sentences) ? raw.sentences : [];
    const problems: string[] = [];
    for (const item of items) {
      const text = plain((item as any)?.text, 200).replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
      if (!text || seen.has(text)) continue;
      const errors = checkText(text);
      if (errors.length) {
        problems.push(`"${text.slice(0, 12)}…": ${errors.join(", ")}`);
        continue;
      }
      seen.add(text);
      pool.push({ text, focus: plain((item as any)?.focus, 30) });
    }
    const set = pickSet(pool, count, target);
    if (set) {
      const stamp = Date.now().toString(36);
      const sentences = set.map((c, i) => ({
        id: `ai_${stamp}_${String(i + 1).padStart(2, "0")}`,
        category: "ai",
        text: c.text,
        tags: computeTags(c.text),
        focus: c.focus,
      }));
      return { status: 200, body: { sentences, attempts: attempt, total: set.reduce((s, c) => s + c.text.length, 0), range: [lo, hi] } };
    }
    note = `\n- 앞선 시도는 조건에 맞지 않았습니다. 사용 가능한 문장은 ${pool.length}개였습니다.${
      problems.length ? ` 규칙 위반 예: ${problems.slice(0, 3).join(" / ")}.` : ""
    } 규칙을 지켜 새 문장을 만들어 주세요.`;
  }
  throw new ApiError(502, `조건에 맞는 문장 ${count}개를 만들지 못했어요. 다시 시도해 주세요.`);
}


export async function handleApi(path: string, body: unknown, env: Env): Promise<ApiResult> {
  try {
    if (JSON.stringify(body ?? {}).length > 60_000) return { status: 413, body: { error: "보낸 데이터가 너무 커요." } };
    const data = (body ?? {}) as any;
    if (path === "/api/feedback") return await feedback(data.summary ?? {}, env);
    if (path === "/api/practice") return await practice(data, env);
    return { status: 404, body: { error: "없는 주소예요." } };
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, body: { error: error.message } };
    return { status: 500, body: { error: "처리 중 문제가 생겼어요. 다시 시도해 주세요." } };
  }
}
