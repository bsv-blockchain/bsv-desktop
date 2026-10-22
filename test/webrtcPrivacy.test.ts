/**
 * Audit finding F4: with no permission check handler, Electron grants every check, so
 * Chromium treats the page as having camera/microphone access and puts the address of every
 * interface into WebRTC offers and answers instead of mDNS names. The "Connect directly on
 * the same network" setting then publishes only the default-route addresses, through the
 * window's IP handling policy, so wallets on one network can connect without mDNS.
 */

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

// electron/main.ts cannot be imported under vitest (it opens windows and servers).
import { hideLocalAddressesFromWebRtc, keepWebRtcOutOfWalletWindow, shareLocalAddressWithWebRtc } from '../electron/webrtcPrivacy'

function installed() {
  const session = { setPermissionCheckHandler: vi.fn() }
  hideLocalAddressesFromWebRtc(session)
  expect(session.setPermissionCheckHandler).toHaveBeenCalledOnce()
  return session.setPermissionCheckHandler.mock.calls[0][0] as (webContents: unknown, permission: string, origin: string, details: unknown) => boolean
}

describe('hideLocalAddressesFromWebRtc', () => {
  it("denies the 'media' permission check, which makes Chromium hide host addresses behind mDNS", () => {
    expect(installed()(null, 'media', 'file:///', { mediaType: 'video' })).toBe(false)
    expect(installed()(null, 'media', 'http://localhost:5173', { mediaType: 'audio' })).toBe(false)
  })

  it('keeps every other permission check granted, as without a handler', () => {
    const check = installed()
    for (const permission of ['clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen', 'pointerLock', 'geolocation']) {
      expect(check(null, permission, 'file:///', {})).toBe(true)
    }
  })

  it('is installed in main.ts before the window is created', () => {
    const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.ts'), 'utf8')
    const ready = main.indexOf('app.whenReady()')
    const install = main.indexOf('hideLocalAddressesFromWebRtc(session.defaultSession)')
    const firstWindow = main.indexOf('createWindow();', ready)
    expect(ready).toBeGreaterThan(-1)
    expect(install).toBeGreaterThan(ready)
    expect(install).toBeLessThan(firstWindow)
  })
})

describe('shareLocalAddressWithWebRtc', () => {
  const target = () => ({ setWebRTCIPHandlingPolicy: vi.fn() })

  it('publishes the default-route addresses when sharing, and only mDNS names when not', () => {
    const on = target()
    shareLocalAddressWithWebRtc(on, true)
    expect(on.setWebRTCIPHandlingPolicy).toHaveBeenCalledExactlyOnceWith('default_public_and_private_interfaces')
    const off = target()
    shareLocalAddressWithWebRtc(off, false)
    expect(off.setWebRTCIPHandlingPolicy).toHaveBeenCalledExactlyOnceWith('default')
  })

  it.each([undefined, null, 'true', 1, {}])('leaves the policy alone for %j from the page', value => {
    const t = target()
    shareLocalAddressWithWebRtc(t, value)
    expect(t.setWebRTCIPHandlingPolicy).not.toHaveBeenCalled()
  })

  it('applies to the live payments worker, where the connections are, and the wallet window does no WebRTC', () => {
    const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.ts'), 'utf8')
    const created = main.indexOf('mainWindow = new BrowserWindow(')
    const keepOut = main.indexOf('keepWebRtcOutOfWalletWindow(mainWindow.webContents)')
    const load = main.indexOf('mainWindow.loadURL(', created)
    expect(created).toBeGreaterThan(-1)
    expect(keepOut).toBeGreaterThan(created)
    expect(keepOut).toBeLessThan(load)
    expect(main).not.toContain('shareLocalAddressWithWebRtc(')
    // Only the wallet window may change it, and it goes to the worker.
    expect(main).toContain("ipcMain.handle('webrtc:share-local-address', (event, share: unknown) => {\n  if (event.sender !== mainWindow?.webContents) return;\n  liveWorker.setShareLocalAddress(share);")
    // The media check stays denied, so VPN and virtual adapters are never published.
    expect(main).toContain('hideLocalAddressesFromWebRtc(session.defaultSession)')
  })
})

describe('keepWebRtcOutOfWalletWindow', () => {
  it('gives WebRTC in the wallet window no UDP route', () => {
    const t = { setWebRTCIPHandlingPolicy: vi.fn() }
    keepWebRtcOutOfWalletWindow(t)
    expect(t.setWebRTCIPHandlingPolicy).toHaveBeenCalledExactlyOnceWith('disable_non_proxied_udp')
  })
})
