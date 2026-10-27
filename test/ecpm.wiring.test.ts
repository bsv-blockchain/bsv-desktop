import { afterEach, expect, test, vi } from 'vitest'
import { KeyDeriver, PrivateKey } from '@bsv/sdk'
vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
import { PermissionQueueManager } from '../src/lib/services/PermissionQueueManager'

afterEach(() => vi.unstubAllGlobals())

test('the production queue installs ECPM without changing the ordinary key path and disposes it on close', async () => {
  vi.stubGlobal('window', {})
  const queue = new PermissionQueueManager()
  queue.adminOriginator = 'wallet.local'
  const keyDeriver = new KeyDeriver(new PrivateKey(17))
  const off = queue.ecpmSession.subscribe(() => {})
  try {
    const manager = queue.createPermissionsManager({ keyDeriver } as any)
    queue.setPermissionsManager(manager)
    const point = new PrivateKey(31).toPublicKey().toString()
    const call = (operation: string, point: string) => ({ protocolID: [2, `p ecpm ${operation} ${point} mental poker deal`] as [2, string], keyID: 'deck', counterparty: 'self' })
    const pending = manager.getPublicKey(call('apply', point), 'game.example')
    const prompt = queue.ecpmSession.getSnapshot()
    expect(prompt?.request.originator).toBe('game.example')
    prompt!.answer(true)
    const masked = await pending
    expect(masked.publicKey).not.toBe(point)
    expect((await manager.getPublicKey(call('remove', masked.publicKey), 'game.example')).publicKey).toBe(point)
    queue.setPermissionsManager(null)
    await expect(manager.getPublicKey(call('apply', point), 'game.example')).rejects.toThrow('session changed')
  } finally { queue.ecpmSession.dispose(); off() }
})
