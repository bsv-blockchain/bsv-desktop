/**
 * verifyAndPersistOnReceive tests.
 *
 * The receive-path hook: it must persist a settled verdict to the wallet DB via
 * the stas:query IPC, skip `undetermined` (leave it for the load-time retry),
 * map the protocol to the right endpoint segment, and — the safety contract —
 * never throw into the receive path, even if verify or the IPC fails.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

const verifyMock = vi.fn()
vi.mock('../../src/lib/services/tokens/woc/BackToGenesisClient', async (orig) => {
  const mod: any = await orig()
  return { ...mod, BackToGenesisClient: class { verify = verifyMock } }
})

const stasQueryMock = vi.fn()
vi.mock('../../src/lib/services/stas/stasIpc', () => ({
  stasQuery: (...args: any[]) => stasQueryMock(...args),
}))

import { verifyAndPersistOnReceive } from '../../src/lib/services/tokens/verifyOnReceive'

// The helper is fire-and-forget (returns void, work happens in a floating
// promise). Yield the microtask queue so the async body runs before asserting.
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  verifyMock.mockReset()
  stasQueryMock.mockReset()
  stasQueryMock.mockResolvedValue(undefined)
})

describe('verifyAndPersistOnReceive', () => {
  test('persists a settled authentic verdict via upsertTokenVerification', async () => {
    verifyMock.mockResolvedValueOnce({
      outpoint: { txid: 'aa', index: 0 },
      result: 'authentic',
      genesis: { txid: 'gen', index: 2 },
      genesisDepth: 3,
    })
    verifyAndPersistOnReceive('idk', 'main', { txid: 'aa', vout: 0, protocol: 'stas' })
    await flush()

    expect(verifyMock).toHaveBeenCalledWith('stas', 'aa', 0)
    expect(stasQueryMock).toHaveBeenCalledTimes(1)
    const [idk, chain, method, args] = stasQueryMock.mock.calls[0]
    expect([idk, chain, method]).toEqual(['idk', 'main', 'upsertTokenVerification'])
    expect(args[0]).toMatchObject({
      txid: 'aa', vout: 0, protocol: 'stas', result: 'authentic',
      genesis: 'gen_2', genesisDepth: 3, reason: null,
    })
  })

  test('persists a counterfeit verdict with its reason', async () => {
    verifyMock.mockResolvedValueOnce({ outpoint: { txid: 'bb', index: 1 }, result: 'not-authentic', reason: 'no-genesis' })
    verifyAndPersistOnReceive('idk', 'main', { txid: 'bb', vout: 1, protocol: 'dstas' })
    await flush()
    expect(stasQueryMock.mock.calls[0][3][0]).toMatchObject({
      result: 'not-authentic', reason: 'no-genesis', genesis: null,
    })
  })

  test('does NOT persist an undetermined verdict (left for load-time retry)', async () => {
    verifyMock.mockResolvedValueOnce({ outpoint: { txid: 'cc', index: 0 }, result: 'undetermined', reason: 'source-unavailable' })
    verifyAndPersistOnReceive('idk', 'main', { txid: 'cc', vout: 0, protocol: 'bsv-21' })
    await flush()
    expect(stasQueryMock).not.toHaveBeenCalled()
  })

  test('maps bsv-21 protocol to the bsv21 endpoint segment', async () => {
    verifyMock.mockResolvedValueOnce({ outpoint: { txid: 'dd', index: 0 }, result: 'authentic', genesis: { txid: 'dd', index: 0 }, genesisDepth: 0 })
    verifyAndPersistOnReceive('idk', 'test', { txid: 'dd', vout: 0, protocol: 'bsv-21' })
    await flush()
    expect(verifyMock).toHaveBeenCalledWith('bsv21', 'dd', 0)
  })

  test('never throws into the receive path when verify rejects', async () => {
    verifyMock.mockRejectedValueOnce(new Error('offline'))
    // The call itself is synchronous (returns void); the rejection is swallowed
    // inside the floating promise. Flushing must not surface an unhandled throw.
    expect(() => verifyAndPersistOnReceive('idk', 'main', { txid: 'ee', vout: 0, protocol: 'stas' })).not.toThrow()
    await flush()
    expect(stasQueryMock).not.toHaveBeenCalled()
  })

  test('swallows a persistence (IPC) failure', async () => {
    verifyMock.mockResolvedValueOnce({ outpoint: { txid: 'ff', index: 0 }, result: 'authentic', genesis: { txid: 'ff', index: 0 }, genesisDepth: 0 })
    stasQueryMock.mockRejectedValueOnce(new Error('ipc down'))
    verifyAndPersistOnReceive('idk', 'main', { txid: 'ff', vout: 0, protocol: 'stas' })
    await flush()
    expect(stasQueryMock).toHaveBeenCalledTimes(1) // attempted, failure swallowed
  })
})
