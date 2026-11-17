import { KEYPOS, direction, fingerOf, handOf, keyLabel, keysForText } from "./keyboard";
import type { RoundRecord, Session } from "./types";

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
    i, id: r.id, text: r.text, tags: r.tags, keys: exp.length,
    kpm: (exp.length * 60000) / ms, cpm: (r.text.length * 60000) / ms, ms, first: firstT,
    presses: chars.length, errs, backspaces: r.events.filter((e) => e.kind === "backspace").length,
    words, corrections, reErr,
  };
}

export function analyze(session: Session) {
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

  const byKind: Record<string, number> = {};
  errEvents.forEach((e) => (byKind[e.err!] = (byKind[e.err!] ?? 0) + 1));

  const keys: Record<string, { n: number; err: number; msList: number[] }> = {};
  const hand = { same: [] as number[], alt: [] as number[] };
  session.rounds.forEach((r) =>
    r.events.forEach((e, idx) => {
      if (e.kind !== "char" || !e.exp) return;
      const k = (keys[e.exp] ??= { n: 0, err: 0, msList: [] });
      k.n++;
      if (!e.ok) k.err++;
      const prev = r.events[idx - 1];
      if (e.ok && prev && prev.kind === "char" && prev.ok && prev.exp && e.t - prev.t <= 2500) {
        k.msList.push(e.t - prev.t);
        const a = handOf(prev.exp);
        const b = handOf(e.exp);
        if (a && b && prev.exp !== e.exp) (a === b ? hand.same : hand.alt).push(e.t - prev.t);
      }
    }),
  );

  const pairMap = new Map<string, { exp: string; act: string; n: number; dist: number[]; dx: number; dy: number }>();
  const other = errEvents.filter((e) => e.kind === "char" && e.exp && e.exp !== e.code);
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
    sameHand: pct(other.filter((e) => handOf(e.code) && handOf(e.code) === handOf(e.exp!)).length, other.length),
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
    .filter((t) => t.n >= 2);

  const slowWords = rounds
    .flatMap((r) => r.words)
    .filter((w) => w.keys >= 3)
    .sort((a, b) => a.kpm - b.kpm)
    .slice(0, 6);

  const keyStats = Object.entries(keys).map(([code, k]) => ({
    code, label: keyLabel(code), n: k.n, err: k.err, errRate: pct(k.err, k.n),
    ms: mean(k.msList), msN: k.msList.length,
  }));
  const allMs = mean(keyStats.flatMap((k) => Array(k.msN).fill(k.ms)));

  const weakKeys = keyStats.filter((k) => k.n >= 3 && k.err >= 2).sort((a, b) => b.errRate - a.errRate).slice(0, 5);
  const slowKeys = keyStats.filter((k) => k.msN >= 3).sort((a, b) => b.ms - a.ms).slice(0, 5);

  const insights: string[] = [];
  const sec = (v: number) => (v / 1000).toFixed(2);
  insights.push(
    `문장이 뜬 뒤 첫 키를 누르기까지 평균 ${sec(totals.first)}초 걸렸어요.` +
      (totals.first > 1500 ? " 읽는 시간이 길어요. 문장을 먼저 훑는 습관이 있는지 보세요." : ""),
  );
  if (weakKeys.length)
    insights.push(`가장 자주 틀린 키는 ${weakKeys.slice(0, 3).map((k) => `${k.label} ${k.errRate.toFixed(0)}%`).join(", ")}예요.`);
  if (dirStat.n >= 5) {
    if (dirStat.adjacent >= 55) insights.push(`틀린 키의 ${dirStat.adjacent.toFixed(0)}%가 눌러야 할 키 바로 옆 키였어요. 손가락 위치가 조금씩 어긋나는 오타예요.`);
    if (Math.abs(dirStat.mx) >= 0.4)
      insights.push(`오타는 눌러야 할 키보다 평균 ${Math.abs(dirStat.mx).toFixed(1)}칸 ${dirStat.mx > 0 ? "오른쪽" : "왼쪽"}에 치우쳤어요.`);
    if (dirStat.next >= 15) insights.push(`오타의 ${dirStat.next.toFixed(0)}%는 바로 다음에 칠 키를 먼저 누른 경우예요. 손이 생각보다 앞서가요.`);
    if (dirStat.prev >= 15) insights.push(`오타의 ${dirStat.prev.toFixed(0)}%는 방금 친 키를 한 번 더 누른 경우예요.`);
  }
  const shiftErr = (byKind["Shift 빠뜨림"] ?? 0) + (byKind["Shift 잘못 누름"] ?? 0);
  if (shiftErr >= 2) insights.push(`Shift 관련 오입력이 ${shiftErr}번 있었어요.`);
  if (byKind["한/영 상태"]) insights.push(`한/영 상태가 맞지 않아 틀린 입력이 ${byKind["한/영 상태"]}번 있었어요. 한글과 영문이 섞인 문장에서 전환을 놓치는지 보세요.`);
  if (byKind["Caps Lock"]) insights.push(`Caps Lock 때문에 틀린 입력이 ${byKind["Caps Lock"]}번 있었어요.`);
  const slowOnes = slowKeys.filter((k) => allMs && k.ms >= allMs * 1.25);
  if (slowOnes.length)
    insights.push(`${slowOnes.slice(0, 3).map((k) => k.label).join(", ")} 키에서 속도가 떨어졌어요. 평균보다 ${(slowOnes[0].ms / allMs).toFixed(1)}배까지 느려요.`);
  if (hand.same.length >= 5 && hand.alt.length >= 5 && mean(hand.same) > mean(hand.alt) * 1.15)
    insights.push(`같은 손으로 이어 칠 때(${Math.round(mean(hand.same))}ms)가 두 손을 번갈아 칠 때(${Math.round(mean(hand.alt))}ms)보다 느려요.`);
  if (corr.n) insights.push(`오타를 고치는 데 평균 ${sec(corr.mean)}초 걸렸고, 같은 자리에서 다시 틀린 적은 ${corr.reErr}번이에요.`);
  const base = totals.kpm;
  const weakTag = tags.filter((t) => t.kpm < base * 0.93).sort((a, b) => a.kpm - b.kpm)[0];
  if (weakTag) insights.push(`'${weakTag.tag}' 문장에서 평균보다 ${Math.round((1 - weakTag.kpm / base) * 100)}% 느렸어요.`);

  return { rounds, totals, byKind, keyStats, pairs, dirStat, corr, tags, slowWords, weakKeys, slowKeys, hand: { same: mean(hand.same), alt: mean(hand.alt) }, insights };
}

