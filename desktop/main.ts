import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handleApi } from "../server/ai";
import { AI_MODELS, isAIModel, isAIProvider, type AIProvider } from "../shared/aiModels";
import { appendSessionJsonl, readSessionLines, sessionsFromJsonl, type SessionLine } from "./sessionStore";
import { readFeatureSettings as readFeatureSettingsFile, saveFeatureSettings as saveFeatureSettingsFile } from "./featureSettings";

function loadDevelopmentEnv() {
  const candidates = [join(process.cwd(), ".env"), join(app.getAppPath(), ".env")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]]) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      process.env[match[1]] = value;
    }
    break;
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 920,
    minHeight: 680,
    title: "AI 타자 코치",
    backgroundColor: "#edf0f3",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../desktop/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  void window.loadFile(join(app.getAppPath(), "dist", "index.html"));
}

const apiKeyFile = () => join(app.getPath("userData"), "gemini-api-key.bin");
const aiConfigFile = () => join(app.getPath("userData"), "ai-provider-config.bin");
const sessionFile = () => join(app.getPath("userData"), "sessions.jsonl");
const featureFile = () => join(app.getPath("userData"), "ai-features.json");

type SavedAIConfig = { provider?: AIProvider; model?: string; geminiApiKey?: string; multiAiApiKey?: string };

function readSavedAIConfig(): SavedAIConfig {
  const file = aiConfigFile();
  if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return {};
  try {
    const parsed = JSON.parse(safeStorage.decryptString(readFileSync(file))) as SavedAIConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSavedAIConfig(config: SavedAIConfig) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("이 Windows 계정에서는 안전한 키 저장을 사용할 수 없어요.");
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(aiConfigFile(), safeStorage.encryptString(JSON.stringify(config)));
}

function storedApiKey() {
  const file = apiKeyFile();
  if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return "";
  try {
    return safeStorage.decryptString(readFileSync(file));
  } catch {
    return "";
  }
}

function getAISettings() {
  const saved = readSavedAIConfig();
  const provider = isAIProvider(saved.provider) ? saved.provider : "gemini";
  const model = isAIModel(provider, saved.model)
    ? saved.model
    : provider === "gemini" && process.env.GEMINI_MODEL && isAIModel("gemini", process.env.GEMINI_MODEL)
      ? process.env.GEMINI_MODEL
      : AI_MODELS[provider][0];
  return {
    provider,
    model,
    hasGeminiKey: Boolean(saved.geminiApiKey || storedApiKey() || process.env.GEMINI_API_KEY),
    hasMultiAIKey: Boolean(saved.multiAiApiKey || process.env.MULTI_AI_API_KEY),
    ...getFeatureSettings(),
  };
}

function getFeatureSettings() {
  try { return readFeatureSettingsFile(featureFile()); }
  catch (error) { console.error("[typing-coach:feature-settings] 읽기 실패", error); return { sentenceAnalysisEnabled: true, questionCardsEnabled: true, sentenceAnalysisConsent: false, sentenceAnalysisConsentAt: null }; }
}
function saveFeatureSettings(input: any) {
  try { return saveFeatureSettingsFile(featureFile(), input); }
  catch (error) {
    console.error("[typing-coach:save-feature-settings] 저장 실패", error);
    throw new Error(`설정을 저장하지 못했어요 (원인: 파일 쓰기 실패). 다시 시도해 주세요. ${error instanceof Error ? error.message : String(error)}`);
  }
}

function appendSessionRecords(sessionId: number, initial: boolean, records: unknown[]) {
  mkdirSync(app.getPath("userData"), { recursive: true });
  appendSessionJsonl(sessionFile(), sessionId, initial, records as SessionLine[]);
}
function loadSavedSessions() {
  try { return sessionsFromJsonl(readSessionLines(sessionFile())); } catch { return []; }
}

function saveAISettings(input: unknown) {
  const value = input as { provider?: unknown; model?: unknown; apiKey?: unknown };
  if (!isAIProvider(value?.provider) || !isAIModel(value.provider, value.model)) throw new Error("AI 제공자와 모델을 확인해 주세요.");
  if (typeof value.apiKey !== "string") throw new Error("API 키 입력값을 확인해 주세요.");
  const apiKey = value.apiKey.trim();
  if (apiKey && apiKey.length < 10) throw new Error("API 키를 확인해 주세요.");
  const current = readSavedAIConfig();
  const config: SavedAIConfig = {
    provider: value.provider,
    model: value.model,
    geminiApiKey: current.geminiApiKey || storedApiKey() || undefined,
    multiAiApiKey: current.multiAiApiKey,
  };
  if (apiKey) {
    if (value.provider === "gemini") config.geminiApiKey = apiKey;
    else config.multiAiApiKey = apiKey;
  }
  writeSavedAIConfig(config);
}

function clearAIKey(providerInput: unknown) {
  if (!isAIProvider(providerInput)) throw new Error("AI 제공자를 확인해 주세요.");
  const config = readSavedAIConfig();
  if (providerInput === "gemini") {
    delete config.geminiApiKey;
    const legacyFile = apiKeyFile();
    if (existsSync(legacyFile)) rmSync(legacyFile);
  } else delete config.multiAiApiKey;
  writeSavedAIConfig(config);
}

loadDevelopmentEnv();

ipcMain.handle("typing-coach:api", async (_event, path: string, body: unknown) => {
  if (path !== "/api/feedback" && path !== "/api/practice" && path !== "/api/sentence-analysis") {
    return { status: 404, body: { error: "요청 경로를 찾을 수 없어요." } };
  }
  const saved = readSavedAIConfig();
  const settings = getAISettings();
  return handleApi(path, body, {
    AI_PROVIDER: settings.provider,
    AI_MODEL: settings.model,
    GEMINI_API_KEY: saved.geminiApiKey || storedApiKey() || process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    MULTI_AI_API_KEY: saved.multiAiApiKey || process.env.MULTI_AI_API_KEY,
  });
});

ipcMain.handle("typing-coach:ai-settings", () => getAISettings());
ipcMain.handle("typing-coach:save-ai-settings", (_event, value: unknown) => saveAISettings(value));
ipcMain.handle("typing-coach:clear-ai-key", (_event, provider: unknown) => clearAIKey(provider));
ipcMain.handle("typing-coach:feature-settings", () => getFeatureSettings());
ipcMain.handle("typing-coach:save-feature-settings", (_event, value: unknown) => saveFeatureSettings(value));
ipcMain.handle("typing-coach:append-session", (_event, sessionId: number, initial: boolean, records: unknown[]) => appendSessionRecords(sessionId, initial, records));
ipcMain.handle("typing-coach:load-sessions", () => loadSavedSessions());
ipcMain.handle("typing-coach:has-api-key", () => {
  const settings = getAISettings();
  return settings.provider === "gemini" ? settings.hasGeminiKey : settings.hasMultiAIKey;
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
