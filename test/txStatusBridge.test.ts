import { afterEach, describe, expect, it, vi } from 'vitest'
import { installTxStatusBridge, TX_STATUS_CHANGED_EVENT, uninstallTxStatusBridge } from '../src/txStatusBridge'
import { createServices } from '../src/lib/services/createServices'
import { arcadeUrl, chaintracksUrl } from '../src/lib/constants/endpoints'

/** A window with just enough of the preload API to install the bridge on. */
function fakeWindow() {
  let push: ((event: unknown) => void) | undefined
  const target = new EventTarget() as EventTarget & { electronAPI: unknown }
  const unsubscribe = vi.fn()
  target.electronAPI = { onTxStatusChanged: (cb: (event: unknown) => void) => { push = cb; return unsubscribe } }
  const heard: string[] = []
  for (const type of ['balance-changed', TX_STATUS_CHANGED_EVENT]) target.addEventListener(type, () => heard.push(type))
  return { target: target as unknown as Window, push: (e: unknown) => push!(e), heard, unsubscribe }
}

afterEach(() => {
  uninstallTxStatusBridge()
  vi.useRealTimers()
})

describe('installTxStatusBridge', () => {
  it('turns a burst of monitor status changes into one refresh', async () => {
    vi.useFakeTimers()
    const w = fakeWindow()
    installTxStatusBridge(w.target)

    for (let i = 0; i < 5; i++) w.push({ txid: `${i}`, status: 'MINED' })
    expect(w.heard).toEqual([])
    await vi.advanceTimersByTimeAsync(300)

    expect(w.heard).toEqual(['balance-changed', TX_STATUS_CHANGED_EVENT])
  })

  it('installs once, and does nothing outside Electron', () => {
    const w = fakeWindow()
    installTxStatusBridge(w.target)
    installTxStatusBridge(w.target)
    uninstallTxStatusBridge()
    expect(w.unsubscribe).toHaveBeenCalledTimes(1)

    expect(() => installTxStatusBridge(new EventTarget() as unknown as Window)).not.toThrow()
  })
})

describe('renderer createServices', () => {
  const IDENTITY_KEY = '02' + 'ef'.repeat(32)

  it('points Arcade and ChainTracks at the same deployment as the main process', () => {
    for (const chain of ['main', 'test', 'ttn'] as const) {
      const services = createServices(chain, IDENTITY_KEY)
      expect(services.options.arcadeUrl, chain).toBe(arcadeUrl(chain))
      expect((services.options.chaintracks as any).serviceUrl, chain).toBe(chaintracksUrl(chain))
      expect((services.options.arcadeConfig as any).callbackToken, chain).toBe(IDENTITY_KEY.substring(0, 32))
      expect(services.getMerklePathServices.services[0].name, chain).toBe('Arcade')
    }
  })

  it('works without an identity (exchange-rate callers), just without a callback token', () => {
    const services = createServices('main')
    expect(services.options.arcadeUrl).toBe(arcadeUrl('main'))
    expect((services.options.arcadeConfig as any).callbackToken).toBeUndefined()
  })
})
