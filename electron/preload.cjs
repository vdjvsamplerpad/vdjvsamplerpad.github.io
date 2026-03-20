const { contextBridge, ipcRenderer } = require('electron');

// Expose minimal API if needed
contextBridge.exposeInMainWorld('electronAPI', {
  toggleFullscreen: () => ipcRenderer.invoke('vdjv-window-toggle-fullscreen'),
  getFullscreenState: () => ipcRenderer.invoke('vdjv-window-get-fullscreen-state'),
  transcodeAudioToMp3: (payload) => ipcRenderer.invoke('vdjv-audio-transcode-mp3', payload),
  createZipArchive: (payload) => ipcRenderer.invoke('vdjv-zip-create', payload),
  createAndSaveZipArchive: (payload) => ipcRenderer.invoke('vdjv-zip-create-save', payload),
  stageExportEntry: (payload) => ipcRenderer.invoke('vdjv-export-stage-entry', payload),
  cleanupStagedExportEntries: (payload) => ipcRenderer.invoke('vdjv-export-cleanup-staged', payload),
  exportArchiveJob: (payload) => ipcRenderer.invoke('vdjv-export-archive-job', payload),
  importArchiveJob: (payload) => ipcRenderer.invoke('vdjv-import-archive-job', payload),
  resolveNativeMedia: (payload) => ipcRenderer.invoke('vdjv-native-media-resolve', payload),
  writeNativeMedia: (payload) => ipcRenderer.invoke('vdjv-native-media-write', payload),
  readNativeMedia: (payload) => ipcRenderer.invoke('vdjv-native-media-read', payload),
  deleteNativeMedia: (payload) => ipcRenderer.invoke('vdjv-native-media-delete', payload),
  getAppUpdateState: () => ipcRenderer.invoke('vdjv-app-update-get-state'),
  checkForAppUpdates: () => ipcRenderer.invoke('vdjv-app-update-check'),
  installDownloadedAppUpdate: () => ipcRenderer.invoke('vdjv-app-update-install'),
  getSystemMemoryInfo: () => ipcRenderer.sendSync('vdjv-system-memory-info'),
  onFullscreenChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, isFullscreen) => callback(Boolean(isFullscreen));
    ipcRenderer.on('vdjv-window-fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('vdjv-window-fullscreen-changed', handler);
  },
  onImportArchiveProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('vdjv-import-progress', handler);
    return () => ipcRenderer.removeListener('vdjv-import-progress', handler);
  },
  onAppUpdateState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('vdjv-app-update-state', handler);
    return () => ipcRenderer.removeListener('vdjv-app-update-state', handler);
  },
});




