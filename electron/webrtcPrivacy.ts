/**
 * Which of this device's network addresses WebRTC offers and answers carry (direct
 * payments; audit finding F4).
 *
 * Chromium replaces host ICE candidates with random mDNS names (`<uuid>.local`)
 * unless the page has camera or microphone permission. Electron grants every
 * permission check when no check handler is installed, so without the handler below
 * every offer, answer and QR code would carry the address of every interface (LAN,
 * VPN, virtual adapters).
 *
 * mDNS names alone often fail between two wallets on the same network: the other
 * computer may not resolve them (no mDNS responder, or a firewall on UDP 5353), and
 * many routers do not loop traffic back to their own public address. So, while the
 * user's "Connect directly on the same network" setting is on (the default), the
 * window's WebRTC IP handling policy publishes the default-route addresses instead:
 * the LAN IPv4 address and the IPv6 address of the interface that reaches the
 * internet, never VPN or virtual adapters, because the 'media' check stays denied.
 * Those addresses reach the other wallet inside the encrypted signal, and appear in
 * face-to-face payment codes. With the setting off the policy is Chromium's default
 * and only mDNS names are offered.
 *
 * Only the 'media' check is denied; every other check stays granted, as before.
 * Camera access for the QR scanner is unaffected: getUserMedia goes through the
 * permission request handler, which still grants it.
 */

/** The part of Electron's `Session` this needs, so it can be tested without Electron. */
export interface PermissionCheckTarget {
  setPermissionCheckHandler(handler: (webContents: unknown, permission: string) => boolean): void;
}

/** The part of Electron's `WebContents` this needs, so it can be tested without Electron. */
export interface IpHandlingTarget {
  setWebRTCIPHandlingPolicy(policy: 'default' | 'default_public_and_private_interfaces' | 'disable_non_proxied_udp'): void;
}

/** Call once the app is ready and before any window loads a page. */
export function hideLocalAddressesFromWebRtc(session: PermissionCheckTarget): void {
  session.setPermissionCheckHandler((_webContents, permission) => permission !== 'media');
}

/**
 * The wallet window does no WebRTC: direct payments run in the live payments worker
 * (electron/liveWorker.ts). Its policy is set so that a connection made there anyway gets no
 * UDP route and gathers no address of this device.
 */
export function keepWebRtcOutOfWalletWindow(webContents: IpHandlingTarget): void {
  webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
}

/**
 * Offers the default-route LAN and IPv6 addresses (`share`) or only mDNS names. Applies to
 * connections the page creates afterwards. Anything but a boolean leaves the policy as it is.
 */
export function shareLocalAddressWithWebRtc(webContents: IpHandlingTarget, share: unknown): void {
  if (typeof share !== 'boolean') return;
  webContents.setWebRTCIPHandlingPolicy(share ? 'default_public_and_private_interfaces' : 'default');
}
