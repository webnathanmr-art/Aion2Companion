const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchPatchNotes: () => ipcRenderer.invoke('fetch-patch-notes'),
});
