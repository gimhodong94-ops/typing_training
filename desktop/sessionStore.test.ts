import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSessionJsonl, readSessionLines, sessionsFromJsonl } from "./sessionStore";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("session JSONL persistence", () => {
  it("writes analysis then raw, appends later lines and preserves the original prefix", () => {
    const dir = mkdtempSync(join(tmpdir(), "gwaze-session-")); dirs.push(dir);
    const file = join(dir, "sessions.jsonl");
    appendSessionJsonl(file, 1, true, [
      { sessionId: 1, type: "analysis", data: { facts: ["F01"] } },
      { sessionId: 1, type: "raw", data: { id: 1, rounds: [] } },
    ]);
    const before = readFileSync(file, "utf8");
    appendSessionJsonl(file, 1, false, [{ sessionId: 1, type: "ai_analysis", data: [{ roundId: "r1" }] }]);
    const lines = readSessionLines(file);
    expect(lines.map((line) => line.type)).toEqual(["analysis", "raw", "ai_analysis"]);
    expect(readFileSync(file, "utf8").startsWith(before)).toBe(true);
    expect(sessionsFromJsonl(lines)[0].aiAnalysis).toEqual([{ roundId: "r1" }]);
  });
});
