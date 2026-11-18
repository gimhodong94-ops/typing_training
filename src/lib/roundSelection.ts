import type { Sentence } from "./sentences";
import type { Session } from "./types";

export const MAX_ROUND_ATTEMPTS = 1000;
export const ROUND_TOLERANCE = 0.3;

export function isSentenceLengthAllowed(text: string) {
  const limit = /[\uAC00-\uD7A3]/.test(text) ? 100 : 150;
  return text.length <= limit;
}

export function sentenceUseCounts(sessions: Session[]) {
  const counts: Record<string, number> = {};
  for (const session of sessions) {
    for (const round of session.rounds) counts[round.text] = (counts[round.text] ?? 0) + 1;
  }
  return counts;
}

export type RoundSelection = {
  rounds: Sentence[];
  count: number;
  averageLength: number;
  targetTotal: number;
  minimumTotal: number;
  maximumTotal: number;
  totalLength: number;
  attempts: number;
  withinRange: boolean;
  usedFallback: boolean;
  error?: string;
};

const totalLength = (rows: Sentence[]) => rows.reduce((sum, row) => sum + row.text.length, 0);

function prioritizeLowUse(rows: Sentence[], usage: Record<string, number>, random: () => number) {
  const buckets = new Map<number, Sentence[]>();
  for (const row of rows) {
    const uses = usage[row.text] ?? usage[row.id] ?? 0;
    const bucket = buckets.get(uses) ?? [];
    bucket.push(row);
    buckets.set(uses, bucket);
  }
  const ordered: Sentence[] = [];
  for (const uses of [...buckets.keys()].sort((a, b) => a - b)) {
    const bucket = buckets.get(uses)!;
    for (let i = bucket.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [bucket[i], bucket[j]] = [bucket[j], bucket[i]];
    }
    ordered.push(...bucket);
  }
  return ordered;
}

export function createRoundSelection(
  rows: Sentence[],
  count: number,
  usage: Record<string, number> = {},
  random: () => number = Math.random,
  maxAttempts = MAX_ROUND_ATTEMPTS,
): RoundSelection {
  const averageLength = rows.reduce((sum, row) => sum + row.text.length, 0) / Math.max(rows.length, 1);
  const targetTotal = averageLength * count;
  const minimumTotal = targetTotal * (1 - ROUND_TOLERANCE);
  const maximumTotal = targetTotal * (1 + ROUND_TOLERANCE);
  const unique = new Map<string, Sentence>();
  for (const row of rows) if (isSentenceLengthAllowed(row.text) && !unique.has(row.text)) unique.set(row.text, row);
  const eligible = [...unique.values()];
  if (eligible.length < count) {
    return {
      rounds: [], count, averageLength, targetTotal, minimumTotal, maximumTotal,
      totalLength: 0, attempts: 0, withinRange: false, usedFallback: false,
      error: `길이 기준을 통과한 문장이 ${eligible.length}개라 ${count}라운드를 만들 수 없어요.`,
    };
  }

  let best: Sentence[] = [];
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = prioritizeLowUse(eligible, usage, random).slice(0, count);
    const sum = totalLength(candidate);
    const diff = Math.abs(sum - targetTotal);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
    if (sum >= minimumTotal && sum <= maximumTotal) {
      return { rounds: candidate, count, averageLength, targetTotal, minimumTotal, maximumTotal, totalLength: sum, attempts: attempt, withinRange: true, usedFallback: false };
    }
  }
  const total = totalLength(best);
  return { rounds: best, count, averageLength, targetTotal, minimumTotal, maximumTotal, totalLength: total, attempts: maxAttempts, withinRange: false, usedFallback: true };
}

export function sessionUsageFromHistory(history: Session[]) {
  return sentenceUseCounts(history);
}
