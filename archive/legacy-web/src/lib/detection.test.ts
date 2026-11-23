import { describe, expect, it } from "vitest";
import { analyzeDetection, alignKeySequences, shouldIgnoreDuplicateImeSpace } from "./detection";
import { analyze } from "./stats";
import type { KeyEvent, RoundRecord, Session } from "./types";

function event(pos: number, t: number, code = "KeyA", extra: Partial<KeyEvent> = {}): KeyEvent {
  return { t, keyupT: t + 10, code, kind: "char", pos, shift: false, caps: false,
    targetKey: code, typedKey: code, targetShift: false, typedShift: false, ok: true, ...extra };
}
function session(rounds: RoundRecord[]): Session { return { id: 1, at: "", keyboard: "desktop", rounds }; }
function round(text: string, events: KeyEvent[], tags: string[] = []): RoundRecord { return { id: text + events.length, text, events, tags }; }

describe("detection scenarios", () => {
  it("1. aligns a missing key as one omission", () => {
    expect(alignKeySequences(["A", "B", "C"], ["A", "C"]).filter((edit) => edit.operation === "omission")).toHaveLength(1);
  });
  it("2. reports first key delay", () => {
    const a = analyze(session([round("가", [event(0, 420)])]));
    expect(a.totals.first).toBe(420);
  });
  it("3. records Shift release delay", () => {
    const row = round("가", [
      { t: 0, keyupT: 130, code: "ShiftLeft", kind: "modifier", pos: 0, shift: true, caps: false },
      event(0, 100, "KeyR"),
    ]);
    expect(analyzeDetection(session([row]), 0).keyTiming.shiftReleaseDelayMedianMs).toBe(30);
  });
  it("4. observes fast starts with a high error rate as low confidence", () => {
    const rounds = Array.from({ length: 5 }, (_, i) => round(`q${i}`, [event(0, 20, "KeyA", { ok: false, err: "다른 키" })]));
    expect(analyzeDetection(session(rounds), 1).rush).toMatchObject({ n: 5, observed: 5, confidence: "낮음" });
  });
  it("5. adds far-key attempts to the corresponding distance bin", () => {
    const a = analyzeDetection(session([round("가", [event(0, 0, "KeyQ", { targetKey: "KeyQ", ok: false, err: "다른 키" })])]), 0);
    expect(a.distance.reduce((sum, bin) => sum + bin.n, 0)).toBe(1);
    expect(a.distance.reduce((sum, bin) => sum + bin.k, 0)).toBe(1);
    expect(a.distance.find((bin) => bin.n === 1)?.wilson95).toBeDefined();
  });
  it("6. hides tag groups with fewer than five sentences", () => {
    const a = analyze(session([round("가", [event(0, 0)], ["짧은문장"])]));
    expect(a.tags).toEqual([]);
  });
  it("7. detects two same-key downs within the configured 50ms", () => {
    const a = analyzeDetection(session([round("가", [event(0, 0), event(1, 40)])]), 0);
    expect(a.keyTiming.duplicate).toBe(1);
  });
  it("8. aligns a missing space separately", () => {
    const edits = alignKeySequences(["KeyA", "Space", "KeyB"], ["KeyA", "KeyB"]);
    expect(edits.find((edit) => edit.expected === "Space")?.operation).toBe("omission");
    // Two quick physical spaces remain two inputs; only an IME duplicate signal is filtered.
    expect(alignKeySequences(["Space", "Space"], ["Space", "Space"])).toHaveLength(2);
    expect(shouldIgnoreDuplicateImeSpace(40, 0, false, false)).toBe(false);
    expect(shouldIgnoreDuplicateImeSpace(40, 0, false, true)).toBe(true);
    expect(shouldIgnoreDuplicateImeSpace(40, 0, true, false)).toBe(true);
  });
  it("9. detects overlapping key presses from keyup timestamps", () => {
    const a = analyzeDetection(session([round("가가", [event(0, 0, "KeyA", { keyupT: 100 }), event(1, 50, "KeyB")])]), 0);
    expect(a.keyTiming.simultaneous).toBe(1);
  });
  it("10. tracks the longest run typed after an error before Backspace", () => {
    const a = analyzeDetection(session([round("가가", [event(0, 0, "KeyA", { ok: false, err: "다른 키" }), event(1, 100),
      { t: 200, keyupT: 210, code: "Backspace", kind: "backspace", pos: 2, shift: false, caps: false }])]), 0);
    expect(a.unresolvedTypos.maximumFollowingKeys).toBe(1);
  });
  it("11. aligns adjacent swapped keys as one transposition", () => {
    const edits = alignKeySequences(["A", "B", "C"], ["B", "A", "C"]);
    expect(edits.filter((edit) => edit.operation === "transposition")).toHaveLength(1);
  });
  it("12. preserves an explicit Hangul/English input-state error", () => {
    const a = analyze(session([round("가", [event(0, 0, "KeyA", { ok: false, err: "한/영 상태" })])]));
    expect(a.byKind["한/영 상태"]).toBe(1);
  });
  it("13. combines errors under the same target finger", () => {
    const events = Array.from({ length: 6 }, (_, pos) => event(pos, pos * 100, "KeyA", {
      ok: pos > 2, err: pos <= 2 ? "다른 키" : undefined, targetShift: pos === 5,
    }));
    const a = analyzeDetection(session([round("가".repeat(5), events)]), 0);
    expect(a.fingers.find((row) => row.key === "왼손 새끼손가락")).toMatchObject({ k: 3, n: 5 });
  });
  it("14. compares the five post-error intervals to the session median and counts chains", () => {
    const events: KeyEvent[] = [];
    let t = 0;
    for (let pos = 0; pos < 16; pos++) {
      if (pos > 0) t += pos >= 6 && pos <= 10 ? 200 : 100;
      const chainError = (pos >= 5 && pos <= 7) || (pos >= 8 && pos <= 10) || (pos >= 11 && pos <= 13);
      const sessionMs = pos <= 7 ? pos * 100 : pos <= 10 ? 70_000 + (pos - 8) * 100 : pos <= 13 ? 140_000 + (pos - 11) * 100 : t;
      events.push(event(pos, t, "KeyA", { err: chainError ? "다른 키" : undefined, ok: !chainError, sessionMs }));
    }
    const a = analyzeDetection(session([round("가".repeat(16), events)]), 0);
    expect(a.slowdown.afterError.some((row) => row.slowed)).toBe(true);
    expect(a.slowdown.chainCount).toBe(3);
  });
  it("excludes an inter-key gap that crosses a pause boundary", () => {
    const a = analyzeDetection(session([round("가가가가", [
      event(0, 0, "KeyA", { pauseSeq: 0 }), event(1, 100, "KeyB", { pauseSeq: 0 }),
      event(2, 200, "KeyC", { pauseSeq: 1 }), event(3, 300, "KeyD", { pauseSeq: 1 }),
    ])]), 0);
    expect(a.intervals.n).toBe(2);
    expect(a.intervals.medianMs).toBe(100);
  });
  it("labels legacy records without keyup or alignment fields as unavailable or ambiguous", () => {
    const legacy: KeyEvent = { t: 10, code: "KeyA", kind: "char", pos: 0, shift: false, caps: false, ok: false };
    const a = analyzeDetection(session([round("가", [legacy])]), 0);
    expect(a.alignment).toMatchObject({ status: "정렬 모호", ambiguous: 1, n: 1 });
    expect(a.keyTiming).toMatchObject({ status: "집계 안 됨", simultaneous: undefined, duplicate: undefined });
    expect(a.languageState.status).toBe("집계 안 됨");
  });
});
