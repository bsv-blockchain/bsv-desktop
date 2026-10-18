/**
 * Audit finding F4: with no permission check handler, Electron grants every check, so
 * Chromium treats the page as having camera/microphone access and puts raw LAN and
 * interface addresses into WebRTC offers and answers instead of mDNS names.
 */

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

// electron/main.ts cannot be imported under vitest (it opens windows and servers).
import { hideLocalAddressesFromWebRtc } from '../electron/webrtcPrivacy'

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