export type Analysis = ReturnType<typeof analyze>;

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
    weakKeys: a.weakKeys.map((k) => ({ key: k.label, finger: fingerOf(k.code), errPct: Math.round(k.errRate), n: k.n })),
    slowKeys: a.slowKeys.map((k) => ({ key: k.label, finger: fingerOf(k.code), ms: Math.round(k.ms) })),
    typoPairs: a.pairs.map((p) => ({
      expected: p.exp, expectedFinger: fingerOf(p.expCode), typed: p.act, typedFinger: fingerOf(p.actCode),
      n: p.n, dist: r1(p.dist), dir: p.dir,
    })),
    typoTendency: {
      n: a.dirStat.n, meanDx: r1(a.dirStat.mx), meanDy: r1(a.dirStat.my), adjacentPct: Math.round(a.dirStat.adjacent),
      repeatPrevPct: Math.round(a.dirStat.prev), pressedNextPct: Math.round(a.dirStat.next),
    },
    correction: { count: a.corr.n, meanMs: Math.round(a.corr.mean), reErrors: a.corr.reErr },
    handTransitionMs: { sameHand: Math.round(a.hand.same), alternate: Math.round(a.hand.alt) },
    slowWords: a.slowWords.map((w) => ({ word: w.word, kpm: Math.round(w.kpm) })),
    byTag: a.tags.map((t) => ({ tag: t.tag, n: t.n, kpm: Math.round(t.kpm), errPct: r1(t.errRate) })),
  };
}
