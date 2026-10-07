import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('../src/lib/services/createServices', () => ({ createServices: vi.fn(() => ({})) }))
vi.mock('../src/lib/services/secrets', () => ({ getSnapshot: () => 'saved-wallet', getKeyHex: () => null, getMnemonic: () => null }))
vi.mock('../src/onWalletReady', () => ({ clearWalletForHttpRoute: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))

import { WalletService } from '../src/lib/services/WalletService'
import { getReadyAppWalletSnapshot } from '../src/lib/services/appWalletBridge'
import { clearWalletForHttpRoute } from '../src/onWalletReady'

function existingProfile() {
  const service = new WalletService()
  const state = service as any
  const manager = { authenticated: true, underlying: { oldProfile: true } }
  const previousSession = { identityKey: 'old-identity', chain: 'main', close: vi.fn(async () => {}) }
  const previousTokens = { disconnectWebSocket: vi.fn(async () => {}) }
  state._lifecycle = 'ready'
  state._wallet = { oldProfile: true }
  state._managers = { walletManager: manager, permissionsManager: { oldProfile: true }, settingsManager: {}, storageManager: {} }
  state._activeProfile = { id: [1], identityKey: 'old-identity' }
  state._stas = { peerTokens: previousTokens }
  state.walletData = previousSession
  service.permissionQueue.setPermissionsManager(state._managers.permissionsManager)
  return { service, state, manager, previousSession, previousTokens }
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
    const { service, state, manager, previousSession, previousTokens } = existingProfile()
    const snapshots: any[] = []
    service.on('stateChanged', snapshot => snapshots.push(snapshot))
    // Legacy managers assign null and resolve when walletBuilder fails.
    manager.underlying = await state._buildWallet(new Array(32).fill(1), {})
    expect(manager.underlying).toBeNull()
    expect(snapshots[0].managers.permissionsManager).toBeUndefined()
    expect(snapshots[0].wallet).toBeUndefined()
    expect(previousSession.close).toHaveBeenCalledOnce()
    expect(previousTokens.disconnectWebSocket).toHaveBeenCalledOnce()
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

  it('detaches the previous payment client even when its websocket disconnect fails', async () => {
    const { service, state } = existingProfile()
    ;(service.peerPay as any)._client = { disconnectWebSocket: vi.fn(async () => { throw new Error('Disconnect failed') }) }
    await expect(state._buildWallet(new Array(32).fill(1), {})).resolves.toBeNull()
    expect(service.peerPay.getSnapshot().peerPayClient).toBeNull()
    expect(service.getSnapshot().managers.permissionsManager).toBeUndefined()
    expect(service.startupError).toBe('Disconnect failed')
  })
})
