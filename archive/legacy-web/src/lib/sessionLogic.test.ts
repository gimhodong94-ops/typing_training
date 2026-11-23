import { afterEach, describe, expect, it, vi } from "vitest";
import { aiSummary, analyze, compareWeakKeys, wilsonInterval } from "./stats";
import { activeElapsedMs, calculatePauseMetrics, crossesPauseBoundary, shouldIgnoreKeyWhilePaused } from "./pauseMetrics";
import { isShiftMismatch } from "./keyboard";
import { createDesktopSession, readSession } from "./sessionData";
import { createRoundSelection, isSentenceLengthAllowed, sentenceUseCounts } from "./roundSelection";
import { loadSessions, saveSession } from "./storage";
import { checkText } from "../../shared/rules";
import type { RoundRecord, Session } from "./types";
import type { Sentence } from "./sentences";

afterEach(() => vi.unstubAllGlobals());

function rows(count: number, text = "가".repeat(30)): Sentence[] {
  return Array.from({ length: count }, (_, i) => ({ id: `s${i}`, category: "test", text: `${text}${String(i).padStart(2, "0")}`, tags: [] }));
}

function randomSequence() {
  let seed = 17;
  return () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
}

describe("desktop session selection", () => {
  it.each([10, 20, 30])("selects %i unique sentences inside the existing ±30% length band", (count) => {
    const selection = createRoundSelection(rows(78), count, {}, randomSequence());
    expect(selection.rounds).toHaveLength(count);
    expect(new Set(selection.rounds.map((row) => row.text)).size).toBe(count);
    expect(selection.withinRange).toBe(true);
    expect(selection.totalLength).toBeGreaterThanOrEqual(selection.minimumTotal);
    expect(selection.totalLength).toBeLessThanOrEqual(selection.maximumTotal);
    expect(selection.averageLength).toBe(rows(78).reduce((sum, row) => sum + row.text.length, 0) / 78);
  });

  it("prefers less-used sentences and rejects duplicate text or insufficient pools", () => {
    const input = [...rows(12), { id: "duplicate", category: "test", text: rows(12)[0].text, tags: [] }];
    const usage = { [input[0].text]: 100 };
    const selection = createRoundSelection(input, 10, usage, () => 0.5);
    expect(selection.rounds).toHaveLength(10);
    expect(new Set(selection.rounds.map((row) => row.text)).size).toBe(10);
    expect(selection.rounds.some((row) => row.text === input[0].text)).toBe(false);
    expect(createRoundSelection(input.slice(0, 3), 4).error).toContain("만들 수 없어요");
  });

  it("applies the Hangul-dependent sentence length limits", () => {
    expect(isSentenceLengthAllowed("가".repeat(100))).toBe(true);
    expect(isSentenceLengthAllowed("가".repeat(101))).toBe(false);
    expect(isSentenceLengthAllowed("a".repeat(150))).toBe(true);
    expect(isSentenceLengthAllowed("a".repeat(151))).toBe(false);
  });

  it("applies dominant-language limits and raw string length at boundaries", () => {
    expect(checkText("가".repeat(100))).toEqual([]);
    expect(checkText("가".repeat(101))).toContain("길이 101자 (허용 5~100자)");
    expect(checkText("a".repeat(150))).toEqual([]);
    expect(checkText("a".repeat(151))).toContain("길이 151자 (허용 5~150자)");
    expect(checkText("a ".repeat(75))).toEqual([]);
    expect(checkText("a ".repeat(75) + "!")).toContain("길이 151자 (허용 5~150자)");
    expect(checkText("가".repeat(50) + "a".repeat(50))).toEqual([]); // Korean/English tie
    expect(checkText("가".repeat(49) + "a".repeat(52))).toEqual([]); // English dominant, above Korean cap
    expect(checkText("1! ".repeat(33) + "1")).toEqual([]); // No language letters
  });

  it("uses the closest attempted selection and reports retry details at the limit", () => {
    const uneven = [
      { id: "short1", category: "test", text: "a".repeat(10), tags: [] },
      { id: "short2", category: "test", text: "b".repeat(10), tags: [] },
      { id: "short3", category: "test", text: "c".repeat(10), tags: [] },
      { id: "short4", category: "test", text: "d".repeat(10), tags: [] },
      { id: "short5", category: "test", text: "e".repeat(10), tags: [] },
      { id: "short6", category: "test", text: "f".repeat(10), tags: [] },
      { id: "short7", category: "test", text: "g".repeat(10), tags: [] },
      { id: "long", category: "test", text: "h".repeat(100), tags: [] },
    ];
    const selection = createRoundSelection(uneven, 2, {}, () => 0.5, 2);
    expect(selection.usedFallback).toBe(true);
    expect(selection.attempts).toBe(2);
    expect(selection.totalLength).toBe(20);
  });

  it("counts historical sentence use by text", () => {
    const text = "가나다";
    const history = [{ id: 1, at: "", keyboard: "desktop" as const, rounds: [{ id: "a", text, tags: [], events: [] }] }];
    expect(sentenceUseCounts(history)[text]).toBe(1);
  });
});

