import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';
import { startHttpServer } from './httpServer.js';
import { buildApplicationMenu } from './appMenu.js';
import { applyPersistedProxySettings, registerNetworkIpc } from './networkSettings.js';

const require = createRequire(import.meta.url);

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

// Lazy load secret store (v1 migration only)
let secretStoreModule: typeof import('./secretStore.js') | null = null;
async function getSecretStore() {
  if (!secretStoreModule) {
    secretStoreModule = await import('./secretStore.js');
  }
  return secretStoreModule;
}

// Lazy load vault (biometric / passphrase sealed secrets)
let vaultModule: typeof import('./vault.js') | null = null;
async function getVault() {
  if (!vaultModule) {
    vaultModule = await import('./vault.js');
  }
  return vaultModule;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let httpServerCleanup: (() => Promise<void>) | null = null;
let cleanupStarted = false;

async function cleanupBeforeExit(): Promise<void> {
  if (cleanupStarted) return;
  cleanupStarted = true;

  if (storageManager) {
    try {
      await storageManager.cleanup();
    } catch (error) {
      console.error('Failed to clean up storage manager before exit:', error);
    } finally {
      storageManager = null;
    }
  }

  if (httpServerCleanup) {
    const cleanup = httpServerCleanup;
    httpServerCleanup = null;

    try {
      await cleanup();
    } catch (error) {
      console.error('Failed to clean up HTTP server before exit:', error);
    }
  }
}

// Store previous focused app on macOS
let prevBundleId: string | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Linux display server configuration
// Add command-line switches for better Wayland/X11 compatibility
if (process.platform === 'linux') {
  // Try Wayland first, but allow fallback to X11
  // If WAYLAND_DISPLAY is not set or Wayland fails, Electron will automatically fall back to X11
  // This helps with various Linux display server configurations
  
  // Disable GPU sandbox on Linux for better compatibility with different display servers
  // This is commonly needed for AppImages and snap packages
  app.commandLine.appendSwitch('--disable-gpu-sandbox');
  
  // Enable features that improve display server compatibility
  app.commandLine.appendSwitch('--enable-features', 'WaylandWindowDecorations');
  
  // If user explicitly sets X11, respect that
  if (process.env.GDK_BACKEND === 'x11' || process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    app.commandLine.appendSwitch('--ozone-platform', 'x11');
  }
  // Otherwise, let Electron auto-detect and use Wayland if available, with X11 fallback
}

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

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only ever hand http(s) URLs to the OS; deny everything else
    // (javascript:, file:, data:, custom protocol handlers, etc.).
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' }; // Never let the renderer open a new Electron window
  });

  // Handle navigation attempts (like clicking links). Cover both will-navigate
  // and will-redirect — the latter fires on server-side redirects and was
  // previously unguarded.
  const handleNavigation = (event: Electron.Event, url: string) => {
    if (isAppUrl(url)) {
      return; // in-app navigation is fine
    }
    // Anything else leaves the app: block it and only forward safe URLs to the OS.
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    }
  };
  mainWindow.webContents.on('will-navigate', handleNavigation);
  mainWindow.webContents.on('will-redirect', handleNavigation);
}

// True for URLs that belong to the app itself (dev server or packaged file://).
function isAppUrl(url: string): boolean {
  const appUrl = isDev ? 'http://localhost:5173' : 'file://';
  return url.startsWith(appUrl);
}

// Only http(s) URLs may be handed to shell.openExternal. This blocks
// javascript:, file:, data: and arbitrary custom-protocol handlers.
function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// ===== IPC Handlers =====

registerNetworkIpc({
  hasActiveMonitorWorkers: () => {
    // storageManager is only set after first storage use; no workers if never loaded
    return Boolean(storageManager?.hasActiveMonitorWorkers?.());
  }
});

// Check if window is focused
ipcMain.handle('is-focused', () => {
  return mainWindow?.isFocused() ?? false;
});

// The app's own bundle ID — used to avoid capturing ourselves as prevBundleId
const OWN_BUNDLE_ID = 'com.bsvblockchain.bsvdesktop';

