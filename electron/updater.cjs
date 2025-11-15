/**
 * CommonJS wrapper for auto-updater functionality
 * Transpiled from updater.ts to avoid ESM/CJS compatibility issues with electron-updater
 */

const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Configure logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false; // Set to false to avoid conflict with manual quitAndInstall()

// Platform-specific update configuration
if (process.platform === 'win32') {
  // Windows: Force full downloads to avoid checksum mismatch errors
  // Differential downloads on Windows are known to be unreliable
  log.info('[Windows] Disabling differential downloads and web installers - forcing full downloads');
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.disableWebInstaller = true;
} else {
  // macOS and Linux can use differential downloads safely
  log.info(`[${process.platform}] Using default update configuration`);
}

// Track update state
let updateState = {
  available: false,
  downloading: false,
  ready: false,
  updateInfo: null,
  downloadProgress: null,
  error: null
};

function initAutoUpdater(mainWindow) {
  // Don't check for updates in development
  if (process.env.NODE_ENV === 'development') {
    log.info('Auto-updater disabled in development mode');
    return;
  }

  // Update available
  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info);
    log.info(`Platform: ${process.platform}, Differential downloads: ${!autoUpdater.disableDifferentialDownload}, Web installers: ${!autoUpdater.disableWebInstaller}`);

    // Get current version from package.json
    const { version: currentVersion } = require('../package.json');
    const latestVersion = info.version;

    // Don't notify if versions are the same
    if (currentVersion === latestVersion) {
      log.info(`Current version ${currentVersion} matches latest version ${latestVersion}, skipping update notification`);
      updateState.available = false;
      updateState.updateInfo = null;
      return;
    }

    updateState.available = true;
    updateState.updateInfo = info;
    updateState.error = null;
    mainWindow.webContents.send('update-available', info);
  });

  // Update not available
  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info);
    updateState.available = false;
    updateState.updateInfo = null;
  });

  // Download progress
  autoUpdater.on('download-progress', (progressObj) => {
    log.info('Download progress:', progressObj);
    updateState.downloading = true;
    updateState.downloadProgress = progressObj;
    mainWindow.webContents.send('update-download-progress', progressObj);
  });

  // Update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info);
    updateState.downloading = false;
    updateState.ready = true;
    updateState.updateInfo = info;
    mainWindow.webContents.send('update-downloaded', info);
  });

  // Error handling
  autoUpdater.on('error', (error) => {
    log.error('Update error:', error);
    updateState.error = error.message;
    updateState.downloading = false;
    mainWindow.webContents.send('update-error', error.message);
  });

  // Check for updates on app start (after a longer delay to ensure renderer is ready)
  setTimeout(() => {
    log.info('Checking for updates...');
    autoUpdater.checkForUpdates().catch(err => {
      log.error('Failed to check for updates:', err);
      updateState.error = err.message;
    });
  }, 10000);

  // Check for updates every 4 hours
  setInterval(() => {
    log.info('Periodic update check...');
    autoUpdater.checkForUpdates().catch(err => {
      log.error('Failed to check for updates:', err);
    });
  }, 4 * 60 * 60 * 1000);
}

// Download update
function downloadUpdate() {
  log.info(`[${process.platform}] Starting update download - Differential: ${!autoUpdater.disableDifferentialDownload}, WebInstaller: ${!autoUpdater.disableWebInstaller}`);
  return autoUpdater.downloadUpdate();
}

// Install update and restart
function quitAndInstall() {
  const { app } = require('electron');
  // Remove listeners that may prevent proper app relaunch on macOS
  setImmediate(() => {
    app.removeAllListeners('window-all-closed');
    app.removeAllListeners('before-quit');
    // isSilent = false, forceRunAfter = true (force app to relaunch)
    autoUpdater.quitAndInstall(false, true);
  });
}

// Manually check for updates
async function checkForUpdates() {
  const result = await autoUpdater.checkForUpdates();

  // Apply version comparison for manual checks
  if (result && result.updateInfo) {
    const { version: currentVersion } = require('../package.json');
    const latestVersion = result.updateInfo.version;

    // If versions match, return null to indicate no update available
    if (currentVersion === latestVersion) {
      log.info(`Manual check: Current version ${currentVersion} matches latest version ${latestVersion}`);
      return { updateInfo: null };
    }
  }

  return result;
}

// Get current update state
function getUpdateState() {
  return updateState;
}

module.exports = {
  initAutoUpdater,
  downloadUpdate,
  quitAndInstall,
  checkForUpdates,
  getUpdateState
};