describe("session compatibility and pauses", () => {
  it("calculates the Wilson 95% interval for 4 errors in 23 attempts", () => {
    const interval = wilsonInterval(4, 23);
    expect(interval.lower).toBeCloseTo(0.073, 2);
    expect(interval.upper).toBeCloseTo(0.369, 2);
  });

  it("compares weak-key Wilson intervals between adjacent sessions", () => {
    const make = (id: number, errors: number): Session => ({ id, at: "", keyboard: "desktop", rounds: [{ id: `cmp${id}`, text: "가".repeat(10), tags: [], events: Array.from({ length: 10 }, (_, pos) => ({
      t: pos * 100, code: "KeyA", kind: "char" as const, pos, shift: false, caps: false, exp: "KeyA", targetKey: "KeyA", typedKey: "KeyA", targetShift: false, typedShift: false,
      ok: pos >= errors, err: pos < errors ? "다른 키" : undefined,
    })) }] });
    const rows = compareWeakKeys(make(1, 2), make(2, 3));
    expect(rows[0]).toMatchObject({ code: "KeyA", previous: { k: 2, n: 10 }, current: { k: 3, n: 10 }, overlap: true });
  });

  it("calculates tags from sentence text without requiring tags in a stored session", () => {
    const round = { id: "computed", text: "웃음 없는 하루는 낭비한 하루다.", events: [] };
    const original = structuredClone(round);
    const analysis = analyze({ id: 102, at: "", keyboard: "desktop", rounds: [round] });
    expect(analysis.rounds[0].tags.length).toBeGreaterThan(0);
    expect(round).toEqual(original);
    expect(round).not.toHaveProperty("tags");
  });

  it("removes keys with fewer than five attempts from weak ranking and summary", () => {
    const events = Array.from({ length: 4 }, (_, pos) => ({
      t: pos * 100, code: pos < 3 ? "KeyB" : "KeyA", kind: "char" as const, pos, shift: false, caps: false,
      exp: "KeyB", targetKey: "KeyB", typedKey: pos < 3 ? "KeyA" : "KeyB", targetShift: false, typedShift: false,
      ok: pos === 3, err: pos < 3 ? "다른 키" : undefined,
    }));
    const session: Session = { id: 99, at: "", keyboard: "desktop", rounds: [{ id: "few", text: "가가가가", tags: [], events }] };
    const analysis = analyze(session);
    expect(analysis.keyStats.find((key) => key.code === "KeyB")?.n).toBe(4);
    expect(analysis.weakKeys.some((key) => key.code === "KeyB")).toBe(false);
    expect(aiSummary(session, analysis).weakKeys.some((key) => key.key.startsWith("B"))).toBe(false);
  });

  it("calculates code confidence and tags a P shift mismatch as a Shift error", () => {
    const events = Array.from({ length: 30 }, (_, pos) => ({
      t: pos * 100, code: pos < 20 ? "KeyO" : "KeyP", kind: "char" as const, pos, shift: false, caps: false,
      exp: "KeyP", targetKey: "KeyP", typedKey: pos < 20 ? "KeyO" : "KeyP", targetShift: false, typedShift: false,
      ok: pos >= 20, err: pos < 20 ? "다른 키" : undefined,
    }));
    const filler = Array.from({ length: 1000 }, (_, pos) => ({
      t: pos * 100, code: "KeyA", kind: "char" as const, pos, shift: false, caps: false,
      exp: "KeyA", targetKey: "KeyA", typedKey: "KeyA", targetShift: false, typedShift: false, ok: true,
    }));
    const session: Session = { id: 100, at: "", keyboard: "desktop", rounds: [
      { id: "p", text: "x", tags: [], events }, { id: "a", text: "x", tags: [], events: filler },
    ] };
    const analysis = analyze(session);
    expect(analysis.weakKeys.find((key) => key.code === "KeyP")?.confidence).toBe("높음");
    expect(isShiftMismatch("KeyP", "ko", false, true)).toBe(true);
    expect(isShiftMismatch("KeyA", "ko", false, true)).toBe(false);
  });

  it("counts typing ㅖ (Shift+P) at a ㅔ (P) target as a Shift error and separates it from finger stats", () => {
    const event = {
      t: 0, code: "KeyP", kind: "char" as const, pos: 0, shift: true, caps: false, exp: "KeyP",
      expShift: false, targetKey: "KeyP", typedKey: "KeyP", targetShift: false, typedShift: true,
      shiftSide: "ShiftLeft" as const, ok: false, err: "Shift 실수",
    };
    const analysis = analyze({ id: 101, at: "", keyboard: "desktop", rounds: [{ id: "shift", text: "ㅔ", tags: [], events: [event] }] });
    expect(analysis.byKind["Shift 실수"]).toBe(1);
    expect(analysis.shiftCombo).toMatchObject({ n: 1, err: 1 });
    expect(analysis.keyStats.find((key) => key.code === "KeyP")).toBeUndefined();
  });
  it("reads old sessions with round count from sentence count and no pauses without mutating the stored object", () => {
    const legacy = { id: 1, at: "", keyboard: "desktop" as const, rounds: [{ id: "a", text: "가", tags: [], events: [] }] };
    const before = structuredClone(legacy);
    const read = readSession(legacy);
    expect(read.roundCount).toBe(1);
    expect(read.pauses).toEqual([]);
    expect(read.schemaVersion).toBeUndefined();
    expect(legacy).toEqual(before);
  });

  it("keeps old saved feedback readable after the response shape changes", () => {
    const oldFeedback = {
      headline: "입력이 안정적이에요.", strengths: ["오타가 적어요."],
      weaknesses: [{ title: "속도 변화", evidence: "키 입력 속도 차이", advice: "천천히 연습해요." }],
      nextStep: "한 문장씩 연습해요.",
    };
    const legacy = { id: 4, at: "", keyboard: "desktop" as const, rounds: [{ id: "a", text: "가", tags: [], events: [] }], feedback: oldFeedback };
    const read = readSession(legacy as unknown as Session);
    expect(read.feedback?.strengths[0]).toEqual({ text: "오타가 적어요.", evidence: "" });
    expect(read.feedback?.weaknesses[0]).toMatchObject({ confidence: "낮음", possibleCauses: [], checkNext: "" });
    expect(legacy.feedback).toEqual(oldFeedback);
  });

  it("creates v2 session records and preserves legacy stored fields when saving feedback", () => {
    const legacy = { id: 1, at: "", keyboard: "desktop" as const, rounds: [{ id: "a", text: "가", tags: [], events: [] }] };
    const stored = new Map<string, string>([["typing-coach-sessions-v1", JSON.stringify([legacy])]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
    });
    const loaded = loadSessions()[0];
    expect(loaded.roundCount).toBe(1);
    saveSession({ ...loaded, feedback: { headline: "확인", strengths: [], weaknesses: [], nextStep: "" } });
    const savedLegacy = JSON.parse(stored.get("typing-coach-sessions-v1")!)[0];
    expect(savedLegacy.roundCount).toBeUndefined();
    expect(savedLegacy.pauses).toBeUndefined();
    expect(savedLegacy.schemaVersion).toBeUndefined();
    expect(savedLegacy.feedback.headline).toBe("확인");

    const v2 = createDesktopSession({ id: 2, at: "", keyboard: "desktop", rounds: [] }, 10, []);
    expect(v2).toMatchObject({ roundCount: 10, pauses: [], schemaVersion: 2 });
  });

  it("ignores paused input and freezes the active timer", () => {
    expect(shouldIgnoreKeyWhilePaused(true)).toBe(true);
    expect(shouldIgnoreKeyWhilePaused(false)).toBe(false);
    const pause = [{ seq: 1, startMs: 200, endMs: 700 }];
    expect(activeElapsedMs(0, 1000, pause)).toBe(500);
    expect(activeElapsedMs(0, 1000, pause, 800)).toBe(300);
  });

  const pausedRound: RoundRecord = {
    id: "pause-test", text: "abcd", tags: [], events: [
      { t: 0, sessionMs: 0, pauseSeq: 0, code: "KeyA", kind: "char", pos: 0, shift: false, caps: false, exp: "KeyA", ok: true },
      { t: 100, sessionMs: 100, pauseSeq: 0, code: "KeyB", kind: "char", pos: 1, shift: false, caps: false, exp: "KeyB", ok: true },
      { t: 250, sessionMs: 750, pauseSeq: 1, resumedAfterPause: true, resumeDelayMs: 50, code: "KeyC", kind: "char", pos: 2, shift: false, caps: false, exp: "KeyC", ok: true },
      { t: 350, sessionMs: 850, pauseSeq: 1, code: "KeyD", kind: "char", pos: 3, shift: false, caps: false, exp: "KeyD", ok: true },
    ],
  };
  const pausedSession: Session = { id: 2, at: "", keyboard: "desktop", roundCount: 1, pauses: [{ seq: 1, startMs: 200, endMs: 700 }], schemaVersion: 2, rounds: [pausedRound] };

  it("excludes pause-crossing intervals from rhythm and keeps the first resume delay separately", () => {
    const previous = pausedRound.events[1];
    const resumed = pausedRound.events[2];
    expect(crossesPauseBoundary(previous, resumed)).toBe(true);
    const analysis = analyze(pausedSession);
    expect(analysis.keyStats.find((key) => key.code === "KeyC")?.msN).toBe(0);
    expect(analysis.pauseMetrics.resumeDelaysMs).toEqual([50]);
    expect(calculatePauseMetrics(pausedSession).count).toBe(1);
  });

  it("subtracts paused time from CPM and reports pre-pause and post-pause CPM", () => {
    const analysis = analyze(pausedSession);
    expect(analysis.rounds[0].ms).toBe(350);
    expect(analysis.totals.cpm).toBeCloseTo((4 * 60000) / 350);
    expect(analysis.pauseMetrics.totalMs).toBe(500);
    expect(analysis.pauseMetrics.prePauseCpm).toBe(1200);
    expect(analysis.pauseMetrics.postPauseCpm).toBe(800);
  });

  it("keeps legacy session speed results unchanged and removes pauses from first-input delay", () => {
    const legacyRound: RoundRecord = {
      id: "legacy", text: "ab", tags: [], events: [
        { t: 0, code: "KeyA", kind: "char", pos: 0, shift: false, caps: false, exp: "KeyA", ok: true },
        { t: 100, code: "KeyB", kind: "char", pos: 1, shift: false, caps: false, exp: "KeyB", ok: true },
      ],
    };
    const legacy: Session = { id: 3, at: "", keyboard: "desktop", rounds: [legacyRound] };
    const compatible = { ...legacy, roundCount: 1, pauses: [] };
    expect(analyze(compatible).totals).toEqual(analyze(legacy).totals);

    const pausedBeforeTyping: Session = {
      ...pausedSession,
      pauses: [{ seq: 1, startMs: 100, endMs: 700 }],
      rounds: [{
        ...pausedRound,
        events: pausedRound.events.slice(2).map((event, index) => ({
          ...event,
          t: index * 100 + 150,
          sessionMs: index * 100 + 750,
          pauseSeq: 1,
          resumedAfterPause: index === 0,
          resumeDelayMs: index === 0 ? 50 : undefined,
        })),
      }],
    };
    expect(analyze(pausedBeforeTyping).totals.first).toBe(150);
  });
});
