import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFeatureSettings, saveFeatureSettings } from "./featureSettings";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("feature settings persistence", () => {
  it("saves and reloads settings and the consent timestamp", () => {
    const dir = mkdtempSync(join(tmpdir(), "typing-coach-settings-")); dirs.push(dir);
    const file = join(dir, "ai-features.json");
    const saved = saveFeatureSettings(file, { sentenceAnalysisEnabled: true, sentenceAnalysisConsent: true }, "2026-11-24T00:00:00.000Z");
    expect(readFeatureSettings(file)).toEqual({ ...saved, sentenceAnalysisConsentAt: "2026-11-24T00:00:00.000Z" });
  });
});
