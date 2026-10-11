import { beforeEach, describe, expect, it, vi } from 'vitest'

const vault = vi.hoisted(() => ({
  snapshot: 'saved' as string | null,
  endSession: vi.fn(async () => {}),
  clearCache: vi.fn(),
}))
vi.mock('../src/lib/services/secrets', () => ({
  getSnapshot: () => vault.snapshot,
  setSnapshot: (value: string) => { vault.snapshot = value },
  persistSnapshot: async (value: string) => { vault.snapshot = value },
  getKeyHex: () => null,
  getMnemonic: () => null,
  endSession: vault.endSession,
  clearCache: vault.clearCache,
}))
vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('../src/onWalletReady', () => ({ clearWalletForHttpRoute: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { WalletService } from '../src/lib/services/WalletService'
import { beginHttpBridgeSession, beginUserWalletOperation, isHttpBridgePaused, _test_resetHttpBridgeSessions } from '../src/lib/services/httpBridgeSession'
import { clearWalletForHttpRoute } from '../src/onWalletReady'

const identity = `02${'12'.repeat(32)}`
let releaseNetwork: ReturnType<typeof vi.fn>
let local: Map<string, string>

function readyService() {
  const service = new WalletService()
  const state = service as any
  const walletManager = { saveSnapshot: () => [7, 8, 9], destroy: vi.fn() }
  state._lifecycle = 'ready'
  state._wallet = { getPublicKey: vi.fn(async () => ({ publicKey: identity })) }
  state._managers = { walletManager, permissionsManager: {} }
  state.walletData = { identityKey: identity, chain: 'main', close: vi.fn(async () => {}) }
  return { service, state, walletManager }
}

beforeEach(() => {
  vault.snapshot = 'saved'
  vault.endSession.mockReset().mockResolvedValue(undefined)
  vault.clearCache.mockClear()
  vi.mocked(clearWalletForHttpRoute).mockClear()
  _test_resetHttpBridgeSessions()
  releaseNetwork = vi.fn(async () => ({ success: true }))
  local = new Map([['payReq_abc', 'keep'], ['permissionsConfig', '{}'], ['brc100_recent_apps_x', '[]']])
  vi.stubGlobal('localStorage', {
    get length() { return local.size },
    key: (i: number) => [...local.keys()][i] ?? null,
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => { local.set(k, v) },
    removeItem: (k: string) => { local.delete(k) },
    clear: () => local.clear(),
  })
  vi.stubGlobal('window', {
    electronAPI: { bootConfig: { set: vi.fn(async () => {}) }, storage: { releaseNetwork } },
    dispatchEvent: vi.fn(),
  })
  vi.stubGlobal('CustomEvent', class { constructor(public type: string, public detail?: unknown) {} })
})

describe('removeWalletFromDevice', () => {
  it('closes the open wallet, then wipes its secrets and local state', async () => {
    const { service, state, walletManager } = readyService()
    const close = state.walletData.close
    await service.removeWalletFromDevice()
    expect(clearWalletForHttpRoute).toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(releaseNetwork).toHaveBeenCalledWith(identity, 'main')
    expect(walletManager.destroy).toHaveBeenCalled()
    expect(vault.endSession).toHaveBeenCalledOnce()
    expect(vault.clearCache).toHaveBeenCalled()
    expect([...local.keys()]).toEqual(['payReq_abc'])
    expect(service.lifecycle).toBe('unconfigured')
    expect(service.wallet).toBeUndefined()
    expect(service.managers).toEqual({})
    expect(isHttpBridgePaused()).toBe(false)
  })

  it('still wipes secrets when storage cannot close cleanly', async () => {
    const { service } = readyService()
    releaseNetwork.mockResolvedValue({ success: false, error: 'busy' })
    await service.removeWalletFromDevice()
    expect(vault.endSession).toHaveBeenCalledOnce()
    expect(service.lifecycle).toBe('unconfigured')
  })

  it('refuses while an app request is in flight', async () => {
    const { service } = readyService()
    beginHttpBridgeSession(1, 'https://app.example')
    await expect(service.removeWalletFromDevice()).rejects.toThrow('Finish the current app request')
    expect(vault.endSession).not.toHaveBeenCalled()
    expect(service.lifecycle).toBe('ready')
  })

  it('refuses while a payment is in progress', async () => {
    const { service } = readyService()
    beginUserWalletOperation()
    await expect(service.removeWalletFromDevice()).rejects.toThrow('Finish the current app request')
    expect(vault.endSession).not.toHaveBeenCalled()
  })

  it('refuses before the wallet has opened', async () => {
    const service = new WalletService()
    await expect(service.removeWalletFromDevice()).rejects.toThrow()
    expect(vault.endSession).not.toHaveBeenCalled()
  })

  it('keeps local state when the vault cannot be wiped', async () => {
    const { service } = readyService()
    vault.endSession.mockRejectedValue(new Error('VAULT_LOCKED'))
    await expect(service.removeWalletFromDevice()).rejects.toThrow('could not be removed')
    expect(local.has('permissionsConfig')).toBe(true)
    expect(vault.clearCache).not.toHaveBeenCalled()
    expect(service.lifecycle).not.toBe('unconfigured')
    expect(isHttpBridgePaused()).toBe(false)
  })
})
