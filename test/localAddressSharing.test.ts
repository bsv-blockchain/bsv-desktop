/**
 * The "Connect directly on the same network" setting reaches the main process at start-up and
 * after every save, so the window's WebRTC address policy matches what the user chose.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DIRECT_PAY_SETTINGS_KEY, saveDirectPaySettings } from '../src/lib/utils/directPaySettings'
import { followLocalAddressSharing } from '../src/lib/utils/localAddressSharing'

const local = new Map<string, string>()

beforeEach(() => {
  local.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => { local.set(k, v) },
    removeItem: (k: string) => { local.delete(k) }
  })
  vi.stubGlobal('window', new EventTarget())
})

describe('followLocalAddressSharing', () => {
  it('sends the default (on) at once, then every saved choice, until stopped', () => {
    const apply = vi.fn(async (_share: boolean) => {})
    const stop = followLocalAddressSharing(apply)
    expect(apply.mock.calls).toEqual([[true]])

    saveDirectPaySettings({ shareLocalAddress: false })
    saveDirectPaySettings({ shareLocalAddress: true })
    expect(apply.mock.calls).toEqual([[true], [false], [true]])

    stop()
    saveDirectPaySettings({ shareLocalAddress: false })
    expect(apply).toHaveBeenCalledTimes(3)
  })

  it('sends a stored choice of off at start-up', () => {
    local.set(DIRECT_PAY_SETTINGS_KEY, JSON.stringify({ receiveEnabled: true, shareLocalAddress: false, signaling: 'relay', relayUrl: 'wss://relay.example.com', stunUrls: [] }))
    const apply = vi.fn(async (_share: boolean) => {})
    followLocalAddressSharing(apply)
    expect(apply).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('does nothing without the Electron bridge', () => {
    const stop = followLocalAddressSharing(undefined)
    expect(() => saveDirectPaySettings({ shareLocalAddress: false })).not.toThrow()
    stop()
  })

  it('logs a bridge that fails instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    followLocalAddressSharing(async () => { throw new Error('no handler') })
    await Promise.resolve()
    await Promise.resolve()
    expect(warn).toHaveBeenCalledWith('[DirectPay] Could not apply the same-network setting:', expect.any(Error))
    warn.mockRestore()
  })
})
