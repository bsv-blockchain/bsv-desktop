import { afterEach, expect, test, vi } from 'vitest'
import { KeyDeriver, PrivateKey, ProtoWallet } from '@bsv/sdk'
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
    const wallet = new ProtoWallet(keyDeriver)
    wallet.listOutputs = async () => ({ totalOutputs: 0, outputs: [] })
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }))
    const manager = queue.createPermissionsManager(wallet as any)
    queue.setPermissionsManager(manager)
    const point = new PrivateKey(31).toPublicKey().toString()
    const call = (operation: string, point: string) => ({ protocolID: [2, `p ecpm ${operation} ${point} mental poker deal`] as [2, string], keyID: 'deck', counterparty: 'self' })
    const pending = manager.getPublicKey(call('apply', point), 'game.example')
    await vi.waitFor(() => expect(queue.getSnapshot().protocolRequests).toHaveLength(1))
    const prompt = queue.getSnapshot().protocolRequests[0]
    expect(prompt.originator).toBe('game.example')
    expect(prompt.protocolID).toBe('p ecpm mental poker deal')
    await manager.grantPermission({ requestID: prompt.requestID, sessionDurationMs: 1_800_000 })
    const masked = await pending
    expect(masked.publicKey).not.toBe(point)
    expect((await manager.getPublicKey(call('remove', masked.publicKey), 'game.example')).publicKey).toBe(point)
    queue.setPermissionsManager(null)
    await expect(manager.getPublicKey(call('apply', point), 'game.example')).rejects.toThrow('session changed')
  } finally { queue.ecpmSession.dispose(); off() }
})
