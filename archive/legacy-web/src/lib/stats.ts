import { DEFAULT_WRISTS, KEYPOS, direction, fingerOf, handOf, keyLabel, keysForText } from "./keyboard";
import { calculatePauseMetrics, crossesPauseBoundary } from "./pauseMetrics";
import type { RoundRecord, Session } from "./types";
import thresholds from "../../config/thresholds.json";
import { analyzeDetection } from "./detection";
import { computeTags } from "../../shared/rules";

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
  const errs = r.events.filter((e) => e.err).length;
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
  const errEvents = events.filter((e) => e.err);
  const totalMs = rounds.reduce((s, r) => s + r.ms, 0);
  const totalKeys = rounds.reduce((s, r) => s + r.keys, 0);
  const totals = {
    kpm: totalMs ? (totalKeys * 60000) / totalMs : 0,
    cpm: totalMs ? (rounds.reduce((s, r) => s + r.text.length, 0) * 60000) / totalMs : 0,
    acc: 100 - pct(errEvents.filter((e) => e.kind === "char" || e.kind === "overflow").length, presses),
    first: mean(rounds.map((r) => r.first)),
    errs: errEvents.length,
    presses,
    backspaces: rounds.reduce((s, r) => s + r.backspaces, 0),
    seconds: totalMs / 1000,
  };
  const sessionErrorRate = presses ? errEvents.filter((e) => e.kind === "char" || e.kind === "overflow").length / presses : 0;

  const byKind: Record<string, number> = {};
  errEvents.forEach((e) => (byKind[e.err!] = (byKind[e.err!] ?? 0) + 1));

  const keys: Record<string, { n: number; err: number; msList: number[] }> = {};
  const hand = { same: [] as number[], alt: [] as number[] };
  const shiftJamoCodes = new Set(["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyO", "KeyP"]);
  session.rounds.forEach((r) =>
    r.events.forEach((e, idx) => {
      if (e.kind !== "char" || !e.exp) return;
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

  const pairMap = new Map<string, { exp: string; act: string; n: number; dist: number[]; dx: number; dy: number }>();
  const other = errEvents.filter((e) => e.kind === "char" && e.exp && e.exp !== e.code && !isShiftComboEvent(e));
  const handTypos = {
    left: other.filter((e) => handOf(e.exp!, wrists) === "L"),
    right: other.filter((e) => handOf(e.exp!, wrists) === "R"),
  };
  const towardWristPct = (rows: typeof other, wrist: { x: number; y: number }) => pct(rows.filter((e) => {
    const target = KEYPOS[e.exp!];
    const dx = e.dx ?? 0;
    const dy = e.dy ?? 0;
    return dx * (wrist.x - target.x) + dy * (wrist.y - target.y) > 0;
  }).length, rows.length);
  const typoByHand = {
    left: {
      n: handTypos.left.length,
      meanDx: mean(handTypos.left.map((e) => e.dx ?? 0)),
      meanDy: mean(handTypos.left.map((e) => e.dy ?? 0)),
      towardWristPct: towardWristPct(handTypos.left, wrists.left),
    },
    right: {
      n: handTypos.right.length,
      meanDx: mean(handTypos.right.map((e) => e.dx ?? 0)),
      meanDy: mean(handTypos.right.map((e) => e.dy ?? 0)),
      towardWristPct: towardWristPct(handTypos.right, wrists.right),
    },
  };
  other.forEach((e) => {
    const id = `${e.exp}>${e.code}`;
    const p = pairMap.get(id) ?? { exp: e.exp!, act: e.code, n: 0, dist: [], dx: 0, dy: 0 };
    p.n++;
    p.dist.push(Math.hypot(e.dx ?? 0, e.dy ?? 0));
    p.dx += e.dx ?? 0;
    p.dy += e.dy ?? 0;
    pairMap.set(id, p);
  });
  const pairs = [...pairMap.values()]
    .filter((pair) => pair.n >= thresholds.weakKeyMinimumSamples)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .map((p) => ({
      exp: keyLabel(p.exp), act: keyLabel(p.act), expCode: p.exp, actCode: p.act, n: p.n, dist: mean(p.dist), dir: direction(p.dx / p.n, p.dy / p.n),
    }));

  const withVec = other.filter((e) => e.dx !== undefined);
  const dirStat = {
    n: withVec.length,
    mx: mean(withVec.map((e) => e.dx!)),
    my: mean(withVec.map((e) => e.dy!)),
    adjacent: pct(withVec.filter((e) => Math.hypot(e.dx!, e.dy!) <= 1.6).length, withVec.length),
    prev: pct(other.filter((e) => e.isPrev).length, other.length),
    next: pct(other.filter((e) => e.isNext).length, other.length),
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
    insights.push(`오타 관찰: ${weakKeys.slice(0, 3).map((k) => `${k.label} ${k.err}/${k.n}, ${k.errRate.toFixed(1)}% (95% 구간 ${Math.round(k.interval.lower * 100)}~${Math.round(k.interval.upper * 100)}%)`).join(" · ")}예요.`);
  if (dirStat.n >= thresholds.detection.minimumSamples) {
    if (dirStat.adjacent >= 55) insights.push(`오타의 ${dirStat.adjacent.toFixed(0)}%에서 목표 키와 이웃한 키가 눌렸어요.`);
    if (Math.abs(dirStat.mx) >= 0.4)
      insights.push(`오타는 눌러야 할 키보다 평균 ${Math.abs(dirStat.mx).toFixed(1)}칸 ${dirStat.mx > 0 ? "오른쪽" : "왼쪽"}에 치우쳤어요.`);
    if (dirStat.prev >= 15) insights.push(`오타의 ${dirStat.prev.toFixed(0)}%는 방금 친 키를 한 번 더 누른 경우예요.`);
  }
  for (const [hand, stat] of [["왼손", typoByHand.left], ["오른손", typoByHand.right]] as const) {
    if (stat.n >= 3 && stat.towardWristPct >= 60)
      insights.push(`${hand}로 칠 키 오타 ${stat.n}번 중 ${stat.towardWristPct.toFixed(0)}%가 손목 쪽으로 치우쳤어요.`);
    else if (stat.n >= 3 && stat.towardWristPct <= 30)
      insights.push(`${hand}로 칠 키 오타 ${stat.n}번 중 대부분이 손목에서 먼 쪽으로 치우쳤어요.`);
  }
  const shiftErr = (byKind["Shift 빠뜨림"] ?? 0) + (byKind["Shift 잘못 누름"] ?? 0);
  if (shiftErr >= 2) insights.push(`Shift 관련 오입력이 ${shiftErr}번 있었어요.`);
  if (byKind["한/영 상태"]) insights.push(`한/영 상태가 맞지 않아 틀린 입력이 ${byKind["한/영 상태"]}번 있었어요. 한글과 영문이 섞인 문장에서 전환을 놓치는지 보세요.`);
  if (byKind["Caps Lock"]) insights.push(`Caps Lock 때문에 틀린 입력이 ${byKind["Caps Lock"]}번 있었어요.`);
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
  return { rounds, totals, pauseMetrics, byKind: byKindDisplay, keyStats, pairs, dirStat, typoByHand, corr, tags, slowWords, weakKeys, slowKeys, hand: { same: median(hand.same), alt: median(hand.alt) }, sessionErrorRate, intervalSummary, shiftCombo, shiftComboErr, detection, insights };
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
    const overlap = !!old && !!now && old.interval.lower <= now.interval.upper && now.interval.lower <= old.interval.upper;
    return {
      code,
      label: old?.label ?? now?.label ?? code,
      previous: old ? { k: old.err, n: old.n, interval: old.interval } : undefined,
      current: now ? { k: now.err, n: now.n, interval: now.interval } : undefined,
      overlap,
      status: !old || !now ? "집계 안 됨" as const : overlap ? "변화를 단정할 수 없어요" as const : "구간이 겹치지 않아요" as const,
    };
  }).sort((x, y) => (y.current?.k ?? 0) - (x.current?.k ?? 0));
}

export function aiSummary(session: Session, a: Analysis) {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    keyboard: session.keyboard,
    layout: "두벌식 한글 / QWERTY",
    rounds: a.rounds.length,
    avgKeysPerMin: Math.round(a.totals.kpm),
    accuracyPct: r1(a.totals.acc),
    avgFirstKeyMs: Math.round(a.totals.first),
    errorKinds: a.byKind,
    weakKeys: a.weakKeys.map((k) => ({ key: k.label, finger: fingerOf(k.code), err: k.err, errPct: r1(k.errRate), n: k.n, wilson95: { lowerPct: r1(k.interval.lower * 100), upperPct: r1(k.interval.upper * 100) }, confidence: k.confidence })),
    slowKeys: a.slowKeys.map((k) => ({ key: k.label, finger: fingerOf(k.code), ms: Math.round(k.ms) })),
    typoPairs: a.pairs.map((p) => ({
      expected: p.exp, expectedFinger: fingerOf(p.expCode), typed: p.act, typedFinger: fingerOf(p.actCode),
      n: p.n, dist: r1(p.dist), dir: p.dir,
    })),
    typoTendency: {
      n: a.dirStat.n, meanDx: r1(a.dirStat.mx), meanDy: r1(a.dirStat.my), adjacentPct: Math.round(a.dirStat.adjacent),
      repeatPrevPct: Math.round(a.dirStat.prev), pressedNextPct: Math.round(a.dirStat.next),
    },
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
    typoDirectionByHand: a.typoByHand,
    wristAnchors: session.wristAnchors,
    correction: { count: a.corr.n, meanMs: Math.round(a.corr.mean), reErrors: a.corr.reErr },
    handTransitionMs: { sameHand: Math.round(a.hand.same), alternate: Math.round(a.hand.alt) },
    slowWords: a.slowWords.map((w) => ({ word: w.word, kpm: Math.round(w.kpm) })),
    byTag: a.tags.map((t) => ({ tag: t.tag, n: t.n, kpm: Math.round(t.kpm), errPct: r1(t.errRate) })),
    metricDefinitions: {
      rounds: "완료한 문장 수입니다. 문장 하나가 한 라운드입니다.",
      avgKeysPerMin: "전체 목표 키 수를 각 문장의 첫 입력부터 마지막 입력까지의 시간 합으로 나눈 분당 키 수입니다. 일시정지 시간은 포함하지 않습니다.",
      accuracyPct: "기록된 입력 시도 중 오입력이 아닌 시도의 비율입니다.",
      avgFirstKeyMs: "문장이 표시된 뒤 첫 키 이벤트까지 걸린 시간의 평균입니다. 일시정지 시간은 제외합니다.",
      errorKinds: "기록된 오입력 종류별 횟수입니다.",
      weakKeys: "n은 목표 키 시도 수, err는 오입력 수, errPct는 오타율, wilson95는 95% 신뢰구간, confidence는 코드가 config/thresholds.json 규칙으로 계산한 값입니다. 키 순위는 신뢰구간 하한 순이며 n이 5 미만인 키는 제외합니다. Shift 조합 대상은 별도 집계합니다.",
      slowKeys: "키 입력 사이 시간으로 계산한 느린 키 순위입니다. 일시정지 경계를 가로지르는 간격은 제외합니다.",
      typoPairs: "목표 키와 실제로 누른 키의 쌍, 횟수, 키 간 거리와 방향입니다.",
      typoTendency: "오입력 키가 목표 키에서 벗어난 방향과 원시 키 코드 기준 이웃 키·이전 키·다음 키 비율입니다. pressedNextPct는 '다음 키를 먼저 누름'과 '목표 키 누락'을 합친 원시 값이며 선입력 판정이 아닙니다.",
      editAlignment: "기대 키열과 입력 키열의 편집 거리 정렬 결과입니다. omission, extra, substitution, transposition별 횟수와 n을 담고, 필요한 필드가 없는 기존 기록은 정렬 모호로 표시합니다.",
      detection: "정렬 오타 분류, 공백 오류, keyup 기반 타이밍, 미수정 오타 누적, 감속, 거리·손가락·한글 위치별 통계입니다. 필요한 기록 필드가 없으면 집계 안 됨으로 표시하고, 태그는 판정에 쓰지 않습니다.",
      shiftCombo: "Shift가 필요한 한글 키 조합의 오타 수와 전체 시도 수, 오타율 및 Wilson 95% 구간입니다. finger 정보는 제공하지 않습니다.",
      intervals: `정지 경계 간격을 뺀 연속 문자 입력 간격입니다. medianIkiMs는 중앙값, iqrIkiMs는 사분위 범위, longGapRatio는 ${thresholds.detection.intervalLongGapMs}ms 초과 간격의 표시용 비율입니다. longGap은 판정이 아닌 표시입니다.`,
      confidenceRules: "약점 확신도 계산의 임시값입니다. 기준은 config/thresholds.json에 있으며 AI가 정하지 않습니다.",
      typoDirectionByHand: "목표 키와 가까운 손목 기준점으로 나눈 오타입니다. n은 오타 수, towardWristPct는 해당 손목 방향으로 벗어난 오타 비율입니다.",
      correction: "오타 후 입력을 바로잡는 데 걸린 시간과 재오타 횟수입니다.",
      handTransitionMs: "같은 손 키 사이와 양손 번갈아 입력한 키 사이의 간격 중앙값입니다. 일시정지 경계 간격은 제외합니다.",
      slowWords: "어절별 목표 키 입력 속도입니다.",
      byTag: "문장 특성별 문장 수, 키 입력 속도와 오입력 비율입니다. 5문장 미만 특성은 포함하지 않으며 표시된 특성도 문장 구성이 섞여 있어 태그 효과로 단정할 수 없습니다.",
      pauses: "count는 일시정지 횟수, totalMs는 정지 시간 합, prePauseCpm/postPauseCpm은 첫 정지 전과 정지 후의 문자 입력 속도, resumeDelaysMs는 재개 뒤 첫 키까지 걸린 시간 목록입니다.",
    },
  };
}
