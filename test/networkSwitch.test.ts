import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Utils } from '@bsv/sdk'

const stored = vi.hoisted(() => ({ snapshot: null as string | null, writes: 0, failWrites: [] as number[] }))
vi.mock('../src/lib/services/secrets', () => ({
  getSnapshot: () => stored.snapshot,
  setSnapshot: (value: string) => { stored.snapshot = value },
  persistSnapshot: async (value: string) => {
    stored.writes++
    if (stored.failWrites.includes(stored.writes)) throw new Error('Vault unavailable')
    stored.snapshot = value
  },
  getKeyHex: () => null,
  getMnemonic: () => null,
}))
vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('../src/onWalletReady', () => ({ clearWalletForHttpRoute: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))

import { WalletService } from '../src/lib/services/WalletService'
import { defaultNetworkSettings } from '../src/lib/networkConfig'
import { activeHttpBridgeRequests, beginHttpBridgeSession, beginUserWalletOperation, isHttpBridgePaused, setHttpBridgePaused, _test_resetHttpBridgeSessions } from '../src/lib/services/httpBridgeSession'
import { clearWalletForHttpRoute } from '../src/onWalletReady'

const identity = `02${'12'.repeat(32)}`
const wallet = () => ({ getPublicKey: vi.fn(async () => ({ publicKey: identity })) })
const manager = () => ({ saveSnapshot: () => [7, 8, 9] })
function readyService() {
  const service = new WalletService()
  const state = service as any
  state._lifecycle = 'ready'
  state._wallet = wallet()
  state._managers = { walletManager: manager(), permissionsManager: {} }
  state.walletData = { close: vi.fn(async () => {}) }
  return { service, state }
}

beforeEach(() => {
  stored.snapshot = null
  stored.writes = 0
  stored.failWrites = []
  vi.mocked(clearWalletForHttpRoute).mockClear()
  _test_resetHttpBridgeSessions()
  vi.stubGlobal('window', { electronAPI: { bootConfig: { set: vi.fn(async () => {}) } }, dispatchEvent: vi.fn() })
  vi.stubGlobal('CustomEvent', class { constructor(public type: string, public detail?: unknown) {} })
})

describe('runtime network changes', () => {
  it('restores unset saved Message Box URLs with the default and honors explicit disable', () => {
    for (const messageBoxUrl of [undefined, null, '', ' \t ']) {
      for (const useMessageBox of [undefined, false]) {
        const config = { network: 'main', loginType: 'mnemonic', messageBoxUrl, useMessageBox, networkSettings: { main: { messageBoxUrl } } }
        const bytes = Array.from(new TextEncoder().encode(JSON.stringify(config)))
        const length: number[] = []
        let remaining = bytes.length
        while (remaining >= 0x80) { length.push((remaining & 0x7f) | 0x80); remaining >>>= 7 }
        length.push(remaining)
        stored.snapshot = Utils.toBase64([3, ...length, ...bytes, 7, 8, 9])
        const service = new WalletService()
        service.restoreConfigFromSnapshot()
        expect(service.messageBoxUrl).toBe('https://messagebox.bsvblockchain.tech')
        expect(service.useMessageBox).toBe(useMessageBox !== false)
        expect(service.getSnapshot().networkSettings.main.useMessageBox).toBe(useMessageBox !== false)
      }
    }
  })

  it('keeps Message Box disabled independently of its default URL across network switches and reload', async () => {
    const { service, state } = readyService()
    service.initialize = vi.fn(async () => {
      state._wallet = wallet()
      state._managers = { walletManager: manager(), permissionsManager: {} }
      state._lifecycle = 'ready'
    })
    await service.applyNetworkSettings('test', { ...defaultNetworkSettings('test'), messageBoxUrl: '', useMessageBox: false })
    expect(service.messageBoxUrl).toBe('https://messagebox.bsvblockchain.tech')
    expect(service.useMessageBox).toBe(false)
    await service.applyNetworkSettings('main', service.getSnapshot().networkSettings.main)
    await service.applyNetworkSettings('test', service.getSnapshot().networkSettings.test)
    expect(service.useMessageBox).toBe(false)
    const restored = new WalletService()
    restored.restoreConfigFromSnapshot()
    expect(restored.messageBoxUrl).toBe('https://messagebox.bsvblockchain.tech')
    expect(restored.useMessageBox).toBe(false)
  })

  it('rebuilds the same identity from a durable snapshot and restores per-network preferences', async () => {
    const { service, state } = readyService()
    const close = state.walletData.close
    service.initialize = vi.fn(async () => {
      expect(isHttpBridgePaused()).toBe(true)
      expect(state._wallet).toBeUndefined()
      const { config, walletSnapshot } = state._loadEnhancedSnapshot(Utils.toArray(stored.snapshot!, 'base64'))
      expect(config.network).toBe('ttn')
      expect(walletSnapshot).toEqual([7, 8, 9])
      state._wallet = wallet()
      state._managers = { walletManager: manager(), permissionsManager: {} }
      state._lifecycle = 'ready'
    })
    const settings = { ...defaultNetworkSettings('ttn'), messageBoxUrl: 'https://my-messagebox.example.com' }
    await service.applyNetworkSettings('ttn', settings)
    expect(close).toHaveBeenCalledOnce()
    expect(service.getSnapshot().selectedNetwork).toBe('ttn')
    expect(service.getSnapshot().networkSettings.ttn).toEqual(settings)
    expect(service.getSnapshot().networkSettings.main).toEqual(defaultNetworkSettings('main'))
    expect(isHttpBridgePaused()).toBe(false)
    expect(service.getSnapshot().switchingNetwork).toBe(false)
    const restored = new WalletService()
    restored.restoreConfigFromSnapshot()
    expect(restored.selectedNetwork).toBe('ttn')
    expect(restored.getSnapshot().networkSettings.ttn.messageBoxUrl).toBe(settings.messageBoxUrl)
  })

  it('retains the old chain and snapshot when the target cannot open', async () => {
    const { service, state } = readyService()
    service.initialize = vi.fn(async () => {
      if (state._selectedNetwork === 'test') throw new Error('Storage unavailable')
      state._wallet = wallet()
      state._managers = { walletManager: manager(), permissionsManager: {} }
      state._lifecycle = 'ready'
    })
    await expect(service.applyNetworkSettings('test', defaultNetworkSettings('test'))).rejects.toThrow('Storage unavailable')
    expect(service.selectedNetwork).toBe('main')
    expect(service.lifecycle).toBe('ready')
    expect(isHttpBridgePaused()).toBe(false)
    const { config } = state._loadEnhancedSnapshot(Utils.toArray(stored.snapshot!, 'base64'))
    expect(config.network).toBe('main')
  })

  it('waits for old storage to close when React re-registers a recovery callback', async () => {
    const { service, state } = readyService()
    let finishClose!: () => void
    state.walletData.close = vi.fn(() => new Promise<void>(resolve => { finishClose = resolve }))
    service.initialize = vi.fn(async () => {
      expect(state.walletData).toBeUndefined()
      state._wallet = wallet()
      state._managers = { walletManager: manager(), permissionsManager: {} }
      state._lifecycle = 'ready'
    })
    service.on('stateChanged', snapshot => {
      if (snapshot.lifecycle === 'configured' && !snapshot.managers.walletManager) {
        service.setRecoveryKeySaver(async () => true)
      }
    })

    const switching = service.applyNetworkSettings('test', defaultNetworkSettings('test'))
    await vi.waitFor(() => expect(finishClose).toBeTypeOf('function'))
    expect(service.initialize).not.toHaveBeenCalled()
    finishClose()
    await switching
    expect(service.initialize).toHaveBeenCalledOnce()
    expect(service.selectedNetwork).toBe('test')
    const restored = new WalletService()
    restored.restoreConfigFromSnapshot()
    expect(restored.selectedNetwork).toBe('test')
  })

  it('reports the underlying initialization failure and retains the previous network', async () => {
    const { service, state } = readyService()
    service.initialize = vi.fn(async () => {
      if (state._selectedNetwork === 'test') {
        state._startupError = 'Failed to initialize services on backend: database unavailable'
        state._lifecycle = 'error'
        return
      }
      state._startupError = ''
      state._wallet = wallet()
      state._managers = { walletManager: manager(), permissionsManager: {} }
      state._lifecycle = 'ready'
    })
    await expect(service.applyNetworkSettings('test', defaultNetworkSettings('test')))
      .rejects.toThrow('Failed to initialize services on backend: database unavailable')
    expect(service.selectedNetwork).toBe('main')
    expect(service.lifecycle).toBe('ready')
  })

  it('refuses to switch while an external app is making a request', async () => {
    const { service } = readyService()
    beginHttpBridgeSession(42, 'example.com')
    expect(activeHttpBridgeRequests()).toBe(1)
    service.initialize = vi.fn()
    await expect(service.applyNetworkSettings('test', defaultNetworkSettings('test'))).rejects.toThrow('Finish the current app request')
    expect(service.initialize).not.toHaveBeenCalled()
    expect(service.selectedNetwork).toBe('main')
    expect(isHttpBridgePaused()).toBe(false)
  })

  it('refuses to switch while a first-party payment is pending', async () => {
    const { service } = readyService()
    const release = beginUserWalletOperation()
    await expect(service.applyNetworkSettings('test', defaultNetworkSettings('test'))).rejects.toThrow('Finish the current app request')
    expect(service.selectedNetwork).toBe('main')
    release()
  })

  it('preserves another transition\'s bridge pause', async () => {
    const { service } = readyService()
    setHttpBridgePaused(true)
    await expect(service.applyNetworkSettings('test', defaultNetworkSettings('test'))).rejects.toThrow('Wait for the wallet')
    expect(service.selectedNetwork).toBe('main')
    expect(isHttpBridgePaused()).toBe(true)
  })

  it('disconnects the target wallet if both final persistence and rollback persistence fail', async () => {
    const { service, state } = readyService()
    const targetManager = { ...manager(), destroy: vi.fn() }
    const targetSession = { close: vi.fn(async () => {}) }
    service.initialize = vi.fn(async () => {
      state._wallet = wallet()
      state._managers = { walletManager: targetManager, permissionsManager: {} }
      state.walletData = targetSession
      state._lifecycle = 'ready'
    })
    stored.failWrites = [2, 3]
    await expect(service.applyNetworkSettings('test', defaultNetworkSettings('test'))).rejects.toThrow('Vault unavailable')
    expect(service.selectedNetwork).toBe('main')
    expect(service.lifecycle).toBe('error')
    expect(service.wallet).toBeUndefined()
    expect(service.getSnapshot().managers).toEqual({})
    expect(targetManager.destroy).toHaveBeenCalledOnce()
    expect(targetSession.close).toHaveBeenCalledOnce()
    expect(clearWalletForHttpRoute).toHaveBeenCalledTimes(2)
    expect(service.startupError).toContain('keys are preserved')
    expect(isHttpBridgePaused()).toBe(false)
  })

  it('does not commit a replacement identity', async () => {
    const { service, state } = readyService()
    service.initialize = vi.fn(async () => {
      state._wallet = state._selectedNetwork === 'test'
        ? { getPublicKey: async () => ({ publicKey: `03${'34'.repeat(32)}` }) }
        : wallet()
      state._managers = { walletManager: manager(), permissionsManager: {} }
      state._lifecycle = 'ready'
    })
    await expect(service.applyNetworkSettings('test', defaultNetworkSettings('test'))).rejects.toThrow('identity changed')
    expect(service.selectedNetwork).toBe('main')
    expect((await service.wallet!.getPublicKey({ identityKey: true })).publicKey).toBe(identity)
  })
})
