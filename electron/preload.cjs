const { contextBridge, ipcRenderer } = require('electron');

// Expose minimal API if needed
contextBridge.exposeInMainWorld('electronAPI', {
  toggleFullscreen: () => ipcRenderer.invoke('vdjv-window-toggle-fullscreen'),
  getFullscreenState: () => ipcRenderer.invoke('vdjv-window-get-fullscreen-state'),
  onFullscreenChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, isFullscreen) => callback(Boolean(isFullscreen));
    ipcRenderer.on('vdjv-window-fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('vdjv-window-fullscreen-changed', handler);
  },
});




