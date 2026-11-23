import thresholds from "../../config/thresholds.json";
import { DEFAULT_WRISTS, KEYS, KEYPOS, TYPABLE, fingerOf, handOf, keysForText } from "./keyboard";
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
  if (!s.length) return undefined;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const wilson = (k: number, n: number) => {
  if (!n) return undefined;
  const z = 1.96, p = k / n, den = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / den;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return { lower: center - half, upper: center + half };
};

const reachDistance = (code: string, wrists: Session["wristAnchors"], dzMm: number) => {
  const key = KEYPOS[code];
  if (!key || !wrists) return undefined;
  const hand = handOf(code, wrists);
  const wrist = hand === "L" ? wrists.left : hand === "R" ? wrists.right :
    Math.hypot(key.x - wrists.left.x, key.y - wrists.left.y) <= Math.hypot(key.x - wrists.right.x, key.y - wrists.right.y) ? wrists.left : wrists.right;
  return Math.hypot(key.x - wrist.x, key.y - wrist.y, dzMm / 19);
};

export function calculateReachCutoffs(wrists: NonNullable<Session["wristAnchors"]>, dzMm: number) {
  const distances = KEYS.filter((key) => TYPABLE.has(key.code))
    .map((key) => reachDistance(key.code, wrists, dzMm))
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  return [distances[Math.floor(distances.length / 3)], distances[Math.floor(2 * distances.length / 3)]] as [number, number];
}

export function shouldIgnoreDuplicateImeSpace(now: number, previousSpace: number, previousImeSignal: boolean, imeSignal: boolean) {
  return (imeSignal || previousImeSignal) && now - previousSpace < thresholds.detection.duplicateKeyMs;
}

export function shouldIgnoreDuplicateImeKey(
  now: number,
  previous: { code: string; shift: boolean; imeSignal: boolean; t: number } | undefined,
  current: { code: string; shift: boolean; imeSignal: boolean },
) {
  return !!previous && (previous.imeSignal || current.imeSignal) &&
    previous.code === current.code && previous.shift === current.shift &&
    now - previous.t < thresholds.detection.duplicateKeyMs;
}

function editToken(code: string | undefined, shift: boolean | undefined) {
  return code ? `${code}${shift ? "+Shift" : ""}` : "";
}

function getAlignment(round: RoundRecord) {
  const activeKeys: KeyEvent[] = [];
  for (const event of round.events) {
    if (event.kind === "char" || event.kind === "overflow") activeKeys.push(event);
    else if (event.kind === "backspace") activeKeys.pop();
  }
  const chars = activeKeys.filter((event) => !event.removed);
  const unresolved = chars.some((event) => !event.typedKey || (event.kind === "char" && !event.targetKey));
  const expected = keysForText(round.text).map((key) => editToken(key.code, key.shift));
  const stack: KeyEvent[] = [];
  const episodes = new Map<number, KeyEvent[]>();
  let episodeId = 0;
  for (const event of round.events) {
    if (event.kind === "char" || event.kind === "overflow") {
      if (event.err || event.ok === false) {
        if (!event.episodeId && !stack.some((item) => !!item.err || item.ok === false)) episodeId++;
        const id = event.episodeId ?? episodeId;
        const group = episodes.get(id) ?? [];
        group.push(event);
        episodes.set(id, group);
      }
      stack.push(event);
    } else if (event.kind === "backspace") {
      stack.pop();
    }
  }
  const counts = { substitution: 0, omission: 0, extra: 0, transposition: 0, ambiguous: 0, n: 0 };
  if (unresolved) counts.ambiguous = episodes.size, counts.n = episodes.size;
  if (unresolved) return { chars, episodes, counts, unresolved };
  for (const group of episodes.values()) {
    counts.n++;
    let classification: keyof typeof counts | undefined;
    if (group.some((event) => event.kind === "overflow")) classification = "extra";
    else {
      const first = group[0];
      const pos = first.pos;
      const expectedAt = expected[pos];
      const typedAt = editToken(first.typedKey, first.typedShift ?? first.shift);
      const expectedNext = expected[pos + 1];
      const typedNext = group[1] ? editToken(group[1].typedKey, group[1].typedShift ?? group[1].shift) : undefined;
      if (group.length === 2 && first.pos + 1 === group[1].pos && typedAt === expected[pos + 1] && typedNext === expected[pos]) classification = "transposition";
      else if (expectedAt && expectedNext && typedAt === expectedNext && group.every((event) => {
        const target = expected[event.pos + 1];
        return target === editToken(event.typedKey, event.typedShift ?? event.shift);
      })) classification = "omission";
      else if (expectedAt) classification = "substitution";
    }
    if (classification) counts[classification]++;
    else counts.ambiguous++;
  }
  return { chars, episodes, counts, unresolved };
}

