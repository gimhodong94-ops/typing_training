import { DEFAULT_WRISTS, KEYPOS, direction, fingerOf, handOf, keyLabel, keysForText } from "./keyboard";
import { calculatePauseMetrics, crossesPauseBoundary } from "./pauseMetrics";
import type { RoundRecord, Session } from "./types";
import thresholds from "../../config/thresholds.json";
import { analyzeDetection } from "./detection";
import { computeTags } from "../../shared/rules";
import { josa } from "./grammar";
import { buildFactList } from "./facts";

export type RoundStat = {
  i: number;
  id: string;
  text: string;
  tags: string[];
  keys: number;
  kpm: number;
  cpm: number;
  ms: number;
  first: number;
  presses: number;
  errs: number;
  backspaces: number;
  words: { word: string; keys: number; ms: number; kpm: number }[];
  corrections: number[];
  reErr: number;
};

const mean = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function wilsonInterval(k: number, n: number, z = 1.96) {
  if (n <= 0) return { lower: 0, upper: 0 };
  const p = k / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator;
  return { lower: center - half, upper: center + half };
}

function isShiftComboEvent(event: RoundRecord["events"][number]) {
  const target = event.targetKey ?? event.exp;
  return !!target && ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyO", "KeyP"].includes(target) &&
    ((event.targetShift ?? event.expShift ?? false) || (event.typedShift ?? event.shift));
}

function replay(r: RoundRecord) {
  const stack: { t: number; ok: boolean }[] = [];
  const corrections: number[] = [];
  const corrected = new Set<number>();
  const pending = new Set<number>();
  let errSince: number | null = null;
  let reErr = 0;
  for (const e of r.events) {
    if (e.kind === "char") {
      stack.push({ t: e.t, ok: !!e.ok });
      if (!e.ok) {
        if (errSince === null) errSince = e.t;
        if (corrected.has(e.pos)) reErr++;
        pending.add(e.pos);
      }
    } else if (e.kind === "backspace") {
      stack.pop();
      if (errSince !== null && stack.every((s) => s.ok)) {
        corrections.push(e.t - errSince);
        pending.forEach((p) => corrected.add(p));
        pending.clear();
        errSince = null;
      }
    }
  }
  return { fill: stack.map((s) => s.t), corrections, reErr };
}

function summarizeRound(r: RoundRecord, i: number): RoundStat {
  const exp = keysForText(r.text);
  const { fill, corrections, reErr } = replay(r);
  const firstT = r.events.length ? r.events[0].t : 0;
  const endT = fill.length ? fill[fill.length - 1] : firstT;
  const ms = Math.max(endT - firstT, 1);
  const chars = r.events.filter((e) => e.kind === "char" || e.kind === "overflow");
  const errs = r.events.filter((e) => (e.kind === "char" || e.kind === "overflow") && e.err).length;
  const words: RoundStat["words"] = [];
  let start = 0;
  let prevFill = firstT;
  const chunks = [...r.text].map((c, ci) => ({ c, ci }));
  const ends = chunks.filter(({ c }) => c === " " || c === "\n").map(({ ci }) => ci);
  ends.push(r.text.length - 1);
  [...new Set(ends)].forEach((endChar) => {
    const startPos = exp.findIndex((k) => k.ch >= start);
    let endPos = exp.length;
    for (let p = exp.length - 1; p >= 0; p--) if (exp[p].ch > endChar) endPos = p;
    if (startPos < 0 || endPos <= startPos || !fill[endPos - 1]) return;
    const took = fill[endPos - 1] - prevFill;
    if (took > 0) {
      const keys = endPos - startPos;
      words.push({ word: r.text.slice(start, endChar + 1).trim(), keys, ms: took, kpm: (keys * 60000) / took });
    }
    prevFill = fill[endPos - 1];
    start = endChar + 1;
  });
  return {
    i, id: r.id, text: r.text, tags: computeTags(r.text), keys: exp.length,
    kpm: (exp.length * 60000) / ms, cpm: (r.text.length * 60000) / ms, ms, first: firstT,
    presses: chars.length, errs, backspaces: r.events.filter((e) => e.kind === "backspace").length,
    words, corrections, reErr,
  };
}

