const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("typingCoach", {
  request: (path, body) => ipcRenderer.invoke("typing-coach:api", path, body),
  getAISettings: () => ipcRenderer.invoke("typing-coach:ai-settings"),
  saveAISettings: (provider, model, apiKey) => ipcRenderer.invoke("typing-coach:save-ai-settings", { provider, model, apiKey }),
  clearAIKey: (provider) => ipcRenderer.invoke("typing-coach:clear-ai-key", provider),
  hasApiKey: () => ipcRenderer.invoke("typing-coach:has-api-key"),
  getFeatureSettings: () => ipcRenderer.invoke("typing-coach:feature-settings"),
  saveFeatureSettings: (settings) => ipcRenderer.invoke("typing-coach:save-feature-settings", settings),
  appendSession: (sessionId, initial, records) => ipcRenderer.invoke("typing-coach:append-session", sessionId, initial, records),
  loadSessions: () => ipcRenderer.invoke("typing-coach:load-sessions"),
});
