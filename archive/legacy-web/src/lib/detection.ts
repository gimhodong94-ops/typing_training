import thresholds from "../../config/thresholds.json";
import { DEFAULT_WRISTS, KEYPOS, fingerOf, keysForText } from "./keyboard";
import { crossesPauseBoundary } from "./pauseMetrics";
import type { RoundRecord, Session, KeyEvent } from "./types";

export type AlignmentOperation = "match" | "substitution" | "omission" | "extra" | "transposition";
export type AlignmentEdit = { operation: AlignmentOperation; expected?: string; typed?: string };

export function alignKeySequences(expected: string[], typed: string[]): AlignmentEdit[] {
  const rows = expected.length + 1;
  const cols = typed.length + 1;
  const cost = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  const back = Array.from({ length: rows }, () => Array<AlignmentOperation | "start">(cols).fill("start"));
  for (let i = 1; i < rows; i++) { cost[i][0] = i; back[i][0] = "omission"; }
  for (let j = 1; j < cols; j++) { cost[0][j] = j; back[0][j] = "extra"; }
  for (let i = 1; i < rows; i++) for (let j = 1; j < cols; j++) {
    if (i > 1 && j > 1 && expected[i - 1] === typed[j - 2] && expected[i - 2] === typed[j - 1] && expected[i - 1] !== expected[i - 2]) {
      cost[i][j] = cost[i - 2][j - 2] + 1;
      back[i][j] = "transposition";
      continue;
    }
    const same = expected[i - 1] === typed[j - 1];
    const options: [number, AlignmentOperation][] = [
      [cost[i - 1][j - 1] + (same ? 0 : 1), same ? "match" : "substitution"],
      [cost[i - 1][j] + 1, "omission"],
      [cost[i][j - 1] + 1, "extra"],
    ];
    options.sort((a, b) => a[0] - b[0]);
    [cost[i][j], back[i][j]] = options[0];
  }
  const edits: AlignmentEdit[] = [];
  let i = expected.length, j = typed.length;
  while (i || j) {
    const operation = back[i][j];
    if (operation === "match" || operation === "substitution") {
      edits.push({ operation, expected: expected[--i], typed: typed[--j] });
    } else if (operation === "transposition") {
      edits.push({ operation, expected: `${expected[i - 2]}|${expected[i - 1]}`, typed: `${typed[j - 2]}|${typed[j - 1]}` });
      i -= 2; j -= 2;
    } else if (operation === "omission") edits.push({ operation, expected: expected[--i] });
    else edits.push({ operation: "extra", typed: typed[--j] });
  }
  return edits.reverse();
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : undefined;
};
const wilson = (k: number, n: number) => {
  if (!n) return undefined;
  const z = 1.96, p = k / n, den = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / den;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return { lower: center - half, upper: center + half };
};

export function shouldIgnoreDuplicateImeSpace(now: number, previousSpace: number, previousImeSignal: boolean, imeSignal: boolean) {
  return (imeSignal || previousImeSignal) && now - previousSpace < thresholds.detection.duplicateKeyMs;
}

function editToken(code: string | undefined, shift: boolean | undefined) {
  return code ? `${code}${shift ? "+Shift" : ""}` : "";
}

function getAlignment(round: RoundRecord) {
  const chars = round.events.filter((event) => event.kind === "char" || event.kind === "overflow");
  if (chars.some((event) => !event.typedKey || (event.kind === "char" && !event.targetKey))) return null;
  const expected = keysForText(round.text).map((key) => editToken(key.code, key.shift));
  const typed = chars.map((event) => editToken(event.typedKey, event.typedShift ?? event.shift));
  return { chars, edits: alignKeySequences(expected, typed) };
}

