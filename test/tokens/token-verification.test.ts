/**
 * TokenVerificationService tests — the caching + aggregation layer over B2G.
 *
 * The security-relevant invariants: a counterfeit output taints its card's
 * badge, an `undetermined` never reads as verified, settled verdicts are cached
 * (and `undetermined` ones are NOT — they must be retried), and the
 * protocol→std mapping is right (`bsv-21` → `bsv21`).
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  TokenVerificationService,
  aggregateBadge,
  type OutpointVerification,
} from '../../src/lib/services/tokens/TokenVerificationService'

// A stub B2G client we can drive per outpoint.
function stubClient(byTxid: Record<string, any>) {
  return {
    verify: vi.fn(async (_std: string, txid: string, index: number) => {
      const base = byTxid[txid] ?? { result: 'undetermined', reason: 'source-unavailable' }
      return { outpoint: { txid, index }, ...base }
    }),
  } as any
}

beforeEach(() => vi.clearAllMocks())

describe('aggregateBadge — worst verdict wins', () => {
  const v = (result: string): OutpointVerification => ({ outpoint: 'x_0', result: result as any })
  test('all authentic → verified', () => {
    expect(aggregateBadge([v('authentic'), v('authentic')])).toBe('verified')
  })
  test('any counterfeit → counterfeit, even amid authentic', () => {
    expect(aggregateBadge([v('authentic'), v('not-authentic')])).toBe('counterfeit')
  })
  test('undetermined present, none counterfeit → unknown', () => {
    expect(aggregateBadge([v('authentic'), v('undetermined')])).toBe('unknown')
  })
  test('empty → unknown', () => {
    expect(aggregateBadge([])).toBe('unknown')
  })
})

describe('verifyOutput — protocol→std mapping + shape', () => {
  test('bsv-21 protocol maps to the bsv21 endpoint segment', async () => {
    const client = stubClient({ tx1: { result: 'authentic', genesis: { txid: 'tx1', index: 0 }, genesisDepth: 0 } })
    const svc = new TokenVerificationService({ chain: 'main', client })
    await svc.verifyOutput({ txid: 'tx1', vout: 0, protocol: 'bsv-21' })
    expect(client.verify).toHaveBeenCalledWith('bsv21', 'tx1', 0, { expectedGenesis: undefined })
  })

  test('maps genesis outpoint to the string form', async () => {
    const client = stubClient({ tx1: { result: 'authentic', genesis: { txid: 'gen', index: 2 }, genesisDepth: 3 } })
    const svc = new TokenVerificationService({ chain: 'main', client })
    const r = await svc.verifyOutput({ txid: 'tx1', vout: 0, protocol: 'stas' })
    expect(r.genesis).toBe('gen_2')
    expect(r.genesisDepth).toBe(3)
  })
})

describe('caching', () => {
  test('a settled verdict is not re-fetched', async () => {
    const client = stubClient({ tx1: { result: 'authentic', genesis: { txid: 'tx1', index: 0 } } })
    const svc = new TokenVerificationService({ chain: 'main', client })
    await svc.verifyOutput({ txid: 'tx1', vout: 0, protocol: 'stas' })
    await svc.verifyOutput({ txid: 'tx1', vout: 0, protocol: 'stas' })
    expect(client.verify).toHaveBeenCalledTimes(1)
  })

  test('an undetermined verdict IS retried (it means "unknown", not "no")', async () => {
    const client = stubClient({ tx1: { result: 'undetermined', reason: 'source-unavailable' } })
    const svc = new TokenVerificationService({ chain: 'main', client })
    await svc.verifyOutput({ txid: 'tx1', vout: 0, protocol: 'stas' })
    await svc.verifyOutput({ txid: 'tx1', vout: 0, protocol: 'stas' })
    expect(client.verify).toHaveBeenCalledTimes(2)
  })

  test('force re-fetches a settled verdict (the explicit re-verify path)', async () => {
    const client = stubClient({ tx1: { result: 'authentic', genesis: { txid: 'tx1', index: 0 } } })
    const svc = new TokenVerificationService({ chain: 'main', client })
    await svc.verifyOutput({ txid: 'tx1', vout: 0, protocol: 'stas' })
    await svc.verifyOutput({ txid: 'tx1', vout: 0, protocol: 'stas' }, { force: true })
    expect(client.verify).toHaveBeenCalledTimes(2) // cache bypassed only under force
  })

  test('seed() primes the cache from durable storage; a seeded outpoint is not re-fetched', async () => {
    const client = stubClient({ good: { result: 'authentic', genesis: { txid: 'good', index: 0 } } })
    const svc = new TokenVerificationService({ chain: 'main', client })
    svc.seed([
      {
        output: { txid: 'good', vout: 0, protocol: 'stas' },
        verdict: { outpoint: 'good_0', result: 'authentic', genesis: 'good_0' },
      },
    ])
    await svc.verifyOutput({ txid: 'good', vout: 0, protocol: 'stas' })
    expect(client.verify).not.toHaveBeenCalled()
  })

  test('seed() ignores undetermined verdicts (they must be re-verified)', async () => {
    const client = stubClient({ pend: { result: 'authentic', genesis: { txid: 'pend', index: 0 } } })
    const svc = new TokenVerificationService({ chain: 'main', client })
    svc.seed([
      {
        output: { txid: 'pend', vout: 0, protocol: 'stas' },
        verdict: { outpoint: 'pend_0', result: 'undetermined', reason: 'source-unavailable' },
      },
    ])
    await svc.verifyOutput({ txid: 'pend', vout: 0, protocol: 'stas' })
    expect(client.verify).toHaveBeenCalledTimes(1) // seed skipped it; had to fetch
  })
})

describe('verifyOutputs — batch', () => {
  test('returns a map keyed by outpoint', async () => {
    const client = stubClient({
      a: { result: 'authentic', genesis: { txid: 'a', index: 0 } },
      b: { result: 'not-authentic', reason: 'no-genesis' },
    })
    const svc = new TokenVerificationService({ chain: 'main', client })
    const m = await svc.verifyOutputs([
      { txid: 'a', vout: 0, protocol: 'stas' },
      { txid: 'b', vout: 1, protocol: 'dstas' },
    ])
    expect(m.get('a_0')?.result).toBe('authentic')
    expect(m.get('b_1')?.result).toBe('not-authentic')
  })
})
