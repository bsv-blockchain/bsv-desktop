import { afterEach, describe, expect, it, vi } from 'vitest'
import { storageManager } from '../electron/storage'
import { walletStorageKey } from '../electron/wallet-portability/bindings'

const identity = `02${'bc'.repeat(32)}`
afterEach(() => vi.restoreAllMocks())

describe('inactive network storage lifecycle', () => {
  it('stops the old monitor and closes its database without fencing a future reopen', async () => {
    const key = walletStorageKey(identity, 'ttn')
    const manager = storageManager as any
    const database = { destroy: vi.fn(async () => {}) }
    manager.databases.set(key, database)
    manager.storages.set(key, { network: 'ttn' })
    const stop = vi.spyOn(storageManager, 'stopMonitorWorker').mockResolvedValue(undefined)
    await storageManager.releaseNetwork(identity, 'ttn')
    expect(stop).toHaveBeenCalledWith(identity, 'ttn')
    expect(database.destroy).toHaveBeenCalledOnce()
    expect(manager.databases.has(key)).toBe(false)
    expect(manager.storages.has(key)).toBe(false)
    await expect(storageManager.request(identity, 'ttn', async () => 'reopened')).resolves.toBe('reopened')
  })

  it('drains existing storage requests before closing the database', async () => {
    const key = walletStorageKey(identity, 'tstn')
    const manager = storageManager as any
    const database = { destroy: vi.fn(async () => {}) }
    manager.databases.set(key, database)
    vi.spyOn(storageManager, 'stopMonitorWorker').mockResolvedValue(undefined)
    let release!: () => void
    const pending = storageManager.request(identity, 'tstn', () => new Promise<void>(resolve => { release = resolve }))
    const closing = storageManager.releaseNetwork(identity, 'tstn')
    await Promise.resolve()
    expect(database.destroy).not.toHaveBeenCalled()
    release()
    await pending
    await closing
    expect(database.destroy).toHaveBeenCalledOnce()
  })
})
