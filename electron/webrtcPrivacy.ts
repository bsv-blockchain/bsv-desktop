/**
 * Keeps this device's local network addresses out of WebRTC offers and answers
 * (direct payments; audit finding F4).
 *
 * Chromium replaces host ICE candidates with random mDNS names (`<uuid>.local`)
 * unless the page has camera or microphone permission. Electron grants every
 * permission check when no check handler is installed, so without this every
 * offer, answer and QR code would carry the LAN IPv4 address and the address of
 * every other interface (VPN, virtual adapters). Two wallets on the same LAN
 * still connect through the mDNS names.
 *
 * Only the 'media' check is denied; every other check stays granted, as before.
 * Camera access for the QR scanner is unaffected: getUserMedia goes through the
 * permission request handler, which still grants it.
 */

/** The part of Electron's `Session` this needs, so it can be tested without Electron. */
export interface PermissionCheckTarget {
  setPermissionCheckHandler(handler: (webContents: unknown, permission: string) => boolean): void;
}

/** Call once the app is ready and before any window loads a page. */
export function hideLocalAddressesFromWebRtc(session: PermissionCheckTarget): void {
  session.setPermissionCheckHandler((_webContents, permission) => permission !== 'media');
}
