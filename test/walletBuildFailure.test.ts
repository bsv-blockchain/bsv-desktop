import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('../src/lib/services/createServices', () => ({ createServices: vi.fn(() => ({})) }))
vi.mock('../src/lib/services/secrets', () => ({ getSnapshot: () => 'saved-wallet', getKeyHex: () => null, getMnemonic: () => null }))
vi.mock('../src/onWalletReady', () => ({ clearWalletForHttpRoute: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))
// Storage stand-ins for the one successful build below; the failure tests never reach them.
vi.mock('../src/lib/StorageElectronIPC', () => ({
  StorageElectronIPC: vi.fn(function () {
    return { setServices: vi.fn(), initializeBackendServices: vi.fn(async () => {}), makeAvailable: vi.fn(async () => {}) }
  })
}))
vi.mock('../src/lib/walletPortability/WalletDataStorageManager', () => ({
  WalletDataStorageManager: vi.fn(function (identityKey: string) {
    return { _authId: { identityKey }, setServices: vi.fn(), getStores: () => [], setActive: vi.fn(async () => {}), closeForRestore: vi.fn(async () => {}) }
  })
}))

import { PrivateKey } from '@bsv/sdk'
import { WalletService } from '../src/lib/services/WalletService'
import { getReadyAppWalletSnapshot } from '../src/lib/services/appWalletBridge'
import { clearWalletForHttpRoute } from '../src/onWalletReady'

function existingProfile() {
  const service = new WalletService()
  const state = service as any
  const manager = { authenticated: true, underlying: { oldProfile: true } }
  const previousSession = { identityKey: 'old-identity', chain: 'main', close: vi.fn(async () => {}) }
  state._lifecycle = 'ready'
  state._wallet = { oldProfile: true }
  state._managers = { walletManager: manager, permissionsManager: { oldProfile: true }, settingsManager: {}, storageManager: {} }
  state._activeProfile = { id: [1], identityKey: 'old-identity' }
  state.walletData = previousSession
  service.permissionQueue.setPermissionsManager(state._managers.permissionsManager)
  return { service, state, manager, previousSession }
}

beforeEach(() => {
  vi.mocked(clearWalletForHttpRoute).mockClear()
  vi.stubGlobal('window', { electronAPI: {
    walletData: { call: vi.fn(async () => { throw new Error('Target storage is unavailable') }) },
    storage: { releaseNetwork: vi.fn(async () => ({ success: true })) },
  } })
})

describe('failed profile construction', () => {
  it('detaches previous profile services before storage lookup and rejects bridge readiness after a resolved legacy switch', async () => {
    const { service, state, manager, previousSession } = existingProfile()
    const snapshots: any[] = []
    service.on('stateChanged', snapshot => snapshots.push(snapshot))
    // Legacy managers assign null and resolve when walletBuilder fails.
    manager.underlying = await state._buildWallet(new Array(32).fill(1), {})
    expect(manager.underlying).toBeNull()
    expect(snapshots[0].managers.permissionsManager).toBeUndefined()
    expect(snapshots[0].wallet).toBeUndefined()
    expect(previousSession.close).toHaveBeenCalledOnce()
    expect(window.electronAPI.storage.releaseNetwork).toHaveBeenCalledWith('old-identity', 'main')
    expect(service.getSnapshot().managers).toEqual({ walletManager: manager })
    expect((service.permissionQueue as any)._permissionsManager).toBeNull()
    expect(service.getSnapshot().activeProfile).toBeNull()
    expect(service.lifecycle).toBe('error')
    expect(service.startupError).toBe('Target storage is unavailable')
    expect(clearWalletForHttpRoute).toHaveBeenCalled()
    await expect(getReadyAppWalletSnapshot(service)).rejects.toThrow('not ready')
  })

  it('handles a previous-session close failure without leaving a live old permission manager', async () => {
    const { service, state, previousSession } = existingProfile()
    previousSession.close.mockRejectedValue(new Error('Previous storage could not close'))
    await expect(state._buildWallet(new Array(32).fill(1), {})).resolves.toBeNull()
    expect(window.electronAPI.storage.releaseNetwork).toHaveBeenCalledWith('old-identity', 'main')
    expect(window.electronAPI.walletData.call).not.toHaveBeenCalled()
    expect(service.getSnapshot().managers.permissionsManager).toBeUndefined()
    expect(service.wallet).toBeUndefined()
    expect(service.initializingBackendServices).toBe(false)
    expect(service.startupError).toBe('Previous storage could not close')
  })

  it('stops direct payments before opening storage and again when the build fails', async () => {
    const { service, state } = existingProfile()
    const stop = vi.spyOn(service.directPay, 'stop')
    await expect(state._buildWallet(new Array(32).fill(1), {})).resolves.toBeNull()
    // Once in the cleanup of the previous profile, once in the failure path.
    expect(stop).toHaveBeenCalledTimes(2)
    expect(service.directPay.getSnapshot().client).toBeNull()
  })

  it('detaches the previous payment client even when its websocket disconnect fails', async () => {
    const { service, state } = existingProfile()
    ;(service.peerPay as any)._client = { disconnectWebSocket: vi.fn(async () => { throw new Error('Disconnect failed') }) }
    await expect(state._buildWallet(new Array(32).fill(1), {})).resolves.toBeNull()
    expect(service.peerPay.getSnapshot().peerPayClient).toBeNull()
    expect(service.getSnapshot().managers.permissionsManager).toBeUndefined()
    expect(service.startupError).toBe('Disconnect failed')
  })
})

describe('successful wallet build', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('starts direct payments for the new wallet with its identity, network and device settings', async () => {
    const service = new WalletService()
    const state = service as any
    state._useMessageBox = false
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ receiveEnabled: true }), setItem: () => {} })
    vi.stubGlobal('window', { electronAPI: { walletData: { call: vi.fn(async () => ({ preferLocal: false })) }, storage: { releaseNetwork: vi.fn(async () => ({ success: true })) } } })
    const start = vi.spyOn(service.directPay, 'start').mockResolvedValue()
    const primaryKey = new Array(32).fill(1)

    const permissionsManager = await state._buildWallet(primaryKey, {})

    expect(service.lifecycle).toBe('ready')
    expect(start).toHaveBeenCalledOnce()
    const options = start.mock.calls[0][0]
    expect(options.wallet).toBe(permissionsManager)
    expect(options).toMatchObject({
      originator: service.adminOriginator,
      identity: new PrivateKey(primaryKey).toPublicKey().toString(),
      chain: 'main',
      peerPayClient: null,
      messageBoxUrl: undefined,
      settings: { receiveEnabled: true }
    })
  })

  it('does not start direct payments for a build that was superseded meanwhile', async () => {
    const service = new WalletService()
    const state = service as any
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
    vi.stubGlobal('window', { electronAPI: { walletData: { call: vi.fn(async () => ({ preferLocal: false })) }, storage: { releaseNetwork: vi.fn(async () => ({ success: true })) } } })
    const start = vi.spyOn(service.directPay, 'start').mockResolvedValue()
    // A logout or another profile bumps the generation while the PeerPay client is created.
    vi.spyOn(service.peerPay, 'createClient').mockImplementation(async () => { state._walletDataGeneration++ })

    await expect(state._buildWallet(new Array(32).fill(1), {})).resolves.toBeNull()

    expect(start).not.toHaveBeenCalled()
  })
})
