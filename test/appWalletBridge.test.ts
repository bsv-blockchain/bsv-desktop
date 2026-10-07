import { describe, expect, it, vi } from 'vitest'
import { getReadyAppWalletSnapshot, isAppWalletSnapshotCurrent } from '../src/lib/services/appWalletBridge'

const identity = `02${'42'.repeat(32)}`
function ready() {
  const snapshot: any = {
    lifecycle: 'ready', initializingBackendServices: false, adminOriginator: 'admin',
    activeProfile: { id: [1, 2, 3], identityKey: identity },
    wallet: { getPublicKey: vi.fn(async () => ({ publicKey: identity })) },
    managers: { permissionsManager: { getPublicKey: vi.fn(async () => ({ publicKey: identity })) } },
  }
  return { snapshot, source: { getSnapshot: () => snapshot } }
}

describe('app wallet readiness checks', () => {
  it('verifies the raw and app wallets against the saved active profile', async () => {
    const { source, snapshot } = ready()
    expect(await getReadyAppWalletSnapshot(source)).toBe(snapshot)
    expect(snapshot.managers.permissionsManager.getPublicKey).toHaveBeenCalledWith({ identityKey: true }, 'admin')
  })

  it('rejects a failed build even if a previous permissions manager is retained', async () => {
    const { source, snapshot } = ready()
    snapshot.lifecycle = 'authenticated'
    snapshot.wallet = undefined
    await expect(getReadyAppWalletSnapshot(source)).rejects.toThrow('not ready')
    expect(snapshot.managers.permissionsManager.getPublicKey).not.toHaveBeenCalled()
    expect(isAppWalletSnapshotCurrent(source, snapshot)).toBe(false)
  })

  it('rejects a stale permission manager from another profile', async () => {
    const { source, snapshot } = ready()
    snapshot.managers.permissionsManager.getPublicKey.mockResolvedValue({ publicKey: `03${'51'.repeat(32)}` })
    await expect(getReadyAppWalletSnapshot(source)).rejects.toThrow('does not match')
  })

  it('rejects a label or profile ID assigned to another wallet identity', async () => {
    const { source, snapshot } = ready()
    snapshot.activeProfile.identityKey = `03${'51'.repeat(32)}`
    await expect(getReadyAppWalletSnapshot(source)).rejects.toThrow('does not match')
  })

  it('rejects replacement of the active wallet during identity verification', async () => {
    const { snapshot } = ready()
    let current = snapshot
    const replacement = ready().snapshot
    snapshot.wallet.getPublicKey.mockImplementation(async () => {
      current = replacement
      return { publicKey: identity }
    })
    await expect(getReadyAppWalletSnapshot({ getSnapshot: () => current })).rejects.toThrow('not ready')
    expect(snapshot.managers.permissionsManager.getPublicKey).not.toHaveBeenCalled()
  })
})
