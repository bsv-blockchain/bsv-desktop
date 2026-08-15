import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Desktop integration for the Linux AppImage build.
 *
 * An AppImage is a single self-contained file. Nothing installs its .desktop
 * entry or its icon, so the desktop environment has no record of the app at
 * all. Under Wayland there is no protocol for a client to set its own window
 * icon — the compositor matches the toplevel's app_id against installed
 * .desktop files and uses the Icon= from there. With no installed entry, GNOME
 * falls back to a generic icon.
 *
 * The app_id is derived from the executable name, which comes from the
 * package.json `name` field: "bsv-desktop-electron". The .desktop file must be
 * named to match for the compositor to associate the two.
 */

const APP_ID = 'bsv-desktop-electron';
const ICON_SIZE = '512x512';

const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
const desktopFilePath = path.join(dataHome, 'applications', `${APP_ID}.desktop`);
const iconDir = path.join(dataHome, 'icons', 'hicolor', ICON_SIZE, 'apps');
const iconPath = path.join(iconDir, `${APP_ID}.png`);

function buildDesktopEntry(appImagePath: string): string {
  // Exec must be quoted: AppImages commonly live in paths containing spaces.
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=BSV Desktop',
    'Comment=BSV Desktop Wallet - Electron Edition',
    `Exec="${appImagePath}" --no-sandbox %U`,
    `Icon=${APP_ID}`,
    `StartupWMClass=${APP_ID}`,
    'Terminal=false',
    'Categories=Finance;',
    `X-AppImage-Version=${app.getVersion()}`,
    ''
  ].join('\n');
}

/**
 * Installs a .desktop entry and icon into the user's XDG data dir so the
 * window manager can resolve the app's icon. Idempotent: rewrites only when
 * the content would change, so a moved or upgraded AppImage self-corrects.
 *
 * No-ops unless running from an AppImage. Failures are logged and swallowed —
 * a missing icon must never block startup.
 */
export function integrateAppImageDesktopEntry(): void {
  if (process.platform !== 'linux') {
    return;
  }

  // Set by the AppImage runtime; absent for deb/rpm installs, which register
  // their own desktop entry through the package manager.
  const appImagePath = process.env.APPIMAGE;
  if (!appImagePath || !fs.existsSync(appImagePath)) {
    return;
  }

  try {
    const desired = buildDesktopEntry(appImagePath);
    const existing = fs.existsSync(desktopFilePath)
      ? fs.readFileSync(desktopFilePath, 'utf8')
      : null;

    if (existing !== desired) {
      fs.mkdirSync(path.dirname(desktopFilePath), { recursive: true });
      fs.writeFileSync(desktopFilePath, desired, { mode: 0o644 });
      console.log(`[linux] Installed desktop entry at ${desktopFilePath}`);
    }

    // The icon ships inside the asar; copy it out so the icon theme can find
    // it by name. readFileSync reads through the asar transparently.
    const sourceIcon = path.join(__dirname, '../build/icon.png');
    if (fs.existsSync(sourceIcon)) {
      const source = fs.readFileSync(sourceIcon);
      const current = fs.existsSync(iconPath) ? fs.readFileSync(iconPath) : null;

      if (!current || !current.equals(source)) {
        fs.mkdirSync(iconDir, { recursive: true });
        fs.writeFileSync(iconPath, source, { mode: 0o644 });
        console.log(`[linux] Installed icon at ${iconPath}`);
      }
    } else {
      console.warn(`[linux] Icon not found at ${sourceIcon}; window icon may fall back`);
    }
  } catch (error) {
    console.error('[linux] Desktop integration failed:', error);
  }
}
