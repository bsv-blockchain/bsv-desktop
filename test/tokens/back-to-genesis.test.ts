/**
 * BackToGenesisClient tests.
 *
 * B2G is the wallet's counterfeit detector, so the two things that must never
 * regress are: (1) the URL/query construction per standard + expectedGenesis,
 * and (2) the fail-SAFE contract — a transport failure becomes `undetermined`
 * ("unknown"), never a throw and never a false `not-authentic`.
 *
 * The response fixtures below are captured live from WOC mainnet (2026-07-14):
 * a genuine STAS mint, and a real broadcast counterfeit that clones EXSTAS1's
 * tokenId + amount but has no valid ancestor.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.mock('../../src/lib/utils/RateLimitedFetch', () => ({
  wocFetch: { fetch: (...args: any[]) => fetchMock(...args) },
}))

import { BackToGenesisClient, formatGenesisRef } from '../../src/lib/services/tokens/woc/BackToGenesisClient'

const BASE = 'https://woc.test/v1/bsv/main'
const ok = (body: unknown) => ({ ok: true, json: async () => body })
const httpErr = (status: number) => ({ ok: false, status, json: async () => ({}) })

const client = () => new BackToGenesisClient({ baseUrl: BASE })

beforeEach(() => fetchMock.mockReset())

describe('verify — URL construction', () => {
  test('hits /token/{std}/tx/{txid}/out/{index}/verify', async () => {
    fetchMock.mockResolvedValueOnce(ok({ outpoint: { txid: 'aa', index: 0 }, result: 'authentic' }))
    await client().verify('stas', 'aa', 0)
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/token/stas/tx/aa/out/0/verify`)
  })

  test('appends ?expectedGenesis when supplied', async () => {
    fetchMock.mockResolvedValueOnce(ok({ outpoint: { txid: 'aa', index: 2 }, result: 'authentic' }))
    await client().verify('dstas', 'aa', 2, { expectedGenesis: 'gg_0' })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/token/dstas/tx/aa/out/2/verify?expectedGenesis=gg_0`)
  })
})

describe('verify — real response shapes (WOC mainnet 2026-07-14)', () => {
  test('genuine STAS mint → authentic, depth 0', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        outpoint: { txid: '4d43e232', index: 0 },
        result: 'authentic',
        assetKey: { tokenId: '783eadfd045de5484fc4b81ab875df3d96380251' },
        genesis: { txid: '4d43e232', index: 0 },
        genesisDepth: 0,
        amount: '1000',
        conservationOk: true,
      })
    )
    const r = await client().verify('stas', '4d43e232', 0)
    expect(r.result).toBe('authentic')
    expect(r.genesisDepth).toBe(0)
    expect(r.genesis).toEqual({ txid: '4d43e232', index: 0 })
    expect(r.amount).toBe('1000')
  })

  test('broadcast counterfeit (same tokenId+amount as EXSTAS1) → not-authentic', async () => {
    // f8609b32… — a real forgery: EXSTAS1's locking script funded by a
    // non-issuer key, no token ancestor. Decodes as the real identity, still
    // rejected. This is the whole feature's reason to exist.
    fetchMock.mockResolvedValueOnce(
      ok({
        outpoint: { txid: 'f8609b32', index: 0 },
        result: 'not-authentic',
        reason: 'no-genesis',
        assetKey: { tokenId: '783eadfd045de5484fc4b81ab875df3d96380251' },
        genesisDepth: 0,
        amount: '1000',
        conservationOk: true,
        failedAt: { txid: 'f8609b32', index: 0 },
      })
    )
    const r = await client().verify('stas', 'f8609b32', 0)
    expect(r.result).toBe('not-authentic')
    expect(r.reason).toBe('no-genesis')
    // The forgery carries the genuine identity fields — proving the verdict is
    // driven by provenance, not by the decoded tokenId.
    expect(r.assetKey?.tokenId).toBe('783eadfd045de5484fc4b81ab875df3d96380251')
  })

  test('expectedGenesis mismatch stays authentic with matchesExpectedGenesis:false', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        outpoint: { txid: 'a8859452', index: 0 },
        result: 'authentic',
        genesis: { txid: '4d43e232', index: 0 },
        genesisDepth: 1,
        matchesExpectedGenesis: false,
      })
    )
    const r = await client().verify('stas', 'a8859452', 0, { expectedGenesis: '8c57bb64_0' })
    expect(r.result).toBe('authentic')
    expect(r.matchesExpectedGenesis).toBe(false)
  })
})

describe('fail-safe contract', () => {
  test('HTTP 404 → undetermined, never a throw', async () => {
    fetchMock.mockResolvedValueOnce(httpErr(404))
    const r = await client().verify('stas', 'deadbeef', 0)
    expect(r.result).toBe('undetermined')
    expect(r.reason).toBe('source-unavailable')
  })

  test('HTTP 400 (bad standard/index) → undetermined', async () => {
    fetchMock.mockResolvedValueOnce(httpErr(400))
    const r = await client().verify('stas', 'aa', 0)
    expect(r.result).toBe('undetermined')
  })

  test('network throw → undetermined, never propagates', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    const r = await client().verify('bsv21', 'aa', 0)
    expect(r.result).toBe('undetermined')
  })
})

describe('trace', () => {
  test('hits the trace path and returns the ordered path', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        outpoint: { txid: 'cc', index: 0 },
        result: 'authentic',
        genesis: { txid: 'gg', index: 0 },
        genesisDepth: 2,
        path: [
          { txid: 'cc', index: 0, amount: '30', op: 'split', parentOutpoint: 'bb_0' },
          { txid: 'bb', index: 0, amount: '100', op: 'transfer', parentOutpoint: 'gg_0' },
          { txid: 'gg', index: 0, amount: '100', op: 'genesis' },
        ],
        truncated: false,
      })
    )
    const r = await client().trace('dstas', 'cc', 0)
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/token/dstas/tx/cc/out/0/trace`)
    expect(r.path?.[2].op).toBe('genesis')
    expect(r.truncated).toBe(false)
  })

  test('maxDepth is passed through', async () => {
    fetchMock.mockResolvedValueOnce(ok({ outpoint: { txid: 'cc', index: 0 }, result: 'authentic' }))
    await client().trace('stas', 'cc', 0, { maxDepth: 50 })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/token/stas/tx/cc/out/0/trace?maxDepth=50`)
  })
})

describe('formatGenesisRef', () => {
  test('formats as <txid>_<index>', () => {
    expect(formatGenesisRef({ txid: 'abc', index: 3 })).toBe('abc_3')
  })
})