export function analyzeDetection(session: Session, sessionErrorRate: number) {
  const d = thresholds.detection;
  const wrists = session.wristAnchors ?? DEFAULT_WRISTS;
  const rounds = session.rounds;
  const aligned = rounds.map((round) => ({ round, value: getAlignment(round) }));
  const count = { match: 0, substitution: 0, omission: 0, extra: 0, transposition: 0, ambiguous: 0, n: 0 };
  const spaces = { omission: 0, extra: 0, position: 0, n: 0 };
  aligned.forEach(({ value }, roundIndex) => {
    if (!value) {
      const ambiguousN = rounds[roundIndex].events.filter((event) => event.kind === "char" || event.kind === "overflow").length;
      count.ambiguous += ambiguousN;
      count.n += ambiguousN;
      return;
    }
    value.edits.forEach((edit) => {
      count[edit.operation]++;
      if (edit.operation !== "match") count.n++;
      const spaceErr = edit.expected === "Space" || edit.typed === "Space";
      if (spaceErr) {
        spaces.n++;
        if (edit.operation === "omission") spaces.omission++;
        else if (edit.operation === "extra") spaces.extra++;
        else if (edit.operation !== "match") spaces.position++;
      }
    });
  });

  const chars = rounds.flatMap((round) => round.events.filter((event) => event.kind === "char" || event.kind === "overflow").map((event) => ({ round, event })));
  const timing = { simultaneous: 0, duplicate: 0, shiftReleaseDelaysMs: [] as number[], n: chars.length };
  rounds.forEach((round) => {
    const byCode: Record<string, number[]> = {};
    const keys = round.events.filter((event) => event.kind === "char" || event.kind === "overflow");
    for (let i = 0; i < keys.length; i++) {
      const current = keys[i];
      const previous = keys[i - 1];
      if (previous && !crossesPauseBoundary(previous, current) && previous.pauseSeq === current.pauseSeq && previous.pauseSeq === previous.keyupPauseSeq) {
        if (previous.keyupT === undefined) timing.simultaneous = -1;
        else if (current.t < previous.keyupT) timing.simultaneous++;
      }
      const list = byCode[current.code] ?? [];
      if (list.length && previous && !crossesPauseBoundary(previous, current) && current.t - list[list.length - 1] < d.duplicateKeyMs) timing.duplicate++;
      list.push(current.t); byCode[current.code] = list;
      if (previous && previous.kind === "modifier" && (previous.code === "ShiftLeft" || previous.code === "ShiftRight") && previous.keyupT !== undefined)
        timing.shiftReleaseDelaysMs.push(Math.max(0, previous.keyupT - current.t));
    }
    // Shift down/up events have no text position, so measure release after the following character.
    round.events.forEach((event, index) => {
      if (event.kind !== "modifier" || !event.code.startsWith("Shift") || event.keyupT === undefined) return;
      const lastChar = round.events.slice(index + 1).find((candidate) => candidate.kind === "char");
      if (lastChar) timing.shiftReleaseDelaysMs.push(Math.max(0, event.keyupT - lastChar.t));
    });
  });
  const hasMissingKeyup = chars.some(({ event }) => event.keyupT === undefined);
  const overlapping = timing.simultaneous < 0 ? undefined : timing.simultaneous;

  const errorIndices: number[] = [];
  const intervals: number[] = [];
  chars.forEach(({ event }, index) => {
    if (event.err) errorIndices.push(index);
    if (index > 0 && chars[index - 1].round.id === chars[index].round.id && !crossesPauseBoundary(chars[index - 1].event, event)) {
      const gap = event.t - chars[index - 1].event.t;
      if (gap >= 0) intervals.push(gap);
    }
  });
  const overallMedianMs = median(intervals);
  const slowdownAfterErrors = errorIndices.map((index) => {
    const next = chars.slice(index + 1, index + 1 + d.slowdownFollowupKeys);
    const gaps = next.map((row, i) => {
      const prev = chars[index + i];
      return row.round.id === prev.round.id && !crossesPauseBoundary(prev.event, row.event) ? row.event.t - prev.event.t : undefined;
    }).filter((n): n is number => n !== undefined && n >= 0);
    const value = median(gaps);
    return value === undefined || overallMedianMs === undefined ? undefined : { followingMedianMs: value, baselineMedianMs: overallMedianMs, ratio: overallMedianMs ? value / overallMedianMs : undefined, slowed: value >= overallMedianMs * d.slowdownRatio };
  }).filter((value) => value !== undefined);
  const errorTimes = chars.filter(({ event }) => !!event.err).map(({ event }) => event.sessionMs ?? event.t);
  const chainStarts: number[] = [];
  for (let i = 0; i <= errorTimes.length - d.typoChainErrorCount; i++) {
    if (errorTimes[i + d.typoChainErrorCount - 1] - errorTimes[i] <= d.typoChainWindowMs &&
      (i === 0 || errorTimes[i + d.typoChainErrorCount - 1] - errorTimes[i - 1] > d.typoChainWindowMs)) chainStarts.push(errorTimes[i]);
  }
  const eligibleChains = chainStarts.length >= d.typoChainMinimumSamples ? chainStarts.length : undefined;

  let maxUnresolved = 0;
  rounds.forEach((round) => {
    const typedStack: KeyEvent[] = [];
    let pendingCorrection = false, unresolvedRun = 0;
    round.events.forEach((event) => {
      if (event.kind === "char" || event.kind === "overflow") {
        if (event.err) pendingCorrection = true;
        else if (pendingCorrection) { unresolvedRun++; maxUnresolved = Math.max(maxUnresolved, unresolvedRun); }
        typedStack.push(event);
      } else if (event.kind === "backspace") {
        const removed = typedStack.pop();
        if (removed?.err) { pendingCorrection = false; unresolvedRun = 0; }
      }
    });
  });

  const short = rounds.map((round) => ({ round, first: round.events[0]?.t ?? 0, errRate: round.events.length ? round.events.filter((event) => !!event.err).length / round.events.length : 0 }))
    .filter(({ round }) => round.text.length <= d.shortSentenceMaxLength);
  const shortMedian = median(short.map((row) => row.first));
  const rush = short.length < d.rushMinimumSentences ? undefined : {
    n: short.length,
    observed: short.filter((row) => row.first <= (shortMedian ?? 0) && row.errRate >= sessionErrorRate).length,
    confidence: "낮음" as const,
  };

  const distanceBins = [
    { name: "1u 미만", max: d.distanceBins[0] },
    { name: "1~2u", min: d.distanceBins[0], max: d.distanceBins[1] },
    { name: "2u 이상", min: d.distanceBins[1] },
  ];
  const distance = distanceBins.map((bin) => {
    const attempts = chars.filter(({ event }) => {
      if (!event.targetKey || !KEYPOS[event.targetKey]) return false;
      const key = KEYPOS[event.targetKey];
      const wrist = fingerOf(event.targetKey).startsWith("왼") ? wrists.left : wrists.right;
      const reach = Math.hypot(key.x - wrist.x, key.y - wrist.y);
      return reach >= (bin.min ?? 0) && (bin.max === undefined || reach < bin.max);
    });
    const errors = attempts.filter(({ event }) => !event.ok).length;
    return { band: bin.name, k: errors, n: attempts.length, wilson95: wilson(errors, attempts.length) };
  });

  const fingerStats = new Map<string, { k: number; n: number }>();
  const positions = new Map<string, { k: number; n: number }>();
  const batchim = new Map<string, { k: number; n: number }>();
  rounds.forEach((round) => {
    const expected = keysForText(round.text);
    const perChar: Record<number, number> = {};
    round.events.filter((event) => event.kind === "char").forEach((event) => {
      if (!event.targetKey || event.pos >= expected.length) return;
      const want = expected[event.pos];
      if (!want || (event.targetShift || event.typedShift)) return;
      const finger = fingerOf(event.targetKey);
      const f = fingerStats.get(finger) ?? { k: 0, n: 0 }; f.n++; if (!event.ok) f.k++; fingerStats.set(finger, f);
      const offset = perChar[want.ch] ?? 0; perChar[want.ch] = offset + 1;
      if (want.lang !== "ko") return;
      const textChar = [...round.text][want.ch];
      const code = textChar.charCodeAt(0) - 0xac00;
      const position = offset === 0 ? "초성" : offset === 1 ? "중성" : "종성";
      const p = positions.get(position) ?? { k: 0, n: 0 }; p.n++; if (!event.ok) p.k++; positions.set(position, p);
      const final = batchim.get(code % 28 === 0 ? "받침 없음" : "받침 있음") ?? { k: 0, n: 0 };
      final.n++; if (!event.ok) final.k++; batchim.set(code % 28 === 0 ? "받침 없음" : "받침 있음", final);
    });
  });
  const asRows = (map: Map<string, { k: number; n: number }>) => [...map.entries()].filter(([, value]) => value.n >= d.minimumSamples).map(([key, value]) => ({ key, ...value, wilson95: wilson(value.k, value.n) }));
  const unresolvedAlignment = aligned.some((row) => row.value === null);
  const languageRows = chars.map(({ event }) => event);
  const languageMissing = languageRows.some((event) => event.code.startsWith("Key") && event.imeKnown === undefined);
  return {
    alignment: unresolvedAlignment ? { status: "정렬 모호" as const, ...count } : { status: "집계됨" as const, ...count },
    spaces: count.ambiguous ? undefined : spaces,
    keyTiming: {
      status: hasMissingKeyup ? "집계 안 됨" as const : "집계됨" as const,
      simultaneous: hasMissingKeyup ? undefined : overlapping,
      duplicate: hasMissingKeyup ? undefined : timing.duplicate,
      duplicateThresholdMs: d.duplicateKeyMs,
      shiftReleaseDelayMedianMs: timing.shiftReleaseDelaysMs.length ? median(timing.shiftReleaseDelaysMs) : undefined,
      n: timing.n,
    },
    languageState: {
      status: languageMissing ? "집계 안 됨" as const : "집계됨" as const,
      mismatchCount: languageMissing ? undefined : languageRows.filter((event) => event.err === "한/영 상태").length,
      ambiguousCount: languageRows.filter((event) => event.err === "정렬 모호").length,
    },
    unresolvedTypos: { maximumFollowingKeys: maxUnresolved, status: rounds.some((round) => round.events.some((event) => event.kind === "backspace")) ? "집계됨" as const : "집계 안 됨" as const },
    slowdown: { baselineMedianMs: overallMedianMs, afterError: slowdownAfterErrors, ratioThreshold: d.slowdownRatio, chainCount: eligibleChains, chainWindowMs: d.typoChainWindowMs, status: eligibleChains === undefined ? "연쇄 표본 부족" as const : "집계됨" as const },
    rush,
    distance,
    fingers: asRows(fingerStats),
    koreanPositions: asRows(positions),
    batchim: asRows(batchim),
    intervals: { n: intervals.length, medianMs: overallMedianMs },
  };
}

