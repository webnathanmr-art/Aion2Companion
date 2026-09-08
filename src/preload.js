const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchPatchNotes: () => ipcRenderer.invoke('fetch-patch-notes'),

  // Settings live in the main process. getSettings never returns the API key
  // itself -- only whether one is set and a masked hint of it.
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openSettingsFolder: () => ipcRenderer.invoke('settings:openFolder'),

  aiAsk: (prompt) => ipcRenderer.invoke('ai:ask', prompt),
  aiTest: () => ipcRenderer.invoke('ai:test'),
});
