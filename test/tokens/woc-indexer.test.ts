/**
 * WocTokenIndexerClient tests.
 *
 * This client is the single discovery source for STAS / DSTAS / BSV-21. A bug
 * in its URL construction (wrong path, base58 where hash160 is required, a
 * dropped `?script=true`) or its response mapping would silently break organic
 * token receive. We pin: per-protocol URL + address format, the WocUtxo /
 * IndexedOutput mapping, and fail-soft (404 → []).
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

// Mock the shared rate-limited fetch the client routes through.
const fetchMock = vi.fn()
vi.mock('../../src/lib/utils/RateLimitedFetch', () => ({
  wocFetch: { fetch: (...args: any[]) => fetchMock(...args) },
}))

import { WocTokenIndexerClient } from '../../src/lib/services/tokens/woc/WocTokenIndexerClient'

const BASE = 'https://woc.test/v1/bsv/test'
const ok = (body: unknown) => ({ ok: true, json: async () => body })
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) })

function client() {
  return new WocTokenIndexerClient({ baseUrl: BASE })
}

beforeEach(() => fetchMock.mockReset())

describe('STAS — getUtxosForAddresses', () => {
  test('hits /address/{base58}/tokens/unspent?script=true and maps rows', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ utxos: [{ txid: 'aa', index: 2, satoshis: 100, script: 'deadbeef', symbol: 'X', tokenId: 'tok' }] })
    )
    const res = await client().getUtxosForAddresses(['1AddrBase58'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/address/1AddrBase58/tokens/unspent?script=true`)
    expect(res).toEqual([
      { address: '1AddrBase58', utxos: [{ txid: 'aa', vout: 2, value: 100, height: 1, symbol: 'X', redeemAddr: 'tok', scriptHex: 'deadbeef' }] },
    ])
  })

  test('null/empty utxos → []', async () => {
    fetchMock.mockResolvedValueOnce(ok({ address: '1A', utxos: null }))
    const res = await client().getUtxosForAddresses(['1A'])
    expect(res).toEqual([{ address: '1A', utxos: [] }])
  })
})

describe('DSTAS — getDstasUtxosForOwners', () => {
  test('keys on the raw hash160 (not base58) and maps satoshis→value, script→scriptHex', async () => {
    const H160 = 'fcfad9b14f0cd788c548b4e14cdba715c31c0c08'
    fetchMock.mockResolvedValueOnce(
      ok({ address: H160, utxos: [{ txid: 'bb', index: 0, tokenId: H160, ownerHash160: H160, satoshis: 5, frozen: false, script: 'cafe' }] })
    )
    const res = await client().getDstasUtxosForOwners([H160])
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/address/${H160}/tokens/dstas/unspent?script=true`)
    expect(res).toEqual([
      { ownerHash160: H160, utxos: [{ txid: 'bb', vout: 0, value: 5, height: 1, symbol: undefined, redeemAddr: H160, scriptHex: 'cafe' }] },
    ])
  })

  test('404 (endpoint not yet on this network) → [] (fail-soft)', async () => {
    fetchMock.mockResolvedValueOnce(notFound())
    const res = await client().getDstasUtxosForOwners(['abcd'])
    expect(res).toEqual([{ ownerHash160: 'abcd', utxos: [] }])
  })
})

describe('BSV-21 — getOwnedTxos', () => {
  test('hits /token/bsv21/{addr}/unspent and maps to IndexedOutput with events', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        tokens: [
          {
            outpoint: 'cc_0',
            vout: 0,
            data: { bsv20: { id: 'cc_0', amt: 1000, sym: 'WOCB21' }, insc: { json: { dec: '2' } } },
          },
        ],
      })
    )
    const res = await client().getOwnedTxos('1Addr')
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/token/bsv21/1Addr/unspent?script=true`)
    expect(res).toEqual([
      { outpoint: 'cc_0', id: 'cc_0', amt: '1000', dec: 2, sym: 'WOCB21', icon: undefined, events: ['bsv21'] },
    ])
  })

  // Captured live from WOC mainnet (EXB21C, our test fleet). WOC's *decoded*
  // bsv20 object spells the ticker `symbol`; only the raw inscription JSON uses
  // `sym`. Reading `bsv20.sym` alone silently yielded an undefined ticker.
  test('maps WOC mainnet shape: bsv20.symbol (not sym), amt as number, dec from insc', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        tokens: [
          {
            outpoint: 'c0f0ba_0',
            vout: 0,
            funderAddress: '13NpehPMQXHqrUQeVbv29tbiBsXGjMBESx',
            data: {
              bsv20: { amt: 10000, id: 'c0f0ba_0', op: 'deploy+mint', protocol: 'bsv-20', symbol: 'EXB21C' },
              insc: { json: { amt: '10000', dec: '0', op: 'deploy+mint', p: 'bsv-20', sym: 'EXB21C' } },
            },
            current: { txid: 'c0f0ba', blockHeight: 957666 },
          },
        ],
        total_count: 1,
      })
    )
    const res = await client().getOwnedTxos('13NpehPMQXHqrUQeVbv29tbiBsXGjMBESx')
    expect(res).toEqual([
      { outpoint: 'c0f0ba_0', id: 'c0f0ba_0', amt: '10000', dec: 0, sym: 'EXB21C', icon: undefined, events: ['bsv21'] },
    ])
  })

  test('network error → [] (fail-soft)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    const res = await client().getOwnedTxos('1Addr')
    expect(res).toEqual([])
  })
})
