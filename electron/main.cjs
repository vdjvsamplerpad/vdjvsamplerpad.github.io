const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
const isDev = !app.isPackaged;

function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:') return true;
    if (isDev && parsed.protocol === 'http:') return true;
    return false;
  } catch {
    return false;
  }
}

function setupWindowStateCycle(win) {
  let cycleMode = 'windowed';
  let normalBounds = win.getBounds();
  let suppressMaximizeEvent = false;
  let suppressUnmaximizeEvent = false;
  let suppressLeaveFullscreenEvent = false;

  const emitFullscreenState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('vdjv-window-fullscreen-changed', win.isFullScreen());
  };

  const captureNormalBounds = () => {
    if (!win.isMaximized() && !win.isFullScreen() && cycleMode !== 'pseudo-fullscreen') {
      normalBounds = win.getBounds();
    }
  };

  const enterTrueFullscreen = () => {
    cycleMode = 'fullscreen';
    if (win.isFullScreen()) {
      emitFullscreenState();
      return;
    }
    if (win.isMaximized()) {
      suppressUnmaximizeEvent = true;
      win.unmaximize();
      setImmediate(() => {
        if (win.isDestroyed()) return;
        win.setFullScreen(true);
      });
      return;
    }
    win.setFullScreen(true);
  };

  const exitToWindowed = () => {
    cycleMode = 'windowed';
    const restoreBounds = normalBounds;
    if (win.isFullScreen()) {
      suppressLeaveFullscreenEvent = true;
      win.setFullScreen(false);
      setImmediate(() => {
        if (win.isDestroyed()) return;
        suppressUnmaximizeEvent = true;
        if (win.isMaximized()) win.unmaximize();
        if (restoreBounds) win.setBounds(restoreBounds);
      });
      return;
    }
    suppressUnmaximizeEvent = true;
    if (win.isMaximized()) win.unmaximize();
    if (restoreBounds) win.setBounds(restoreBounds);
    emitFullscreenState();
  };

  win.on('move', captureNormalBounds);
  win.on('resize', captureNormalBounds);

  // Cycle order on maximize button (Windows):
  // windowed -> maximized -> fullscreen -> windowed
  win.on('maximize', () => {
    if (suppressMaximizeEvent) {
      suppressMaximizeEvent = false;
      return;
    }

    if (cycleMode === 'windowed') {
      cycleMode = 'maximized';
    }
  });

  win.on('unmaximize', () => {
    if (suppressUnmaximizeEvent) {
      suppressUnmaximizeEvent = false;
      return;
    }
    if (cycleMode !== 'maximized') return;
    setImmediate(() => {
      if (win.isDestroyed()) return;
      enterTrueFullscreen();
    });
  });

  win.on('leave-full-screen', () => {
    if (suppressLeaveFullscreenEvent) {
      suppressLeaveFullscreenEvent = false;
      emitFullscreenState();
      return;
    }
    if (cycleMode !== 'fullscreen') return;
    exitToWindowed();
  });

  win.on('enter-full-screen', () => {
    cycleMode = 'fullscreen';
    emitFullscreenState();
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toUpperCase();
    if (key !== 'F11') return;
    event.preventDefault();

    if (win.isFullScreen()) {
      exitToWindowed();
      return;
    }

    if (win.isMaximized()) {
      enterTrueFullscreen();
      return;
    }

    suppressMaximizeEvent = true;
    cycleMode = 'maximized';
    win.maximize();
  });

  return {
    toggleFullscreen() {
      if (win.isFullScreen()) {
        exitToWindowed();
        return false;
      }
      enterTrueFullscreen();
      return true;
    },
    getFullscreenState() {
      return win.isFullScreen();
    },
  };
}

function resolveWindowIconPath() {
  if (app.isPackaged) {
    const packagedIco = path.join(process.resourcesPath, 'icon.ico');
    if (fs.existsSync(packagedIco)) return packagedIco;

    const packagedPng = path.join(process.resourcesPath, 'icon.png');
    if (fs.existsSync(packagedPng)) return packagedPng;
  }

  const devIco = path.join(__dirname, '..', 'build', 'icon.ico');
  if (fs.existsSync(devIco)) return devIco;

  const devPng = path.join(__dirname, '..', 'build', 'icon.png');
  if (fs.existsSync(devPng)) return devPng;

  return undefined;
}

function createMainWindow() {
  const iconPath = resolveWindowIconPath();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    fullscreenable: true,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDev,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    show: false,
  });

  // Remove app menu so Alt doesn't reveal File/Edit/View menu in production usage.
  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  const indexPath = path.join(__dirname, '..', 'dist', 'public', 'index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const key = String(input.key || '').toUpperCase();
    const hasCtrlOrCmd = Boolean(input.control || input.meta);

    // Reserve F11 for our custom window-state cycle, not the default Electron fullscreen toggle.
    if (key === 'F11') {
      event.preventDefault();
      return;
    }

    // Keep production users out of DevTools shortcuts.
    if (!isDev) {
      const devtoolsShortcut =
        key === 'F12' ||
        (hasCtrlOrCmd && input.shift && (key === 'I' || key === 'J')) ||
        (hasCtrlOrCmd && key === 'U');
      if (devtoolsShortcut) event.preventDefault();
    }
  });

  const windowStateControls = setupWindowStateCycle(mainWindow);

  ipcMain.removeHandler('vdjv-window-toggle-fullscreen');
  ipcMain.removeHandler('vdjv-window-get-fullscreen-state');
  ipcMain.handle('vdjv-window-toggle-fullscreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return windowStateControls.toggleFullscreen();
  });
  ipcMain.handle('vdjv-window-get-fullscreen-state', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return windowStateControls.getFullscreenState();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    ipcMain.removeHandler('vdjv-window-toggle-fullscreen');
    ipcMain.removeHandler('vdjv-window-get-fullscreen-state');
    mainWindow = null;
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createMainWindow();
});

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.vdjv.samplerpad.desktop');
  }
  createMainWindow();
});



