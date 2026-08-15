import { app, Menu, shell } from 'electron';
import type { BrowserWindow } from 'electron';

interface ApplicationMenuOptions {
  getMainWindow: () => BrowserWindow | null;
}

function focusMainWindow(getMainWindow: () => BrowserWindow | null): BrowserWindow | null {
  const win = getMainWindow();
  if (!win) return null;

  if (win.isMinimized()) {
    win.restore();
  }
  if (!win.isVisible()) {
    win.show();
  }
  win.focus();
  return win;
}

function openNetworkSettings(getMainWindow: () => BrowserWindow | null): void {
  const win = focusMainWindow(getMainWindow);
  win?.webContents.send('network-settings:open');
}

/**
 * Standard app menu with a discoverable Network Settings entry.
 * Keeps File/Edit/View/Window/Help (and Quit on all platforms) so this is not
 * a regression vs Electron's default menu for users who never open proxy settings.
 */
export function buildApplicationMenu({ getMainWindow }: ApplicationMenuOptions): void {
  const isMac = process.platform === 'darwin';

  const networkSettingsItem: Electron.MenuItemConstructorOptions = {
    label: 'Network Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: () => openNetworkSettings(getMainWindow)
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            networkSettingsItem,
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        ...(isMac ? [] : [networkSettingsItem, { type: 'separator' as const }]),
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
              { type: 'separator' as const },
              {
                label: 'Speech',
                submenu: [
                  { role: 'startSpeaking' as const },
                  { role: 'stopSpeaking' as const }
                ]
              }
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const }
            ])
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const }
            ]
          : [
              { role: 'close' as const }
            ])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'BSV Desktop on GitHub',
          click: async () => {
            await shell.openExternal('https://github.com/bsv-blockchain/bsv-desktop');
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
