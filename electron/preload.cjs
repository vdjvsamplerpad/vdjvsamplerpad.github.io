const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');

// Expose minimal API if needed
contextBridge.exposeInMainWorld('electronAPI', {
  toggleFullscreen: () => ipcRenderer.invoke('vdjv-window-toggle-fullscreen'),
  getFullscreenState: () => ipcRenderer.invoke('vdjv-window-get-fullscreen-state'),
  transcodeAudioToMp3: (payload) => ipcRenderer.invoke('vdjv-audio-transcode-mp3', payload),
  getSystemMemoryInfo: () => ({
    totalMemBytes: os.totalmem(),
    freeMemBytes: os.freemem(),
    cpuCount: Array.isArray(os.cpus()) ? os.cpus().length : 0,
  }),
  onFullscreenChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, isFullscreen) => callback(Boolean(isFullscreen));
    ipcRenderer.on('vdjv-window-fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('vdjv-window-fullscreen-changed', handler);
  },
});




