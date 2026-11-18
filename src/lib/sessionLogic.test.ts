import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze } from "./stats";
import { activeElapsedMs, calculatePauseMetrics, crossesPauseBoundary, shouldIgnoreKeyWhilePaused } from "./pauseMetrics";
import { createDesktopSession, readSession } from "./sessionData";
import { createRoundSelection, isSentenceLengthAllowed, sentenceUseCounts } from "./roundSelection";
import { loadSessions, saveSession } from "./storage";
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
