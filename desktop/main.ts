import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handleApi } from "../server/ai";

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

function storedApiKey() {
  const file = apiKeyFile();
  if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return "";
  try {
    return safeStorage.decryptString(readFileSync(file));
  } catch {
    return "";
  }
}

loadDevelopmentEnv();

ipcMain.handle("typing-coach:api", async (_event, path: string, body: unknown) => {
  if (path !== "/api/feedback" && path !== "/api/practice") {
    return { status: 404, body: { error: "요청 경로를 찾을 수 없어요." } };
  }
  return handleApi(path, body, {
    GEMINI_API_KEY: storedApiKey() || process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
  });
});

ipcMain.handle("typing-coach:has-api-key", () => Boolean(storedApiKey() || process.env.GEMINI_API_KEY));
ipcMain.handle("typing-coach:save-api-key", (_event, key: unknown) => {
  if (typeof key !== "string" || key.trim().length < 10) throw new Error("Gemini API 키를 확인해 주세요.");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("이 Windows 계정에서는 안전한 키 저장을 사용할 수 없어요.");
  const file = apiKeyFile();
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(file, safeStorage.encryptString(key.trim()));
});
ipcMain.handle("typing-coach:clear-api-key", () => {
  const file = apiKeyFile();
  if (existsSync(file)) rmSync(file);
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