export function analyzeDetection(session: Session, sessionErrorRate: number) {
  const d = thresholds.detection;
  const wrists = session.wristAnchors ?? DEFAULT_WRISTS;
  const rounds = session.rounds;
  const aligned = rounds.map((round) => ({ round, value: getAlignment(round) }));
  const unresolvedAlignment = aligned.some((row) => row.value.unresolved);
  const count = { match: 0, substitution: 0, omission: 0, extra: 0, transposition: 0, ambiguous: 0, n: 0 };
  const spaces = { omission: 0, extra: 0, position: 0, n: 0 };
  aligned.forEach(({ value }) => {
    Object.assign(count, Object.fromEntries(Object.entries(value.counts).map(([key, n]) => [key, count[key as keyof typeof count] + n])));
    value.episodes.forEach((episode) => episode.forEach((event) => {
      if (!event.targetKey || !event.typedKey) return;
      if (event.targetKey === "Space" || event.typedKey === "Space") {
        spaces.n++;
        if (event.targetKey === "Space" && event.typedKey !== "Space") spaces.omission++;
        else if (event.typedKey === "Space" && event.targetKey !== "Space") spaces.extra++;
        else spaces.position++;
      }
    }));
  });

  const chars = rounds.flatMap((round) => round.events.filter((event) => (event.kind === "char" || event.kind === "overflow") && !event.removed).map((event) => ({ round, event })));
  const timing = { simultaneous: 0, duplicate: 0, shiftReleaseDelaysMs: [] as number[], n: chars.length };
  rounds.forEach((round) => {
    const keys = round.events.filter((event) => event.kind === "char" || event.kind === "overflow");
    for (let i = 0; i < keys.length; i++) {
      const current = keys[i];
      const previous = keys[i - 1];
      if (previous && !crossesPauseBoundary(previous, current) && previous.pauseSeq === current.pauseSeq && previous.pauseSeq === previous.keyupPauseSeq) {
        if (previous.keyupT === undefined) timing.simultaneous = -1;
        else if (current.t < previous.keyupT) timing.simultaneous++;
      }
      if (previous && previous.code === current.code && current.targetKey && current.targetKey !== current.code &&
        !previous.ime && !current.ime && !crossesPauseBoundary(previous, current) &&
        current.t >= previous.t && current.t - previous.t < d.duplicateKeyMs) timing.duplicate++;
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

  const dzMm = session.dz ?? d.defaultDzMm;
  const calculatedCutoffs = session.wristAnchors ? calculateReachCutoffs(session.wristAnchors, dzMm) : undefined;
  const reachCutoffs = session.reachCutoffs ?? calculatedCutoffs;
  const distanceBands = ["가까움", "보통", "멂"] as const;
  const distance = distanceBands.map((band, bandIndex) => {
    const attempts = chars.filter(({ event }) => {
      if (event.episodeRole === "cascade") return false;
      if (!reachCutoffs || !session.wristAnchors || !event.targetKey) return false;
      const reach = reachDistance(event.targetKey, session.wristAnchors, dzMm);
      if (reach === undefined) return false;
      return bandIndex === 0 ? reach <= reachCutoffs[0]
        : bandIndex === 1 ? reach > reachCutoffs[0] && reach <= reachCutoffs[1]
          : reach > reachCutoffs[1];
    });
    const errors = attempts.filter(({ event }) => !event.ok && event.episodeRole !== "cascade").length;
    return { band, k: errors, n: attempts.length, wilson95: wilson(errors, attempts.length) };
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
      const offset = perChar[want.ch] ?? 0; perChar[want.ch] = offset + 1;
      if (event.episodeRole === "cascade") return;
      const finger = fingerOf(event.targetKey);
      const f = fingerStats.get(finger) ?? { k: 0, n: 0 }; f.n++; if (!event.ok) f.k++; fingerStats.set(finger, f);
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
  const languageRows = rounds.flatMap((round) => round.events)
    .filter((event) => (event.kind === "char" || event.kind === "overflow") && event.code.startsWith("Key"));
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
      n: languageRows.length,
      mismatchCount: languageMissing ? undefined : languageRows.filter((event) => event.err === "한/영 상태").length,
      removedMismatchCount: languageMissing ? undefined : languageRows.filter((event) => event.err === "한/영 상태" && event.removed).length,
      ambiguousCount: languageRows.filter((event) => event.err === "정렬 모호").length,
      processSignalCount: languageRows.filter((event) => event.imeEvidence === "process").length,
      legacy229SignalCount: languageRows.filter((event) => event.imeEvidence === "legacy-229").length,
      composingSignalCount: languageRows.filter((event) => event.imeEvidence === "composing").length,
      latinKeySignalCount: languageRows.filter((event) => event.imeEvidence === "latin-key" || (event.imeKnown === true && event.ime !== true)).length,
      unknownSignalCount: languageRows.filter((event) => event.imeEvidence === "unknown" || event.imeKnown === undefined).length,
      toggleKeyPressCount: rounds.flatMap((round) => round.events).filter((event) => event.inputModeKey === "toggle" || event.code === "Lang1" || event.code === "Hangul").length,
    },
    unresolvedTypos: { maximumFollowingKeys: maxUnresolved, status: rounds.some((round) => round.events.some((event) => event.kind === "backspace")) ? "집계됨" as const : "집계 안 됨" as const },
    slowdown: { baselineMedianMs: overallMedianMs, afterError: slowdownAfterErrors, ratioThreshold: d.slowdownRatio, chainCount: eligibleChains, chainWindowMs: d.typoChainWindowMs, status: eligibleChains === undefined ? "연쇄 표본 부족" as const : "집계됨" as const },
    rush,
    distance,
    distanceSettings: {
      cutoffs: reachCutoffs,
      dzMm,
      status: !session.wristAnchors ? "집계 안 됨" as const : session.dz === undefined || !session.reachCutoffs ? "기본값 적용" as const : "기록된 설정" as const,
    },
    fingers: asRows(fingerStats),
    koreanPositions: asRows(positions),
    batchim: asRows(batchim),
    intervals: { n: intervals.length, medianMs: overallMedianMs },
  };
}