export function analyze(session: Session) {
  const wrists = session.wristAnchors ?? DEFAULT_WRISTS;
  const pauseMetrics = calculatePauseMetrics(session);
  const rounds = session.rounds.map(summarizeRound);
  const events = session.rounds.flatMap((r) => r.events);
  const presses = rounds.reduce((s, r) => s + r.presses, 0);
  const errEvents = events.filter((e) => (e.kind === "char" || e.kind === "overflow") && e.err);
  const totalMs = rounds.reduce((s, r) => s + r.ms, 0);
  const totalKeys = rounds.reduce((s, r) => s + r.keys, 0);
  const accuracyAttempts = events.filter((event) => event.kind === "char" || event.kind === "overflow");
  const wrongEraseEvents = events.filter((event) => event.kind === "backspace" && event.removedWasCorrect === true && event.removedNeeded === false);
  const accuracyHasEraseData = events.every((event) => event.kind !== "backspace" || event.removedWasCorrect !== undefined);
  const accuracyErrors = accuracyAttempts.filter((event) => event.ok === false || !!event.err).length;
  const accuracyA = accuracyAttempts.length ? 100 * (accuracyAttempts.length - accuracyErrors) / accuracyAttempts.length : 100;
  const accuracyB = accuracyHasEraseData
    ? (accuracyAttempts.length + wrongEraseEvents.length
      ? 100 * (1 - (accuracyErrors + wrongEraseEvents.length) / (accuracyAttempts.length + wrongEraseEvents.length))
      : 100)
    : undefined;
  const totals = {
    kpm: totalMs ? (totalKeys * 60000) / totalMs : 0,
    cpm: totalMs ? (rounds.reduce((s, r) => s + r.text.length, 0) * 60000) / totalMs : 0,
    acc: accuracyA,
    accuracyA,
    accuracyB,
    wrongErase: wrongEraseEvents.length,
    first: mean(rounds.map((r) => r.first)),
    errs: accuracyErrors,
    presses,
    backspaces: rounds.reduce((s, r) => s + r.backspaces, 0),
    seconds: totalMs / 1000,
  };
  const sessionErrorRate = presses ? accuracyErrors / presses : 0;

  const byKind: Record<string, number> = {};
  errEvents.forEach((e) => (byKind[e.err!] = (byKind[e.err!] ?? 0) + 1));

  const keys: Record<string, { n: number; err: number; msList: number[] }> = {};
  const hand = { same: [] as number[], alt: [] as number[] };
  const shiftJamoCodes = new Set(["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyO", "KeyP"]);
  session.rounds.forEach((r) =>
    r.events.forEach((e, idx) => {
      if (e.kind !== "char" || !e.exp || (e.err && e.episodeRole === "cascade")) return;
      if (isShiftComboEvent(e)) return;
      const k = (keys[e.exp] ??= { n: 0, err: 0, msList: [] });
      k.n++;
      if (!e.ok) k.err++;
      const prev = r.events[idx - 1];
      const pauseBoundary = !!prev && crossesPauseBoundary(prev, e);
      if (e.ok && prev && prev.kind === "char" && prev.ok && prev.exp && !isShiftComboEvent(prev) && !isShiftComboEvent(e) && !pauseBoundary && e.t - prev.t <= 2500) {
        k.msList.push(e.t - prev.t);
        const a = handOf(prev.exp, wrists);
        const b = handOf(e.exp, wrists);
        if (a && b && prev.exp !== e.exp) (a === b ? hand.same : hand.alt).push(e.t - prev.t);
      }
    }),
  );

  const pairMap = new Map<string, { exp: string; act: string; n: number; dist: number[]; dx: number[]; dy: number[] }>();
  const firstErrors = errEvents.filter((e) => e.episodeRole !== "cascade");
  const other = firstErrors.filter((e) => e.kind === "char" && e.exp && e.exp !== e.code && !isShiftComboEvent(e));
  const adjacentErrors = other.filter((event) => {
    const from = KEYPOS[event.exp!], to = KEYPOS[event.code];
    return !!from && !!to && handOf(event.code, wrists) === handOf(event.exp!, wrists) &&
      !!handOf(event.exp!, wrists) &&
      Math.hypot(to.x - from.x, to.y - from.y) <= thresholds.detection.directionMaxKeyDistance;
  });
  const handTypos = {
    left: adjacentErrors.filter((e) => handOf(e.exp!, wrists) === "L"),
    right: adjacentErrors.filter((e) => handOf(e.exp!, wrists) === "R"),
  };
  const towardWristPct = (rows: typeof other, wrist: { x: number; y: number }) => pct(rows.filter((e) => {
    const target = KEYPOS[e.exp!];
    const dx = e.dx ?? 0;
    const dy = e.dy ?? 0;
    return dx * (wrist.x - target.x) + dy * (wrist.y - target.y) > 0;
  }).length, rows.length);
  const medianOrUndefined = (values: number[]) => values.length ? median(values) : undefined;
  const typoByHand = {
    left: {
      n: handTypos.left.length,
      medianDx: medianOrUndefined(handTypos.left.map((e) => e.dx ?? 0)),
      medianDy: medianOrUndefined(handTypos.left.map((e) => e.dy ?? 0)),
      towardWristPct: towardWristPct(handTypos.left, wrists.left),
    },
    right: {
      n: handTypos.right.length,
      medianDx: medianOrUndefined(handTypos.right.map((e) => e.dx ?? 0)),
      medianDy: medianOrUndefined(handTypos.right.map((e) => e.dy ?? 0)),
      towardWristPct: towardWristPct(handTypos.right, wrists.right),
    },
  };
  other.forEach((e) => {
    const id = `${e.exp}>${e.code}`;
    const p = pairMap.get(id) ?? { exp: e.exp!, act: e.code, n: 0, dist: [], dx: [], dy: [] };
    p.n++;
    p.dist.push(Math.hypot(e.dx ?? 0, e.dy ?? 0));
    p.dx.push(e.dx ?? 0);
    p.dy.push(e.dy ?? 0);
    pairMap.set(id, p);
  });
  const pairs = [...pairMap.values()]
    .filter((pair) => pair.n >= thresholds.weakKeyMinimumSamples)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .map((p) => ({
      exp: keyLabel(p.exp), act: keyLabel(p.act), expCode: p.exp, actCode: p.act, n: p.n, dist: mean(p.dist), dir: direction(median(p.dx), median(p.dy)),
    }));

  const withVec = adjacentErrors.filter((e) => e.dx !== undefined);
  const dirStat = {
    n: withVec.length,
    mx: median(withVec.map((e) => e.dx!)),
    my: median(withVec.map((e) => e.dy!)),
    adjacent: pct(withVec.length, other.length),
    next: pct(adjacentErrors.filter((e) => e.isNext).length, adjacentErrors.length),
    sameHand: pct(other.filter((e) => handOf(e.code, wrists) && handOf(e.code, wrists) === handOf(e.exp!, wrists)).length, other.length),
  };

  const allCorr = rounds.flatMap((r) => r.corrections);
  const corr = {
    n: allCorr.length,
    mean: mean(allCorr),
    reErr: rounds.reduce((s, r) => s + r.reErr, 0),
  };

  const tagNames = [...new Set(rounds.flatMap((r) => r.tags))];
  const tags = tagNames
    .map((tag) => {
      const has = rounds.filter((r) => r.tags.includes(tag));
      return {
        tag, n: has.length,
        kpm: mean(has.map((r) => r.kpm)),
        errRate: pct(has.reduce((s, r) => s + r.errs, 0), has.reduce((s, r) => s + r.presses, 0)),
      };
    })
    .filter((t) => t.n >= thresholds.detection.minimumSamples);

  const slowWords = rounds
    .flatMap((r) => r.words)
    .filter((w) => w.keys >= 3)
    .sort((a, b) => a.kpm - b.kpm)
    .slice(0, 6);

  const keyStats = Object.entries(keys).map(([code, k]) => {
    const interval = wilsonInterval(k.err, k.n);
    const confidence = k.n >= thresholds.confidence.highMinimumSamples && interval.lower > sessionErrorRate
      ? "높음"
      : k.n >= thresholds.confidence.mediumMinimumSamples && interval.lower > sessionErrorRate
        ? "중간"
        : "낮음";
    return {
      code, label: keyLabel(code), n: k.n, err: k.err, errRate: pct(k.err, k.n), interval,
      confidence, ms: mean(k.msList), msN: k.msList.length,
    };
  });
  const allMs = mean(keyStats.flatMap((k) => Array(k.msN).fill(k.ms)));

  const weakKeys = keyStats.filter((k) => k.n >= thresholds.weakKeyMinimumSamples && k.err > 0)
    .sort((a, b) => b.interval.lower - a.interval.lower).slice(0, 5);
  const slowKeys = keyStats.filter((k) => k.n >= thresholds.weakKeyMinimumSamples && k.msN >= 3).sort((a, b) => b.ms - a.ms).slice(0, 5);

  const insights: string[] = [];
  const sec = (v: number) => (v / 1000).toFixed(2);
  insights.push(`문장이 뜬 뒤 첫 키를 누르기까지 평균 ${sec(totals.first)}초였어요.`);
  if (weakKeys.length)
    insights.push(`첫 오입력 기준 오타 관찰: ${weakKeys.slice(0, 3).map((k) => `${k.label} ${k.err}/${k.n}, ${k.errRate.toFixed(1)}% (95% 구간 ${Math.round(k.interval.lower * 100)}~${Math.round(k.interval.upper * 100)}%)`).join(" · ")}예요.`);
  if (dirStat.n >= thresholds.detection.minimumSamples) {
    if (dirStat.adjacent >= 55) insights.push(`오타의 ${dirStat.adjacent.toFixed(0)}%에서 목표 키와 이웃한 키가 눌렸어요.`);
    if (Math.abs(dirStat.mx) >= 0.4)
      insights.push(`가까운 키 오타의 중앙 방향은 목표보다 ${Math.abs(dirStat.mx).toFixed(1)}칸 ${dirStat.mx > 0 ? "오른쪽" : "왼쪽"}이에요.`);
  }
  for (const [hand, stat] of [["왼손", typoByHand.left], ["오른손", typoByHand.right]] as const) {
    if (stat.n >= thresholds.detection.directionMinSamples && stat.towardWristPct >= 60)
      insights.push(`${josa(hand, "으로", "로")} 칠 키 오타 ${stat.n}번 중 ${stat.towardWristPct.toFixed(0)}%가 손목 쪽으로 치우쳤어요.`);
    else if (stat.n >= thresholds.detection.directionMinSamples && stat.towardWristPct <= 30)
      insights.push(`${josa(hand, "으로", "로")} 칠 키 오타 ${stat.n}번 중 대부분이 손목에서 먼 쪽으로 치우쳤어요.`);
  }
  const shiftErr = (byKind["Shift 빠뜨림"] ?? 0) + (byKind["Shift 잘못 누름"] ?? 0);
  if (shiftErr >= 2) insights.push(`Shift 관련 오입력이 ${shiftErr}번 있었어요.`);
  if (byKind["한/영 상태"]) insights.push(`입력 당시 한/영 상태가 목표 언어와 달라 다시 입력한 경우가 ${byKind["한/영 상태"]}번 있었어요.`);
  if (byKind["Caps Lock"]) insights.push(`Caps Lock 때문에 영문 대소문자가 달라진 입력이 ${byKind["Caps Lock"]}번 있었어요.`);
  const observedSlowKeys = slowKeys.filter((k) => k.msN >= thresholds.detection.minimumSamples);
  if (observedSlowKeys.length)
    insights.push(`키 입력 간격 관찰: ${observedSlowKeys.slice(0, 3).map((k) => `${k.label} ${Math.round(k.ms)}ms (n=${k.msN})`).join(" · ")}예요.`);
  if (hand.same.length >= thresholds.detection.minimumSamples && hand.alt.length >= thresholds.detection.minimumSamples)
    insights.push(`입력 간격 관찰: 같은 손 중앙값 ${Math.round(median(hand.same))}ms, 번갈아 입력 중앙값 ${Math.round(median(hand.alt))}ms였어요.`);
  if (corr.n) insights.push(`오타를 고치는 데 평균 ${sec(corr.mean)}초 걸렸고, 같은 자리에서 다시 틀린 적은 ${corr.reErr}번이에요.`);
  if (tags.length) insights.push("태그별 속도는 문장 구성이 섞여 있어 태그 효과로 단정할 수 없어요.");

  const typedIntervals: number[] = [];
  for (const round of session.rounds) {
    let previous: (typeof round.events)[number] | undefined;
    for (const event of round.events) {
      if (event.kind !== "char" && event.kind !== "overflow") continue;
      if (previous && !crossesPauseBoundary(previous, event) && event.t >= previous.t)
        typedIntervals.push(event.t - previous.t);
      previous = event;
    }
  }
  const q1 = median(typedIntervals.filter((v) => v <= median(typedIntervals)));
  const q3 = median(typedIntervals.filter((v) => v >= median(typedIntervals)));
  const intervalSummary = {
    n: typedIntervals.length,
    medianIkiMs: typedIntervals.length ? median(typedIntervals) : undefined,
    iqrIkiMs: typedIntervals.length ? q3 - q1 : undefined,
    longGapRatio: typedIntervals.length ? typedIntervals.filter((v) => v > thresholds.detection.intervalLongGapMs).length / typedIntervals.length : undefined,
    longGapCount: typedIntervals.length ? typedIntervals.filter((v) => v > thresholds.detection.intervalLongGapMs).length : undefined,
    longGapThresholdMs: thresholds.detection.intervalLongGapMs,
  };
  const shiftAttempts = events.filter((event) => event.kind === "char" && event.targetKey && shiftJamoCodes.has(event.targetKey) && (event.targetShift || event.typedShift));
  const shiftCombo = {
    n: shiftAttempts.length,
    err: shiftAttempts.filter((event) => !event.ok).length,
    interval: wilsonInterval(shiftAttempts.filter((event) => !event.ok).length, shiftAttempts.length),
  };
  const shiftComboErr = shiftAttempts.filter((event) => !event.ok).length;
  const byKindDisplay = { ...byKind };
  const oldShiftErrors = (byKindDisplay["Shift 빠뜨림"] ?? 0) + (byKindDisplay["Shift 잘못 누름"] ?? 0);
  if (oldShiftErrors) byKindDisplay["Shift 실수"] = (byKindDisplay["Shift 실수"] ?? 0) + oldShiftErrors;
  delete byKindDisplay["Shift 빠뜨림"];
  delete byKindDisplay["Shift 잘못 누름"];
  if (byKindDisplay["멈춤 2000ms"] !== undefined) {
    byKindDisplay.longGap = (byKindDisplay.longGap ?? 0) + byKindDisplay["멈춤 2000ms"];
    delete byKindDisplay["멈춤 2000ms"];
  }

  const detection = analyzeDetection(session, sessionErrorRate);
  return { rounds, totals, pauseMetrics, byKind: byKindDisplay, keyStats, pairs, dirStat, typoByHand, corr, tags, slowWords, weakKeys, slowKeys, hand: { same: median(hand.same), alt: median(hand.alt), sameN: hand.same.length, altN: hand.alt.length }, sessionErrorRate, intervalSummary, shiftCombo, shiftComboErr, detection, insights };
}