// Request focus - platform-specific implementations
ipcMain.handle('request-focus', async () => {
  if (!mainWindow) return;

  if (process.platform === 'darwin') {
    // macOS specific focus handling
    const { execFile } = await import('child_process');
    const util = await import('util');
    const execFilePromise = util.promisify(execFile);

    try {
      // Capture currently focused app before we steal focus
      const { stdout } = await execFilePromise('osascript', [
        '-e',
        'tell application "System Events" to get the bundle identifier of the first process whose frontmost is true'
      ]);
      const captured = stdout.trim();
      // Don't record ourselves — can happen if focus is called while already active
      if (captured && captured !== OWN_BUNDLE_ID) {
        prevBundleId = captured;
      }
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
    if (prevBundleId && prevBundleId !== 'com.apple.finder' && prevBundleId !== OWN_BUNDLE_ID) {
      const util = await import('util');
      const { execFile } = await import('child_process');
      const execFilePromise = util.promisify(execFile);
      const target = prevBundleId;
      prevBundleId = null;
      // Bundle identifiers are reverse-DNS strings; reject anything with
      // characters that could alter the AppleScript expression before use.
      if (!/^[A-Za-z0-9.\-]+$/.test(target)) {
        console.error('Refusing to restore focus: invalid bundle identifier');
        return;
      }
      try {
        // Blur our window first so macOS doesn't fight the activation
        mainWindow.blur();
        // Note: 'tell application id "..." to activate' is ignored by macOS 26
        // when called from a subprocess. 'set frontmost' via System Events works.
        await execFilePromise('osascript', [
          '-e',
          `tell application "System Events" to set frontmost of (first process whose bundle identifier is "${target}") to true`
        ]);
      } catch (error) {
        console.error('Failed to restore previous app:', error);
      }
    }
    // Don't clear prevBundleId on a no-op relinquish — a spurious call (e.g.
    // from an empty queue on mount) must not wipe a valid stored value.
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

// Save mnemonic to ~/.bsv-desktop/
ipcMain.handle('save-mnemonic', async (_event, mnemonic: string) => {
  try {
    const homeDir = app.getPath('home');
    const bsvDir = path.join(homeDir, '.bsv-desktop');

    // Create directory if it doesn't exist
    if (!fs.existsSync(bsvDir)) {
      fs.mkdirSync(bsvDir, { recursive: true });
    }

    const timestamp = Date.now();
    const fileName = `mnemonic${timestamp}.txt`;
    const filePath = path.join(bsvDir, fileName);

    fs.writeFileSync(filePath, mnemonic, 'utf-8');

    // Set file permissions to read-only (0o400 = owner read only)
    fs.chmodSync(filePath, 0o400);

    return { success: true, path: filePath };
  } catch (error) {
    console.error('Save mnemonic failed:', error);
    return { success: false, error: String(error) };
  }
});

// Save private key to ~/.bsv-desktop/
ipcMain.handle('save-private-key', async (_event, privateKey: string) => {
  try {
    const homeDir = app.getPath('home');
    const bsvDir = path.join(homeDir, '.bsv-desktop');

    // Create directory if it doesn't exist
    if (!fs.existsSync(bsvDir)) {
      fs.mkdirSync(bsvDir, { recursive: true });
    }

    const timestamp = Date.now();
    const fileName = `privatekey${timestamp}.txt`;
    const filePath = path.join(bsvDir, fileName);

    fs.writeFileSync(filePath, privateKey, 'utf-8');

    // Set file permissions to read-only (0o400 = owner read only)
    fs.chmodSync(filePath, 0o400);

    return { success: true, path: filePath };
  } catch (error) {
    console.error('Save private key failed:', error);
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

    // Use the Chromium session so manifest fetches honor session proxy settings
    // (node-fetch would bypass session.setProxy).
    const response = await session.defaultSession.fetch(url, {
      headers: {
        'User-Agent': 'bsv-desktop-electron/1.0',
        'Accept': 'application/json, */*;q=0.8'
      },
      redirect: 'follow'
    });

    // Re-validate the *resolved* URL after any redirects. A server could 302 to
    // http://, a non-manifest path, or an internal address; enforce the same
    // constraints we applied to the input.
    const finalUrl = new URL(response.url || url);
    if (finalUrl.protocol !== 'https:') {
      throw new Error('Redirected to a non-HTTPS URL');
    }
    const finalPath = finalUrl.pathname.toLowerCase();
    if (!finalPath.endsWith('/manifest.json') && finalPath !== '/manifest.json') {
      throw new Error('Redirected to a non-manifest URL');
    }

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

// Process exits in this handler; the invoke Promise is not observed by the renderer.
ipcMain.handle('app:restart', async () => {
  try {
    await cleanupBeforeExit();
  } catch (error) {
    console.error('App restart cleanup failed:', error);
  }
  app.relaunch();
  app.exit(0);
});

// Forward HTTP requests to renderer
ipcMain.on('http-response', (_event, response) => {
  if (mainWindow) {
    mainWindow.webContents.send('http-response', response);
  }
});

// ===== Storage IPC Handlers =====

// Check if storage can be made available
ipcMain.handle('storage:is-available', async (_event, identityKey: string, chain: 'main' | 'test' | 'ttn') => {
  try {
    const manager = await getStorageManager();
    return await manager.isAvailable(identityKey, chain);
  } catch (error) {
    console.error('[IPC] storage:is-available error:', error);
    throw error;
  }
});

// Make storage available (initialize database)
ipcMain.handle('storage:make-available', async (_event, identityKey: string, chain: 'main' | 'test' | 'ttn') => {
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
ipcMain.handle('storage:call-method', async (_event, identityKey: string, chain: 'main' | 'test' | 'ttn', method: string, args: any[]) => {
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
ipcMain.handle('storage:initialize-services', async (_event, identityKey: string, chain: 'main' | 'test' | 'ttn') => {
  try {
    const manager = await getStorageManager();
    await manager.initializeServices(identityKey, chain);
    return { success: true };
  } catch (error: any) {
    console.error('[IPC] storage:initialize-services error:', error);
    return { success: false, error: error.message };
  }
});

// ===== Vault + Secret IPC Handlers =====

ipcMain.handle('vault:status', async () => {
  const vault = await getVault();
  return vault.status();
});

ipcMain.handle('vault:unlock-passphrase', async (_event, passphrase: string) => {
  const vault = await getVault();
  return vault.unlockWithPassphrase(passphrase);
});

ipcMain.handle('vault:unlock-biometrics', async () => {
  const vault = await getVault();
  return vault.unlockWithBiometrics();
});

ipcMain.handle(
  'vault:enroll',
  async (
    _event,
    options: { passphrase: string; enableBiometrics: boolean; initialSecrets?: Record<string, string> }
  ) => {
    const vault = await getVault();
    // Migrate v1 secrets.dat if present
    if (vault.needsMigration()) {
      const store = await getSecretStore();
      const map = store.getAll();
      const merged = { ...map, ...(options.initialSecrets || {}) };
      return vault.migrateFromSecretMap(merged, {
        passphrase: options.passphrase,
        enableBiometrics: options.enableBiometrics,
      });
    }
    return vault.enroll(options);
  }
);

ipcMain.handle('vault:lock', async () => {
  const vault = await getVault();
  vault.lock();
});

ipcMain.handle('vault:end-session', async () => {
  const vault = await getVault();
  vault.endSession();
});

ipcMain.handle('vault:destroy', async () => {
  const vault = await getVault();
  vault.destroyVault();
});

ipcMain.handle('boot-config:get', async () => {
  const vault = await getVault();
  return vault.getBootConfigPublic();
});

ipcMain.handle('boot-config:set', async (_event, config: any) => {
  const vault = await getVault();
  vault.setBootConfigPublic(config);
});

ipcMain.handle('secrets:get-all', async () => {
  const vault = await getVault();
  if (!vault.isUnlocked()) {
    // Migration path: allow reading v1 store only when no vault yet
    if (vault.needsMigration()) {
      const store = await getSecretStore();
      return store.getAll();
    }
    return {};
  }
  return vault.getAll();
});

ipcMain.handle('secrets:set', async (_event, name: string, value: string) => {
  const vault = await getVault();
  if (!vault.hasVaultFile()) {
    throw new Error('VAULT_NEEDS_ENROLL');
  }
  if (!vault.isUnlocked()) {
    throw new Error('VAULT_LOCKED');
  }
  vault.setSecret(name, value);
});

ipcMain.handle('secrets:delete', async (_event, name: string) => {
  const vault = await getVault();
  if (!vault.isUnlocked()) {
    throw new Error('VAULT_LOCKED');
  }
  vault.deleteSecret(name);
});

// STAS extension query channel — separate from storage:call-method so STAS
// queries do not share the StorageKnex method namespace.
ipcMain.handle('stas:query', async (_event, identityKey: string, chain: 'main' | 'test', method: string, args: any[]) => {
  try {
    const manager = await getStorageManager();
    const result = await manager.callStasQuery(identityKey, chain, method, args ?? []);
    return { success: true, result };
  } catch (error: any) {
    console.error('[IPC] stas:query error:', error);
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

ipcMain.handle('update:get-state', async () => {
  try {
    const { getUpdateState } = getUpdaterModule();
    const state = getUpdateState();
    return { success: true, state };
  } catch (error: any) {
    console.error('[IPC] update:get-state error:', error);
    return { success: false, error: error.message };
  }
});

// ===== App Lifecycle =====

app.whenReady().then(async () => {
  // Disable SSL certificate validation for development
  if (isDev) {
    app.commandLine.appendSwitch('--ignore-certificate-errors');
    app.commandLine.appendSwitch('--ignore-ssl-errors');
    app.commandLine.appendSwitch('--disable-web-security');
  }

  try {
    await applyPersistedProxySettings();
  } catch (error) {
    console.error('[Startup] Failed to apply persisted proxy settings, continuing startup without them:', error);
  }

  buildApplicationMenu({ getMainWindow: () => mainWindow });
  createWindow();

  // Start HTTPS server on port 2121
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
  await cleanupBeforeExit();

  app.quit();
});

app.on('before-quit', async (event) => {
  // Prevent default quit to perform async cleanup
  if (storageManager || httpServerCleanup) {
    event.preventDefault();

    await cleanupBeforeExit();

    // Now actually quit
    app.exit(0);
  }
});
