/**
 * Regression tests for anointing the Message Box host.
 *
 * In @bsv/message-box-client 1.x, `init()` also advertised the host on the
 * overlay. From 2.x it only selects the host and loads the identity key; the
 * advertisement needs an explicit `anointHost()`. PeerPayManager still relied on
 * `init()`, so the "Anoint Host" button spun briefly and the host stayed
 * "Not Anointed" with no transaction ever created.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const HOST = 'https://messagebox.babbage.systems'
const IDENTITY = `02${'42'.repeat(32)}`

const client = {
  init: vi.fn(async () => {}),
  anointHost: vi.fn(async () => ({ txid: 'ab'.repeat(32) })),
  getIdentityKey: vi.fn(async () => IDENTITY),
  queryAdvertisements: vi.fn(async (): Promise<any[]> => []),
  revokeHostAdvertisement: vi.fn(async () => {}),
}

vi.mock('@bsv/message-box-client', () => ({
  PeerPayClient: vi.fn(function () { return client }),
}))

async function managerWithClient() {
  const { PeerPayManager } = await import('../src/lib/services/PeerPayManager')
  const manager = new PeerPayManager()
  await manager.createClient({}, HOST, 'admin.local')
  return manager
}

describe('PeerPayManager.anointCurrentHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    client.queryAdvertisements.mockResolvedValue([])
  })

  it('advertises the host on the overlay, not just init()', async () => {
    const manager = await managerWithClient()
    client.queryAdvertisements.mockResolvedValue([{ host: HOST }])

    await manager.anointCurrentHost(HOST)

    expect(client.anointHost).toHaveBeenCalledWith(HOST)
    expect(manager.getSnapshot().isHostAnointed).toBe(true)
    expect(manager.getSnapshot().anointmentLoading).toBe(false)
  })

  it('does not create a transaction while only creating the client', async () => {
    await managerWithClient()
    expect(client.anointHost).not.toHaveBeenCalled()
  })

  it('surfaces a failed advertisement and clears the loading state', async () => {
    const manager = await managerWithClient()
    client.anointHost.mockRejectedValueOnce(new Error('Insufficient funds'))

    await expect(manager.anointCurrentHost(HOST)).rejects.toThrow('Insufficient funds')
    expect(manager.getSnapshot().anointmentLoading).toBe(false)
  })
})
