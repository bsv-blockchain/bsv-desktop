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
autoUpdater.autoInstallOnAppQuit = true;

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
  return autoUpdater.downloadUpdate();
}

// Install update and restart
function quitAndInstall() {
  autoUpdater.quitAndInstall(false, true);
}

// Manually check for updates
function checkForUpdates() {
  return autoUpdater.checkForUpdates();
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
