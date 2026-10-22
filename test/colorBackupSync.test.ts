/**
 * Backup sync and the 1Color broadcast guard (contract §8.2).
 *
 * A req the guard withheld sits at `sending` until main's re-park sweep moves
 * it to `nosend`. A backup storage server's monitor posts `unsent`/`sending`
 * reqs it receives, so a sync inside that window would hand it a 1Color
 * transaction to broadcast. Backups sync only on an explicit action (Sync now,
 * add a backup, switch primary), and each of those first asks main for the
 * held list, which runs the sweep. A failing sweep is logged and the sync
 * still runs (the guard's own state is unchanged by it).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() } }))
vi.mock('../src/lib/services/secrets', () => ({ getSnapshot: () => null, getKeyHex: () => null, getMnemonic: () => null, setSnapshot: vi.fn() }))

import { WalletService } from '../src/lib/services/WalletService'

const IDENTITY = '02' + '11'.repeat(32)

let order: string[]
let held: ReturnType<typeof vi.fn>

function service () {
  const s = new WalletService()
  const state = s as any
  state.walletData = { identityKey: IDENTITY, chain: 'test' }
  state._wallet = {}
  state._managers = {
    walletManager: {},
    storageManager: {
      _authId: { identityKey: IDENTITY },
      updateBackups: vi.fn(async () => { order.push('sync') }),
      setActive: vi.fn(async () => { order.push('setActive') }),
      addWalletStorageProvider: vi.fn(async () => {}),
      getStores: vi.fn(() => [
        { isActive: true, storageIdentityKey: 'local', endpointURL: undefined },
        { isActive: false, storageIdentityKey: 'remote', endpointURL: 'https://store.example' }
      ])
    }
  }
  vi.spyOn(state, 'saveEnhancedSnapshot').mockReturnValue('snapshot')
  return { s, state }
}

beforeEach(() => {
  order = []
  held = vi.fn(async () => { order.push('sweep'); return [] as string[] })
  vi.stubGlobal('window', { electronAPI: { colorGuard: { held }, walletData: { call: vi.fn(async () => undefined) } } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('every backup sync runs the color guard sweep first', () => {
  it('Sync now', async () => {
    const { s } = service()
    await s.syncBackupStorage()
    expect(held).toHaveBeenCalledWith(IDENTITY, 'test')
    expect(order).toEqual(['sweep', 'sync'])
  })

  it('switching the primary storage', async () => {
    const { s } = service()
    await s.setPrimaryStorage('https://store.example')
    expect(order).toEqual(['sweep', 'setActive'])
  })

  it('adding a backup', async () => {
    const { s } = service()
    vi.stubGlobal('window', { electronAPI: { colorGuard: { held } } })
    // StorageClient's handshake is not under test: the provider is added as given
    const { StorageClient } = await import('@bsv/wallet-toolbox-client')
    vi.spyOn(StorageClient.prototype, 'makeAvailable').mockResolvedValue({} as any)
    await s.addBackupStorageUrl('https://backup.example')
    expect(order).toEqual(['sweep', 'setActive'])
  })

  it('a failing sweep is logged and the sync still runs; no bridge skips it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    held.mockRejectedValueOnce(new Error('main unreachable'))
    const { s } = service()
    await s.syncBackupStorage()
    expect(order).toEqual(['sync'])
    expect(warn).toHaveBeenCalled()

    vi.stubGlobal('window', { electronAPI: {} })
    order = []
    await s.syncBackupStorage()
    expect(order).toEqual(['sync'])
  })
})
