import { autoUpdater } from 'electron-updater';
import { BrowserWindow, dialog } from 'electron';
import log from 'electron-log';

// Configure logging
autoUpdater.logger = log;
(autoUpdater.logger as typeof log).transports.file.level = 'info';

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

export function initAutoUpdater(mainWindow: BrowserWindow) {
  // Don't check for updates in development
  if (process.env.NODE_ENV === 'development') {
    log.info('Auto-updater disabled in development mode');
    return;
  }

  // Update available
  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info);
    mainWindow.webContents.send('update-available', info);
  });

  // Update not available
  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info);
  });

  // Download progress
  autoUpdater.on('download-progress', (progressObj) => {
    log.info('Download progress:', progressObj);
    mainWindow.webContents.send('update-download-progress', progressObj);
  });

  // Update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info);
    mainWindow.webContents.send('update-downloaded', info);
  });

  // Error handling
  autoUpdater.on('error', (error) => {
    log.error('Update error:', error);
    mainWindow.webContents.send('update-error', error.message);
  });

  // Check for updates on app start (after a delay)
  setTimeout(() => {
    log.info('Checking for updates...');
    autoUpdater.checkForUpdates().catch(err => {
      log.error('Failed to check for updates:', err);
    });
  }, 3000);

  // Check for updates every 4 hours
  setInterval(() => {
    log.info('Periodic update check...');
    autoUpdater.checkForUpdates().catch(err => {
      log.error('Failed to check for updates:', err);
    });
  }, 4 * 60 * 60 * 1000);
}

// Download update
export function downloadUpdate() {
  return autoUpdater.downloadUpdate();
}

// Install update and restart
export function quitAndInstall() {
  autoUpdater.quitAndInstall(false, true);
}

// Manually check for updates
export function checkForUpdates() {
  return autoUpdater.checkForUpdates();
}
