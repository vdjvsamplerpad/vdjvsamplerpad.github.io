const { app, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('electron-log/main');
const { autoUpdater, NsisUpdater } = require('electron-updater');

const DEFAULT_UPDATE_CHANNEL = 'latest';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let activeUpdater = null;
let checkTimer = null;
let windowResolver = () => null;
let updateState = {
  enabled: false,
  status: 'disabled',
  message: 'Auto-update is unavailable.',
  currentVersion: app.getVersion(),
  nextVersion: null,
  downloadPercent: null,
  lastCheckedAt: null,
  lastError: null,
};

function pushUpdateState(patch = {}) {
  updateState = {
    ...updateState,
    ...patch,
    currentVersion: app.getVersion(),
  };
  const win = windowResolver();
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('vdjv-app-update-state', updateState);
  } catch {
  }
}

function readJsonIfPresent(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function resolveRuntimeGenericFeed() {
  const envUrl = String(process.env.ELECTRON_AUTO_UPDATE_URL || '').trim();
  const envChannel = String(process.env.ELECTRON_AUTO_UPDATE_CHANNEL || DEFAULT_UPDATE_CHANNEL).trim() || DEFAULT_UPDATE_CHANNEL;
  if (envUrl) {
    return {
      provider: 'generic',
      url: envUrl,
      channel: envChannel,
      useMultipleRangeRequest: false,
    };
  }

  const packagedConfigPath = path.join(process.resourcesPath, 'auto-update.json');
  const packagedConfig = readJsonIfPresent(packagedConfigPath);
  const configUrl = String(packagedConfig?.url || '').trim();
  if (configUrl) {
    return {
      provider: 'generic',
      url: configUrl,
      channel: String(packagedConfig?.channel || DEFAULT_UPDATE_CHANNEL).trim() || DEFAULT_UPDATE_CHANNEL,
      useMultipleRangeRequest: false,
    };
  }

  return null;
}

function hasPackagedBuilderFeed() {
  if (!app.isPackaged) return false;
  try {
    return fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  } catch {
    return false;
  }
}

function createUpdater() {
  const runtimeFeed = resolveRuntimeGenericFeed();
  if (runtimeFeed) {
    return new NsisUpdater(runtimeFeed);
  }
  if (hasPackagedBuilderFeed()) {
    return autoUpdater;
  }
  return null;
}

function scheduleChecks() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  if (!activeUpdater) return;
  checkTimer = setInterval(() => {
    void checkForUpdates('scheduled');
  }, CHECK_INTERVAL_MS);
}

async function promptForInstall() {
  const win = windowResolver();
  const result = await dialog.showMessageBox(win || undefined, {
    type: 'info',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: 'Update Ready',
    message: 'A new version of VDJV Sampler Pad has been downloaded.',
    detail: 'Restart now to install the update, or close the app later to install on exit.',
  });
  if (result.response === 0 && activeUpdater) {
    activeUpdater.quitAndInstall();
  }
}

async function checkForUpdates(trigger = 'manual') {
  if (!activeUpdater) {
    pushUpdateState({
      enabled: false,
      status: 'disabled',
      message: 'Auto-update is unavailable because no update feed is configured.',
    });
    return updateState;
  }
  pushUpdateState({
    enabled: true,
    status: 'checking',
    message: trigger === 'startup' ? 'Checking for updates...' : 'Checking for updates now...',
    lastCheckedAt: new Date().toISOString(),
    lastError: null,
  });
  try {
    await activeUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('[auto-update] check failed:', message);
    pushUpdateState({
      enabled: true,
      status: 'error',
      message: 'Update check failed.',
      lastError: message,
    });
  }
  return updateState;
}

function setupAutoUpdater({ getMainWindow }) {
  windowResolver = typeof getMainWindow === 'function' ? getMainWindow : () => null;

  ipcMain.removeHandler('vdjv-app-update-get-state');
  ipcMain.removeHandler('vdjv-app-update-check');
  ipcMain.removeHandler('vdjv-app-update-install');

  ipcMain.handle('vdjv-app-update-get-state', () => updateState);
  ipcMain.handle('vdjv-app-update-check', async () => checkForUpdates('manual'));
  ipcMain.handle('vdjv-app-update-install', async () => {
    if (!activeUpdater) return { ok: false, reason: 'disabled' };
    activeUpdater.quitAndInstall();
    return { ok: true };
  });

  if (process.platform !== 'win32') {
    pushUpdateState({
      enabled: false,
      status: 'disabled',
      message: 'Auto-update is only configured for Windows packages.',
    });
    return;
  }
  if (!app.isPackaged) {
    pushUpdateState({
      enabled: false,
      status: 'disabled',
      message: 'Auto-update is disabled in development builds.',
    });
    return;
  }

  activeUpdater = createUpdater();
  if (!activeUpdater) {
    pushUpdateState({
      enabled: false,
      status: 'disabled',
      message: 'Auto-update is ready in code, but no update feed is configured for this package yet.',
    });
    return;
  }

  log.initialize();
  log.transports.file.level = 'info';
  activeUpdater.logger = log;
  activeUpdater.autoDownload = true;
  activeUpdater.autoInstallOnAppQuit = true;

  activeUpdater.on('checking-for-update', () => {
    pushUpdateState({
      enabled: true,
      status: 'checking',
      message: 'Checking for updates...',
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
    });
  });

  activeUpdater.on('update-available', (info) => {
    const nextVersion = String(info?.version || '').trim() || null;
    pushUpdateState({
      enabled: true,
      status: 'available',
      message: nextVersion ? `Downloading version ${nextVersion}...` : 'Downloading update...',
      nextVersion,
      downloadPercent: 0,
      lastError: null,
    });
  });

  activeUpdater.on('update-not-available', () => {
    pushUpdateState({
      enabled: true,
      status: 'idle',
      message: 'You already have the latest version.',
      nextVersion: null,
      downloadPercent: null,
      lastError: null,
    });
  });

  activeUpdater.on('download-progress', (progress) => {
    const percent = Number(progress?.percent || 0);
    pushUpdateState({
      enabled: true,
      status: 'downloading',
      message: `Downloading update... ${Math.round(percent)}%`,
      downloadPercent: percent,
      lastError: null,
    });
  });

  activeUpdater.on('update-downloaded', (info) => {
    const nextVersion = String(info?.version || '').trim() || updateState.nextVersion;
    pushUpdateState({
      enabled: true,
      status: 'downloaded',
      message: nextVersion ? `Version ${nextVersion} is ready to install.` : 'Update downloaded and ready to install.',
      nextVersion,
      downloadPercent: 100,
      lastError: null,
    });
    void promptForInstall();
  });

  activeUpdater.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    log.error('[auto-update] runtime error:', message);
    pushUpdateState({
      enabled: true,
      status: 'error',
      message: 'Auto-update encountered an error.',
      lastError: message,
    });
  });

  scheduleChecks();
  setTimeout(() => {
    void checkForUpdates('startup');
  }, 15000);
}

function disposeAutoUpdater() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  ipcMain.removeHandler('vdjv-app-update-get-state');
  ipcMain.removeHandler('vdjv-app-update-check');
  ipcMain.removeHandler('vdjv-app-update-install');
  activeUpdater = null;
}

module.exports = {
  setupAutoUpdater,
  disposeAutoUpdater,
};
