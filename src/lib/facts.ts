import type { Analysis } from "./stats";
import thresholds from "../../config/thresholds.json";

export type FactBasis = "첫 오입력 기준" | "전체 오입력 기준" | "샘플 분석";
export type Fact = {
  id: string;
  label: string;
  k: number;
  n: number;
  rate: number | null;
  ci: { lower: number; upper: number } | null;
  basis: FactBasis;
  confidence?: string;
};

/** Builds explainable facts from aggregate output only; raw key events are never accepted here. */
export function buildFactList(analysis: Analysis): Fact[] {
  const facts: Fact[] = [];
  const addRate = (label: string, k: number, n: number, basis: FactBasis, confidence?: string, ci: Fact["ci"] = null) => {
    facts.push({
      id: `F${String(facts.length + 1).padStart(2, "0")}`, label, k, n,
      rate: n ? Math.round(k / n * 1000) / 10 : null,
      ci,
      basis,
      ...(confidence ? { confidence } : {}),
    });
  };
  addRate("세션 전체 오입력률", analysis.totals.errs, analysis.totals.presses, "전체 오입력 기준");
  for (const key of analysis.keyStats.filter((row) => row.n >= 5 && row.err > 0)) {
    addRate(`${key.label} 키 오타율`, key.err, key.n, "첫 오입력 기준", key.confidence,
      { lower: Math.round(key.interval.lower * 1000) / 10, upper: Math.round(key.interval.upper * 1000) / 10 });
  }
  facts.push({
    id: `F${String(facts.length + 1).padStart(2, "0")}`, label: "키 간격 중앙값(ms)",
    k: Math.round(analysis.detection.intervals.medianMs ?? 0), n: analysis.detection.intervals.n,
    rate: null, ci: null, basis: "샘플 분석",
  });
  facts.push({
    id: `F${String(facts.length + 1).padStart(2, "0")}`, label: "첫 입력 지연 평균(ms)",
    k: Math.round(analysis.totals.first), n: analysis.rounds.length,
    rate: null, ci: null, basis: "샘플 분석",
  });
  const addMetric = (label: string, k: number, n: number, basis: FactBasis, rate: number | null = null, ci: Fact["ci"] = null) => {
    facts.push({ id: `F${String(facts.length + 1).padStart(2, "0")}`, label, k: Math.round(k * 10) / 10, n, rate: rate === null ? null : Math.round(rate * 10) / 10, ci, basis });
  };
  const addRows = (rows: any[] | undefined, label: (row: any) => string) => {
    for (const row of rows ?? []) {
      const k = Number(row.k ?? row.err ?? 0), n = Number(row.n ?? 0);
      const ci = row.wilson95 ? { lower: Math.round(row.wilson95.lower * 1000) / 10, upper: Math.round(row.wilson95.upper * 1000) / 10 } : null;
      const lower = ci ? ci.lower / 100 : 0;
      const confidence = n >= thresholds.confidence.highMinimumSamples && lower > (analysis as any).sessionErrorRate ? "높음"
        : n >= thresholds.confidence.mediumMinimumSamples && lower > (analysis as any).sessionErrorRate ? "중간" : undefined;
      facts.push({ id: `F${String(facts.length + 1).padStart(2, "0")}`, label: label(row), k, n, rate: n ? Math.round(k / n * 1000) / 10 : null, ci, basis: "첫 오입력 기준", ...(confidence ? { confidence } : {}) });
    }
  };
  for (const key of (analysis as any).slowKeys ?? []) addMetric(`${key.label} 키 중앙 간격(ms)`, key.ms, key.msN, "샘플 분석");
  for (const word of ((analysis as any).slowWords ?? []).slice(0, 5)) addMetric(`느린 어절 ${word.word} (타/분)`, word.kpm, word.keys, "샘플 분석");
  addRows((analysis as any).detection?.fingers, (row) => `${row.key} 손가락 오타율`);
  addRows((analysis as any).detection?.koreanPositions, (row) => `한글 ${row.key} 오타율`);
  addRows((analysis as any).detection?.batchim, (row) => `${row.key} 오타율`);
  if ((analysis as any).detection?.distanceSettings?.status && (analysis as any).detection.distanceSettings.status !== "집계 안 됨") addRows((analysis as any).detection?.distance, (row) => `뻗음 ${row.band} 오타율`);
  const same = (analysis as any).hand?.same;
  const alt = (analysis as any).hand?.alt;
  if (same !== undefined) addMetric("같은 손 연속 간격 중앙값(ms)", same, (analysis as any).hand.sameN ?? 0, "샘플 분석");
  if (alt !== undefined) addMetric("번갈아 입력 간격 중앙값(ms)", alt, (analysis as any).hand.altN ?? 0, "샘플 분석");
  const spaces = (analysis as any).detection?.spaces;
  if (spaces) for (const [key, label] of [["omission", "공백 누락"], ["extra", "공백 초과"], ["position", "공백 위치 오류"]] as const) addMetric(label, spaces[key] ?? 0, spaces.n ?? 0, "첫 오입력 기준");
  const language = (analysis as any).detection?.languageState;
  if (language?.status === "집계됨") {
    const wrong = Number(language.mismatchCount ?? 0);
    const erased = Number(language.removedMismatchCount ?? 0);
    const n = Number(language.n);
    addMetric("한/영 상태 오입력 전체", wrong, n, "첫 오입력 기준", n ? 100 * wrong / n : null);
    addMetric("한/영 상태 오입력 지움", erased, n, "첫 오입력 기준", n ? 100 * erased / n : null);
  }
  const shift = (analysis as any).shiftCombo;
  if (shift) {
    const ci = shift.n ? { lower: Math.round(shift.interval.lower * 1000) / 10, upper: Math.round(shift.interval.upper * 1000) / 10 } : null;
    const confidence = shift.n >= thresholds.confidence.highMinimumSamples && ci!.lower > 100 * (analysis as any).sessionErrorRate ? "높음"
      : shift.n >= thresholds.confidence.mediumMinimumSamples && ci!.lower > 100 * (analysis as any).sessionErrorRate ? "중간" : undefined;
    facts.push({ id: `F${String(facts.length + 1).padStart(2, "0")}`, label: "Shift 조합 오타", k: shift.err, n: shift.n, rate: shift.n ? Math.round(shift.err / shift.n * 1000) / 10 : null, ci, basis: "첫 오입력 기준", ...(confidence ? { confidence } : {}) });
  }
  const correction = (analysis as any).corr;
  if (correction) addMetric("오타 수정 평균 시간(ms)", correction.mean, correction.n, "샘플 분석");
  if (correction) addMetric("수정 중 재오타 횟수", correction.reErr, correction.n, "첫 오입력 기준");
  const unresolved = (analysis as any).detection?.unresolvedTypos;
  if (unresolved) addMetric("고치지 않고 이어서 친 최대 연속 수", unresolved.maximumFollowingKeys, unresolved.status === "집계됨" ? (analysis as any).rounds.length : 0, "샘플 분석");
  const pauses = (analysis as any).pauseMetrics;
  if (pauses) {
    addMetric("일시정지 횟수", pauses.count, (analysis as any).rounds.length, "샘플 분석");
    addMetric("일시정지 총 시간(ms)", pauses.totalMs, pauses.count, "샘플 분석");
  }
  return facts;
}
