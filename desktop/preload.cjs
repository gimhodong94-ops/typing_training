const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("typingCoach", {
  request: (path, body) => ipcRenderer.invoke("typing-coach:api", path, body),
  hasApiKey: () => ipcRenderer.invoke("typing-coach:has-api-key"),
  saveApiKey: (key) => ipcRenderer.invoke("typing-coach:save-api-key", key),
  clearApiKey: () => ipcRenderer.invoke("typing-coach:clear-api-key"),
});