export type Analysis = ReturnType<typeof analyze>;

export function compareWeakKeys(previous: Session, current: Session) {
  const before = analyze(previous).keyStats;
  const after = analyze(current).keyStats;
  const previousWeak = new Set(before.filter((key) => key.n >= thresholds.weakKeyMinimumSamples && key.err > 0).map((key) => key.code));
  const currentWeak = new Set(after.filter((key) => key.n >= thresholds.weakKeyMinimumSamples && key.err > 0).map((key) => key.code));
  return [...new Set([...previousWeak, ...currentWeak])].map((code) => {
    const old = before.find((key) => key.code === code);
    const now = after.find((key) => key.code === code);
    const isOverlap = !!old && !!now && old.interval.lower <= now.interval.upper && now.interval.lower <= old.interval.upper;
    let status:
      | "집계 안 됨"
      | "변화를 단정할 수 없어요"
      | "오타율이 매우 증가했어요.."
      | "오타율이 다소 증가했어요.."
      | "오타율이 미미하게 증가했어요.."
      | "오타율이 매우 감소했어요!"
      | "오타율이 다소 감소했어요!"
      | "오타율이 미미하게 감소했어요!";
    if (!old || !now) {
      status = "집계 안 됨";
    } else {
      const ratio = (now.err / now.n) / (old.err / old.n);
      const inverseRatio = 1 / ratio;
      const atLeast = (value: number, threshold: number) =>
        value >= threshold || threshold - value <= Number.EPSILON * Math.max(1, Math.abs(threshold));
      if (isOverlap) {
        status = atLeast(ratio, 1.5)
          ? "오타율이 다소 증가했어요.."
          : atLeast(inverseRatio, 1.5)
            ? "오타율이 다소 감소했어요!"
            : "변화를 단정할 수 없어요";
      } else if (ratio > 1) {
        status = atLeast(ratio, 2.0)
          ? "오타율이 매우 증가했어요.."
          : atLeast(ratio, 1.5)
            ? "오타율이 다소 증가했어요.."
            : "오타율이 미미하게 증가했어요..";
      } else if (inverseRatio > 1) {
        status = atLeast(inverseRatio, 2.0)
          ? "오타율이 매우 감소했어요!"
          : atLeast(inverseRatio, 1.5)
            ? "오타율이 다소 감소했어요!"
            : "오타율이 미미하게 감소했어요!";
      } else {
        status = "변화를 단정할 수 없어요";
      }
    }
    return {
      code,
      label: old?.label ?? now?.label ?? code,
      previous: old ? { k: old.err, n: old.n, interval: old.interval } : undefined,
      current: now ? { k: now.err, n: now.n, interval: now.interval } : undefined,
      overlap: isOverlap,
      status,
    };
  }).sort((x, y) => (y.current?.k ?? 0) - (x.current?.k ?? 0));
}

