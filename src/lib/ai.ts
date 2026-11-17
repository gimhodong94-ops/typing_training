import type { Feedback } from "./types";
import type { Sentence } from "./sentences";

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("서버에 연결하지 못했어요. 네트워크를 확인해 주세요.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "요청에 실패했어요. 잠시 뒤 다시 시도해 주세요.");
  return data as T;
}

export const requestFeedback = (summary: unknown) =>
  post<{ feedback: Feedback }>("/api/feedback", { summary }).then((r) => r.feedback);

export const requestPractice = (summary: unknown, feedback: Feedback | undefined, count: number, baselineMean: number) =>
  post<{ sentences: Sentence[] }>("/api/practice", { summary, feedback, count, baselineMean }).then((r) => r.sentences);
