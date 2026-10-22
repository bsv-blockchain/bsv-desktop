/**
 * electron/liveWorker.ts: the live payments worker window is sandboxed, in its own session,
 * with every permission denied and no network of its own; only the wallet window may open
 * it, and each open gives both a fresh port; when it dies, the wallet window hears so.
 */
import { describe, expect, it, vi } from 'vitest'
import { isWorkerPageRequest, LIVE_WORKER_PARTITION, liveWorkerPage, registerLiveWorker } from '../electron/liveWorker'

function fakes() {
  const handlers: Record<string, (event: any, ...args: unknown[]) => unknown> = {}
  const windows: any[] = []
  const session = {
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() }
  }
  class BrowserWindow {
    options: any
    destroyed = false
    listeners: Record<string, (...a: any[]) => void> = {}
    webContents: any
    constructor(options: any) {
      this.options = options
      const contentsListeners: Record<string, (...a: any[]) => void> = {}
      this.webContents = {
        listeners: contentsListeners,
        setWebRTCIPHandlingPolicy: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        postMessage: vi.fn(),
        on: (name: string, fn: (...a: any[]) => void) => { contentsListeners[name] = fn }
      }
      windows.push(this)
    }
    on(name: string, fn: (...a: any[]) => void) { this.listeners[name] = fn }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.listeners.closed?.() }
    loadURL = vi.fn(async () => {})
    loadFile = vi.fn(async () => {})
  }
  class MessageChannelMain {
    port1 = { name: 'wallet end' }
    port2 = { name: 'worker end' }
  }
  const wallet = { send: vi.fn(), postMessage: vi.fn() }
  const controller = registerLiveWorker({
    BrowserWindow: BrowserWindow as any,
    MessageChannelMain: MessageChannelMain as any,
    ipcMain: { handle: (channel: string, fn: any) => { handlers[channel] = fn } } as any,
    fromPartition: vi.fn(() => session as any),
    walletContents: () => wallet as any,
    isDev: false,
    dir: '/app/dist-electron'
  })
  return { handlers, windows, session, wallet, controller }
}

describe('the live payments worker window', () => {
  it('is sandboxed, isolated, without Node, in its own session, with a preload that only hands over the port', async () => {
    const { handlers, windows, session, wallet } = fakes()
    await handlers['live-worker:open']({ sender: wallet })
    expect(windows).toHaveLength(1)
    const prefs = windows[0].options.webPreferences
    expect(prefs).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, webviewTag: false, backgroundThrottling: false, devTools: false })
    expect(prefs.session).toBe(session)
    expect(prefs.preload).toBe('/app/dist-electron/live-worker-preload.cjs')
    expect(windows[0].options.show).toBe(false)
    expect(windows[0].loadFile).toHaveBeenCalledWith('/app/dist/live-worker.html')
    expect(LIVE_WORKER_PARTITION).not.toMatch(/^persist:/)
  })

  it('denies every permission, and cancels every request but its own page', async () => {
    const { handlers, session, wallet } = fakes()
    await handlers['live-worker:open']({ sender: wallet })
    const check = session.setPermissionCheckHandler.mock.calls[0][0]
    for (const p of ['media', 'clipboard-read', 'notifications', 'geolocation']) expect(check(null, p)).toBe(false)
    const request = session.setPermissionRequestHandler.mock.calls[0][0]
    const callback = vi.fn()
    request(null, 'media', callback)
    expect(callback).toHaveBeenCalledWith(false)
    const filter = session.webRequest.onBeforeRequest.mock.calls[0][0]
    const answer = vi.fn()
    filter({ url: 'https://evil.example/exfiltrate' }, answer)
    expect(answer).toHaveBeenLastCalledWith({ cancel: true })
    filter({ url: 'file:///app/dist/assets/liveWorker.js' }, answer)
    expect(answer).toHaveBeenLastCalledWith({ cancel: false })
    expect(isWorkerPageRequest('wss://webrtpay-relay-us-1.bsvblockchain.tech', false)).toBe(false)
    expect(isWorkerPageRequest('http://localhost:5173/src/liveWorkerPage.ts', true)).toBe(true)
    expect(liveWorkerPage(true, '/x')).toEqual({ url: 'http://localhost:5173/live-worker.html' })
  })

  it('gives the wallet window and the worker one end each of a fresh channel on every open, and reuses the window', async () => {
    const { handlers, windows, wallet } = fakes()
    await handlers['live-worker:open']({ sender: wallet })
    await handlers['live-worker:open']({ sender: wallet })
    expect(windows).toHaveLength(1)
    expect(windows[0].webContents.postMessage).toHaveBeenCalledTimes(2)
    expect(windows[0].webContents.postMessage).toHaveBeenLastCalledWith('live-worker:port', null, [{ name: 'worker end' }])
    expect(wallet.postMessage).toHaveBeenLastCalledWith('live-worker:port', null, [{ name: 'wallet end' }])
  })

  it('opens only for the wallet window', async () => {
    const { handlers, windows } = fakes()
    await expect(handlers['live-worker:open']({ sender: { other: true } })).rejects.toThrow(/Only the wallet window/)
    expect(windows).toHaveLength(0)
  })

  it('tells the wallet window when the worker dies, and starts a new one on the next open', async () => {
    const { handlers, windows, wallet } = fakes()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await handlers['live-worker:open']({ sender: wallet })
    windows[0].webContents.listeners['render-process-gone']({}, { reason: 'crashed' })
    expect(wallet.send).toHaveBeenCalledExactlyOnceWith('live-worker:gone')
    expect(windows[0].destroyed).toBe(true)
    await handlers['live-worker:open']({ sender: wallet })
    expect(windows).toHaveLength(2)
  })

  it('applies "Connect directly on the same network" to the worker, now and when it starts', async () => {
    const { handlers, windows, wallet, controller } = fakes()
    controller.setShareLocalAddress(false)
    await handlers['live-worker:open']({ sender: wallet })
    expect(windows[0].webContents.setWebRTCIPHandlingPolicy).toHaveBeenLastCalledWith('default')
    controller.setShareLocalAddress(true)
    expect(windows[0].webContents.setWebRTCIPHandlingPolicy).toHaveBeenLastCalledWith('default_public_and_private_interfaces')
    controller.setShareLocalAddress('yes')
    expect(windows[0].webContents.setWebRTCIPHandlingPolicy).toHaveBeenCalledTimes(2)
  })

  it('blocks navigation after the first load, and every new window', async () => {
    const { handlers, windows, wallet } = fakes()
    await handlers['live-worker:open']({ sender: wallet })
    const event = { preventDefault: vi.fn() }
    windows[0].webContents.listeners['will-navigate'](event, 'https://evil.example')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(windows[0].webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' })
  })

  it('closes for the wallet window only, and on quit', async () => {
    const { handlers, windows, wallet, controller } = fakes()
    await handlers['live-worker:open']({ sender: wallet })
    expect(() => handlers['live-worker:close']({ sender: {} })).toThrow()
    expect(windows[0].destroyed).toBe(false)
    handlers['live-worker:close']({ sender: wallet })
    expect(windows[0].destroyed).toBe(true)
    // A window closed on request is not reported as gone.
    expect(wallet.send).not.toHaveBeenCalled()
    await handlers['live-worker:open']({ sender: wallet })
    controller.destroy()
    expect(windows[1].destroyed).toBe(true)
  })
})