export function weaknessBaseline(sessions: Session[], hintOn: boolean | undefined, throughSessionId?: number) {
  const hasEpisodeData = (session: Session) => session.rounds.flatMap((round) => round.events)
    .filter((event) => (event.kind === "char" || event.kind === "overflow") && (event.err || event.ok === false))
    .every((event) => event.episodeId !== undefined && event.episodeRole !== undefined);
  const selected = hintOn === undefined ? [] : sessions
    .filter((item) => !item.isLocalStorageOnly && item.hintOn === hintOn && (throughSessionId === undefined || item.id <= throughSessionId) && hasEpisodeData(item))
    .sort((a, b) => b.id - a.id)
    .slice(0, thresholds.detection.accumulateSessions);
  const weaknessEligibility = {
    canDiagnose: selected.length >= thresholds.detection.accumulateSessions,
    matchingSessions: selected.length,
    requiredSessions: thresholds.detection.accumulateSessions,
    hintOn,
  };
  const aggregate = new Map<string, { n: number; err: number; label: string; code: string }>();
  const groupAggregate = new Map<string, { n: number; err: number; label: string; category: string }>();
  let totalErrors = 0, totalPresses = 0;
  for (const item of selected) {
    const analysis = analyze(item);
    totalErrors += analysis.totals.errs;
    totalPresses += analysis.totals.presses;
    for (const key of analysis.keyStats) {
      const row = aggregate.get(key.code) ?? { n: 0, err: 0, label: key.label, code: key.code };
      row.n += key.n;
      row.err += key.err;
      aggregate.set(key.code, row);
    }
    const addGroup = (category: string, label: string, error: boolean) => {
      const id = `${category}:${label}`;
      const row = groupAggregate.get(id) ?? { n: 0, err: 0, label, category };
      row.n++; if (error) row.err++;
      groupAggregate.set(id, row);
    };
    const shiftCodes = new Set(["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyO", "KeyP"]);
    item.rounds.forEach((round) => {
      const expected = keysForText(round.text);
      const chars = [...round.text];
      const perChar: Record<number, number> = {};
      round.events.forEach((event) => {
        if (event.kind !== "char" || event.episodeRole === "cascade") return;
        const target = event.targetKey ?? event.exp;
        if (!target) return;
        const error = !!event.err || event.ok === false;
        const isShiftCombo = !!(event.targetShift || event.typedShift) && shiftCodes.has(target);
        const pos = KEYPOS[target];
        if (isShiftCombo) addGroup("shift", "Shift 조합", error);
        else {
          const finger = fingerOf(target);
          addGroup("finger", finger, error);
          const hand = handOf(target, item.wristAnchors ?? DEFAULT_WRISTS);
          if (hand) addGroup("hand", hand === "L" ? "왼손" : "오른손", error);
          if (pos) addGroup("row", ["숫자줄", "윗줄", "가운데줄", "아랫줄", "공백줄"][Math.round(pos.y)] ?? "기타 줄", error);
        }
        if (event.code === "Space" || target === "Space") addGroup("space", "공백", error);
        const want = expected[event.pos];
        if (!want || want.lang !== "ko" || event.targetShift || event.typedShift) return;
        const offset = perChar[want.ch] ?? 0; perChar[want.ch] = offset + 1;
        const position = offset === 0 ? "초성" : offset === 1 ? "중성" : "종성";
        addGroup("koreanPosition", position, error);
        const code = (chars[want.ch] ?? "").charCodeAt(0) - 0xac00;
        if (code >= 0 && code <= 11171) addGroup("batchim", code % 28 === 0 ? "받침 없음" : "받침 있음", error);
      });
    });
    analysis.detection.distance.forEach((row) => {
      const id = `reach:${row.band}`;
      const existing = groupAggregate.get(id) ?? { n: 0, err: 0, label: row.band, category: "reach" };
      existing.n += row.n; existing.err += row.k; groupAggregate.set(id, existing);
    });
  }
  const baselineErrorRate = totalPresses ? totalErrors / totalPresses : 0;
  const rankConfidence = (k: number, n: number) => {
    const interval = wilsonInterval(k, n);
    const confidence = n >= thresholds.confidence.highMinimumSamples && interval.lower > baselineErrorRate
      ? "높음"
      : n >= thresholds.confidence.mediumMinimumSamples && interval.lower > baselineErrorRate
        ? "중간"
        : "낮음";
    return { interval, confidence };
  };
  const weakKeys = [...aggregate.values()].flatMap((key) => {
    if (key.n < thresholds.weakKeyMinimumSamples || !key.err) return [];
    const { interval, confidence } = rankConfidence(key.err, key.n);
    return [{
      key: key.label, finger: fingerOf(key.code), err: key.err, errPct: r1(100 * key.err / key.n), n: key.n,
      wilson95: { lowerPct: r1(interval.lower * 100), upperPct: r1(interval.upper * 100) }, confidence,
    }];
  }).sort((a, b) => b.err - a.err);
  const weakGroups = [...groupAggregate.values()].map((group) => {
    const { interval, confidence } = rankConfidence(group.err, group.n);
    return { ...group, id: `${group.category}:${group.label}`, k: group.err, rate: group.n ? r1(100 * group.err / group.n) : 0,
      ci: { lower: r1(interval.lower * 100), upper: r1(interval.upper * 100) }, confidence };
  }).sort((a, b) => b.rate - a.rate);
  const eligibleWeakGroups = weakGroups.filter((group) => group.n >= thresholds.detection.groupMinimumSamples && group.confidence !== "낮음");
  return {
    weaknessEligibility: { ...weaknessEligibility, baselineErrorRate: r1(100 * baselineErrorRate) },
    weakKeys, weakGroups, eligibleWeakGroups,
  };
}

