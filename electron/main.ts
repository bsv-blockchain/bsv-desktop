import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { startHttpServer } from './httpServer.js';

// Lazy load storage to avoid loading knex/better-sqlite3 at startup
let storageManager: any = null;
async function getStorageManager() {
  if (!storageManager) {
    const module = await import('./storage.js');
    storageManager = module.storageManager;
  }
  return storageManager;
}

// Lazy load updater to avoid loading electron-updater at startup
let updaterModule: any = null;
function getUpdaterModule() {
  if (!updaterModule) {
    updaterModule = require('./updater.cjs');
  }
  return updaterModule;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let httpServerCleanup: (() => Promise<void>) | null = null;

// Store previous focused app on macOS
let prevBundleId: string | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Get icon path based on platform and environment
function getIconPath(): string | undefined {
  if (process.platform === 'darwin') {
    // macOS uses .icns in production, .png in dev
    return isDev
      ? path.join(__dirname, '../images/icon.png')
      : path.join(__dirname, '../build/icon.icns');
  } else if (process.platform === 'win32') {
    // Windows uses .ico
    return isDev
      ? path.join(__dirname, '../images/icon.png')
      : path.join(__dirname, '../build/icon.ico');
  } else {
    // Linux uses .png
    return path.join(__dirname, '../build/icon.png');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    title: 'BSV Desktop',
    show: false
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ===== IPC Handlers =====

// Check if window is focused
ipcMain.handle('is-focused', () => {
  return mainWindow?.isFocused() ?? false;
});

// Request focus - platform-specific implementations
ipcMain.handle('request-focus', async () => {
  if (!mainWindow) return;

  if (process.platform === 'darwin') {
    // macOS specific focus handling
    const { exec } = await import('child_process');
    const util = await import('util');
    const execPromise = util.promisify(exec);

    try {
      // Capture currently focused app
      const { stdout } = await execPromise(
        'osascript -e \'tell application "System Events" to get the bundle identifier of the first process whose frontmost is true\''
      );
      prevBundleId = stdout.trim();
    } catch (error) {
      console.error('Failed to capture previous bundle ID:', error);
    }

    // Show and focus the window
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();

    // Request attention (bounces dock icon)
    app.dock?.bounce('informational');

    // Multiple focus attempts
    for (let i = 0; i < 3; i++) {
      mainWindow.focus();
      if (mainWindow.isFocused()) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } else if (process.platform === 'win32') {
    // Windows specific focus handling
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();

    // Temporarily set always-on-top to force focus
    mainWindow.setAlwaysOnTop(true);
    setTimeout(() => {
      mainWindow?.setAlwaysOnTop(false);
    }, 100);
  } else {
    // Linux focus handling
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();

    // Sometimes need multiple attempts on Linux
    await new Promise(resolve => setTimeout(resolve, 30));
    if (!mainWindow.isFocused()) {
      mainWindow.focus();
    }
  }
});

// Relinquish focus
ipcMain.handle('relinquish-focus', async () => {
  if (!mainWindow) return;

  if (process.platform === 'darwin') {
    // macOS: try to restore previous app
    if (prevBundleId && prevBundleId !== 'com.apple.finder') {
      const { exec } = await import('child_process');
      try {
        exec(`osascript -e 'tell application id "${prevBundleId}" to activate'`);
      } catch (error) {
        console.error('Failed to restore previous app:', error);
      }
    }
    prevBundleId = null;
  } else {
    // Windows/Linux: minimize the window
    mainWindow.minimize();
  }
});

// Download file to Downloads folder
ipcMain.handle('download-file', async (_event, fileName: string, content: number[]) => {
  try {
    const downloadsPath = app.getPath('downloads');

    // Handle duplicate file names
    let finalPath = path.join(downloadsPath, fileName);
    const ext = path.extname(fileName);
    const stem = path.basename(fileName, ext);

    let counter = 1;
    while (fs.existsSync(finalPath)) {
      const newName = ext
        ? `${stem} (${counter})${ext}`
        : `${stem} (${counter})`;
      finalPath = path.join(downloadsPath, newName);
      counter++;
    }

    // Write the file
    const buffer = Buffer.from(content);
    fs.writeFileSync(finalPath, buffer);

    return { success: true, path: finalPath };
  } catch (error) {
    console.error('Download failed:', error);
    return { success: false, error: String(error) };
  }
});

// Save file with dialog
ipcMain.handle('save-file', async (_event, defaultPath: string, content: number[]) => {
  try {
    if (!mainWindow) return { success: false, error: 'No window available' };

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    const buffer = Buffer.from(content);
    fs.writeFileSync(result.filePath, buffer);

    return { success: true, path: result.filePath };
  } catch (error) {
    console.error('Save file failed:', error);
    return { success: false, error: String(error) };
  }
});

// Proxy fetch for manifest.json files
ipcMain.handle('proxy-fetch-manifest', async (_event, url: string) => {
  try {
    const parsedUrl = new URL(url);

    // Security checks
    if (parsedUrl.protocol !== 'https:') {
      throw new Error('Only HTTPS URLs are allowed');
    }

    const pathname = parsedUrl.pathname.toLowerCase();
    if (!pathname.endsWith('/manifest.json') && pathname !== '/manifest.json') {
      throw new Error('Only manifest.json files are allowed');
    }

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'bsv-desktop-electron/1.0',
        'Accept': 'application/json, */*;q=0.8'
      },
      redirect: 'follow'
    });

    const headers: [string, string][] = [];
    response.headers.forEach((value, key) => {
      headers.push([key, value]);
    });

    const body = await response.text();

    return {
      status: response.status,
      headers,
      body
    };
  } catch (error) {
    throw new Error(String(error));
  }
});

// Forward HTTP requests to renderer
ipcMain.on('http-response', (_event, response) => {
  if (mainWindow) {
    mainWindow.webContents.send('http-response', response);
  }
});

// ===== Storage IPC Handlers =====

// Check if storage can be made available
ipcMain.handle('storage:is-available', async (_event, identityKey: string, chain: 'main' | 'test') => {
  try {
    const manager = await getStorageManager();
    return await manager.isAvailable(identityKey, chain);
  } catch (error) {
    console.error('[IPC] storage:is-available error:', error);
    throw error;
  }
});

// Make storage available (initialize database)
ipcMain.handle('storage:make-available', async (_event, identityKey: string, chain: 'main' | 'test') => {
  try {
    const manager = await getStorageManager();
    const settings = await manager.makeAvailable(identityKey, chain);
    return { success: true, settings };
  } catch (error: any) {
    console.error('[IPC] storage:make-available error:', error);
    return { success: false, error: error.message };
  }
});

// Call a storage method
ipcMain.handle('storage:call-method', async (_event, identityKey: string, chain: 'main' | 'test', method: string, args: any[]) => {
  try {
    const manager = await getStorageManager();
    const result = await manager.callStorageMethod(identityKey, chain, method, args);
    return { success: true, result };
  } catch (error: any) {
    console.error('[IPC] storage:call-method error:', error);
    return { success: false, error: error.message };
  }
});

// Initialize services on storage
ipcMain.handle('storage:initialize-services', async (_event, identityKey: string, chain: 'main' | 'test') => {
  try {
    const manager = await getStorageManager();
    await manager.initializeServices(identityKey, chain);
    return { success: true };
  } catch (error: any) {
    console.error('[IPC] storage:initialize-services error:', error);
    return { success: false, error: error.message };
  }
});

// ===== Auto-Update IPC Handlers =====

ipcMain.handle('update:check', async () => {
  try {
    const { checkForUpdates } = getUpdaterModule();
    const result = await checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo };
  } catch (error: any) {
    console.error('[IPC] update:check error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update:download', async () => {
  try {
    const { downloadUpdate } = getUpdaterModule();
    await downloadUpdate();
    return { success: true };
  } catch (error: any) {
    console.error('[IPC] update:download error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update:install', async () => {
  try {
    const { quitAndInstall } = getUpdaterModule();
    quitAndInstall();
    return { success: true };
  } catch (error: any) {
    console.error('[IPC] update:install error:', error);
    return { success: false, error: error.message };
  }
});

// ===== App Lifecycle =====

app.whenReady().then(async () => {
  createWindow();

  // Start HTTP server on port 3321
  if (mainWindow) {
    httpServerCleanup = await startHttpServer(mainWindow);

    // Initialize auto-updater
    const { initAutoUpdater } = getUpdaterModule();
    initAutoUpdater(mainWindow);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  // Cleanup storage connections
  if (storageManager) {
    await storageManager.cleanup();
  }

  if (httpServerCleanup) {
    await httpServerCleanup();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  // Cleanup storage connections
  if (storageManager) {
    await storageManager.cleanup();
  }

  if (httpServerCleanup) {
    await httpServerCleanup();
  }
});