const r1 = (value: number) => Math.round(value * 10) / 10;

export function aiSummary(session: Session, a: Analysis) {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const sessionEvents = session.rounds.flatMap((round) => round.events);
  const languageEvents = sessionEvents.filter((event) => event.kind === "char" && event.code.startsWith("Key"));
  return {
    layout: "두벌식 한글 / QWERTY",
    rounds: a.rounds.length,
    practiceSentenceCount: thresholds.practiceCount,
    avgKeysPerMin: Math.round(a.totals.kpm),
    accuracyPct: r1(a.totals.acc),
    accuracyA: r1(a.totals.accuracyA),
    accuracyB: a.totals.accuracyB === undefined ? undefined : r1(a.totals.accuracyB),
    wrongErase: a.totals.wrongErase,
    avgFirstKeyMs: Math.round(a.totals.first),
    errorKinds: a.byKind,
    imeEvidence: {
      processSignal: languageEvents.filter((event) => event.imeEvidence === "process").length,
      legacy229Signal: languageEvents.filter((event) => event.imeEvidence === "legacy-229").length,
      composingSignal: languageEvents.filter((event) => event.imeEvidence === "composing").length,
      latinKey: languageEvents.filter((event) => event.imeEvidence === "latin-key").length,
      unknown: languageEvents.filter((event) => event.imeEvidence === "unknown" || event.imeEvidence === undefined).length,
      mismatch: languageEvents.filter((event) => event.err === "한/영 상태").length,
      recordedToggleKeyPresses: sessionEvents.filter((event) => event.inputModeKey === "toggle" || event.code === "Lang1" || event.code === "Hangul").length,
    },
    weakKeys: a.weakKeys.map((k) => ({ key: k.label, finger: fingerOf(k.code), err: k.err, errPct: r1(k.errRate), n: k.n, wilson95: { lowerPct: r1(k.interval.lower * 100), upperPct: r1(k.interval.upper * 100) }, confidence: k.confidence })),
    slowKeys: a.slowKeys.map((k) => ({ key: k.label, finger: fingerOf(k.code), ms: Math.round(k.ms) })),
    typoPairs: a.pairs.map((p) => ({
      expected: p.exp, expectedFinger: fingerOf(p.expCode), typed: p.act, typedFinger: fingerOf(p.actCode),
      n: p.n, dist: r1(p.dist), dir: p.dir,
    })),
    editAlignment: a.detection.alignment,
    detection: a.detection,
    shiftCombo: a.shiftCombo.n ? {
      attempts: a.shiftCombo.n, err: a.shiftCombo.err, errPct: r1(pct(a.shiftCombo.err, a.shiftCombo.n)),
      wilson95: { lowerPct: r1(a.shiftCombo.interval.lower * 100), upperPct: r1(a.shiftCombo.interval.upper * 100) },
    } : undefined,
    intervals: a.intervalSummary,
    confidenceRules: {
      status: thresholds.confidence.status,
      highMinimumSamples: thresholds.confidence.highMinimumSamples,
      mediumMinimumSamples: thresholds.confidence.mediumMinimumSamples,
      lowerBoundMustExceedSessionErrorRate: thresholds.confidence.minimumWilsonLowerMustExceedSessionErrorRate,
      minimumWeakKeySamples: thresholds.weakKeyMinimumSamples,
      wilsonConfidencePct: 95,
    },
    wristAnchors: session.wristAnchors,
    dz: session.dz,
    reachCutoffs: session.reachCutoffs,
    fingerMapVersion: session.fingerMapVersion,
    reachAnalysis: a.detection.distanceSettings,
    correction: { count: a.corr.n, meanMs: Math.round(a.corr.mean), reErrors: a.corr.reErr },
    handTransitionMs: { sameHand: Math.round(a.hand.same), alternate: Math.round(a.hand.alt) },
    slowWords: a.slowWords.map((w) => ({ word: w.word, kpm: Math.round(w.kpm) })),
    byTag: a.tags.map((t) => ({ tag: t.tag, n: t.n, kpm: Math.round(t.kpm), errPct: r1(t.errRate) })),
    facts: buildFactList(a),
    metricDefinitions: {
      rounds: "완료한 문장 수입니다. 문장 하나가 한 라운드입니다.",
      avgKeysPerMin: "전체 목표 키 수를 각 문장의 첫 입력부터 마지막 입력까지의 시간 합으로 나눈 분당 키 수입니다. 일시정지 시간은 포함하지 않습니다.",
      accuracyPct: "타건 정확도 A입니다. 고친 오타도 오입력으로 세며, 정타 시도 수를 전체 문자 시도 수로 나눕니다.",
      accuracyB: "지우기 포함 정확도입니다. 오입력과 잘못 지운 정타를 전체 시도에 반영합니다. 기존 기록에 제거 정보가 없으면 집계하지 않습니다.",
      avgFirstKeyMs: "문장이 표시된 뒤 첫 키 이벤트까지 걸린 시간의 평균입니다. 일시정지 시간은 제외합니다.",
      errorKinds: "문자 입력 시도에서 발생한 오입력 종류별 횟수이며, Caps Lock 키 자체를 누른 횟수는 오입력으로 세지 않습니다.",
      weakKeys: "n은 목표 키 시도 수, err는 오입력 수, errPct는 오타율, wilson95는 95% 신뢰구간, confidence는 코드가 config/thresholds.json 규칙으로 계산한 값입니다. 키 순위는 신뢰구간 하한 순이며 n이 5 미만인 키는 제외합니다. Shift 조합 대상은 별도 집계합니다.",
      slowKeys: "키 입력 사이 시간으로 계산한 느린 키 순위입니다. 일시정지 경계를 가로지르는 간격은 제외합니다.",
      typoPairs: "목표 키와 실제로 누른 키의 쌍, 횟수, 키 간 거리와 방향입니다.",
      editAlignment: "기대 키열과 입력 키열의 편집 거리 정렬 결과입니다. omission, extra, substitution, transposition별 횟수와 n을 담고, 필요한 필드가 없는 기존 기록은 정렬 모호로 표시합니다.",
      detection: "정렬 오타 분류, 공백 오류, keyup 기반 타이밍, 미수정 오타 누적, 감속, 거리·손가락·한글 위치별 통계입니다. 필요한 기록 필드가 없으면 집계 안 됨으로 표시하고, 태그는 판정에 쓰지 않습니다.",
      shiftCombo: "Shift가 필요한 한글 키 조합의 오타 수와 전체 시도 수, 오타율 및 Wilson 95% 구간입니다. finger 정보는 제공하지 않습니다.",
      intervals: `정지 경계 간격을 뺀 연속 문자 입력 간격입니다. ${thresholds.detection.intervalLongGapMs}ms 초과는 표시용 구간이며, 0회여도 문장 사이에 멈춤이 없었다고 뜻하지 않습니다.`,
      imeState: "한/영 상태 오류는 눌린 물리 키가 아니라 해당 문자 입력 순간 브라우저가 감지한 IME 신호와 목표 언어를 비교한 결과입니다. 사용자가 한/영 키를 눌렀거나 잊었다고 추정하지 않습니다.",
      confidenceRules: "약점 확신도 계산의 임시값입니다. 기준은 config/thresholds.json에 있으며 AI가 정하지 않습니다.",
      correction: "오타 후 입력을 바로잡는 데 걸린 시간과 재오타 횟수입니다.",
      handTransitionMs: "같은 손 키 사이와 양손 번갈아 입력한 키 사이의 간격 중앙값입니다. 일시정지 경계 간격은 제외합니다.",
      slowWords: "어절별 목표 키 입력 속도입니다.",
      byTag: "문장 특성별 문장 수, 키 입력 속도와 오입력 비율입니다. 5문장 미만 특성은 포함하지 않으며 표시된 특성도 문장 구성이 섞여 있어 태그 효과로 단정할 수 없습니다.",
      pauses: "count는 일시정지 횟수, totalMs는 정지 시간 합, prePauseCpm/postPauseCpm은 첫 정지 전과 정지 후의 문자 입력 속도, resumeDelaysMs는 재개 뒤 첫 키까지 걸린 시간 목록입니다.",
    },
  };
}
