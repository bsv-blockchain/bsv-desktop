/**
 * Default SHIP provider for profile-free 1Color assets (BRC-207 color-spendability /
 * color-admission on `ls_color_<assetId>`, BRC-22 submit via SHIP).
 *
 * Stability cases pinned here:
 * - fail closed with no overlay network (tstn): empty lookup answers, a
 *   non-retryable refused submit, and no resolver/facilitator call at all;
 * - refusal paths make no network call (off-chain values, no preset);
 * - retry: a resolver throw, a facilitator throw and a rejected broadcast are
 *   retryable transport ColorProviderErrors, never raw errors;
 * - concurrent submits (multi-window / double-submit of two assets) each get
 *   their own host STEAK, never the other's (per-call capture);
 * - an attested STEAK keeps its admissionSignature / admissionIdentityKey
 *   although the SDK's SHIP validator only knows the three BRC-22 fields.
 */

import { describe, expect, test, vi } from 'vitest'
import { LockingScript, Transaction, UnlockingScript } from '@bsv/sdk'
import {
  colorNetworkPreset,
  createShipColorProvider
} from '../src/lib/permissionModules/color/defaultProvider'

const ID = 'a'.repeat(64) + '_0'
const ID2 = 'b'.repeat(64) + '_0'
const OUTPOINT = `${'a'.repeat(64)}.0`
const TOPIC = `tm_color_${ID}`
const TOPIC2 = `tm_color_${ID2}`

/** A one-input tx whose source has no inputs, so BEEF serializes without proofs. */
function atomicBeefFixture (tag: number): number[] {
  const source = new Transaction()
  source.addOutput({ lockingScript: LockingScript.fromASM('OP_TRUE'), satoshis: 1000 + tag })
  const tx = new Transaction()
  tx.addInput({
    sourceTransaction: source,
    sourceOutputIndex: 0,
    unlockingScript: new UnlockingScript([])
  })
  tx.addOutput({ lockingScript: LockingScript.fromASM('OP_TRUE'), satoshis: 1 })
  return tx.toAtomicBEEF(true)
}

const beef = atomicBeefFixture(0)
const atomicBeef = atomicBeefFixture(1)

describe('colorNetworkPreset', () => {
  test('maps each wallet network to its SHIP preset, tstn to none', () => {
    expect(colorNetworkPreset('main')).toBe('mainnet')
    expect(colorNetworkPreset('test')).toBe('testnet')
    expect(colorNetworkPreset('ttn')).toBe('teratestnet')
    expect(colorNetworkPreset('tstn')).toBeUndefined()
  })
})

describe('createShipColorProvider', () => {
  test('tstn has no overlay network: empty answers, refused submit', async () => {
    const resolver = { query: vi.fn() }
    const facilitator = { send: vi.fn() }
    const p = createShipColorProvider({ chain: 'tstn', resolver, facilitator })
    expect(await p.spendability(ID, [OUTPOINT])).toEqual({ type: 'output-list', outputs: [] })
    expect(await p.admission(ID, [OUTPOINT])).toEqual({ type: 'output-list', outputs: [] })
    await expect(p.submit([TOPIC], beef)).rejects.toMatchObject({
      name: 'ColorProviderError',
      code: 'ERR_UNAVAILABLE',
      retryable: false,
      transport: true,
      message: '[ColorProviderError] No 1Color overlay network for this chain'
    })
    expect(resolver.query).not.toHaveBeenCalled()
    expect(facilitator.send).not.toHaveBeenCalled()
  })

  test('queries use the BRC-207 color shapes on ls_color_<assetId>', async () => {
    const answer = { type: 'output-list', outputs: [] }
    const resolver = { query: vi.fn().mockResolvedValue(answer) }
    const p = createShipColorProvider({ chain: 'test', resolver })
    await expect(p.admission(ID, [OUTPOINT])).resolves.toBe(answer)
    expect(resolver.query).toHaveBeenCalledWith({
      service: `ls_color_${ID}`,
      query: { type: 'color-admission', version: 1, assetId: ID, topic: TOPIC, outpoints: [OUTPOINT] }
    }, 10_000)
    await p.spendability(ID, [OUTPOINT])
    expect(resolver.query).toHaveBeenLastCalledWith({
      service: `ls_color_${ID}`,
      query: { type: 'color-spendability', version: 1, assetId: ID, topic: TOPIC, outpoints: [OUTPOINT] }
    }, 10_000)
  })

  test('an explicit timeout reaches the resolver', async () => {
    const resolver = { query: vi.fn().mockResolvedValue({ type: 'output-list', outputs: [] }) }
    const p = createShipColorProvider({ chain: 'main', resolver, timeoutMs: 2_500 })
    await p.spendability(ID, [OUTPOINT])
    expect(resolver.query.mock.calls[0][1]).toBe(2_500)
  })

  test('a resolver failure is a retryable transport error', async () => {
    const resolver = { query: vi.fn().mockRejectedValue(new Error('hosts unreachable')) }
    const p = createShipColorProvider({ chain: 'test', resolver })
    for (const call of [() => p.spendability(ID, [OUTPOINT]), () => p.admission(ID, [OUTPOINT])]) {
      await expect(call()).rejects.toMatchObject({
        name: 'ColorProviderError',
        code: 'ERR_UNAVAILABLE',
        retryable: true,
        transport: true,
        message: '[ColorProviderError] hosts unreachable'
      })
    }
  })

  test('submit returns the host STEAK (local preset, stub facilitator)', async () => {
    const steak = { [TOPIC]: { outputsToAdmit: [0], coinsToRetain: [] } }
    const facilitator = { send: vi.fn().mockResolvedValue(steak) }
    const p = createShipColorProvider({ chain: 'test', networkPreset: 'local', facilitator })
    await expect(p.submit([TOPIC], atomicBeef)).resolves.toEqual(steak)
    expect(facilitator.send).toHaveBeenCalledTimes(1)
    expect(facilitator.send.mock.calls[0][0]).toBe('http://localhost:8080')
    expect(facilitator.send.mock.calls[0][1].topics).toEqual([TOPIC])
    expect(Transaction.fromBEEF(facilitator.send.mock.calls[0][1].beef).id('hex'))
      .toBe(Transaction.fromAtomicBEEF(atomicBeef).id('hex'))
  })

  test('an explicit preset overrides the chain (tstn + local submits)', async () => {
    const steak = { [TOPIC]: { outputsToAdmit: [0], coinsToRetain: [] } }
    const facilitator = { send: vi.fn().mockResolvedValue(steak) }
    const p = createShipColorProvider({ chain: 'tstn', networkPreset: 'local', facilitator })
    await expect(p.submit([TOPIC], atomicBeef)).resolves.toEqual(steak)
  })

  test('an attested STEAK keeps its attestation fields', async () => {
    const steak = {
      [TOPIC]: {
        outputsToAdmit: [0],
        coinsToRetain: [],
        admissionSignature: '3044' + '00'.repeat(68),
        admissionIdentityKey: '02' + '11'.repeat(32)
      }
    }
    const facilitator = { send: vi.fn().mockResolvedValue(steak) }
    const p = createShipColorProvider({ chain: 'test', networkPreset: 'local', facilitator })
    await expect(p.submit([TOPIC], atomicBeef)).resolves.toEqual(steak)
  })

  test('off-chain values are refused before any network call', async () => {
    const facilitator = { send: vi.fn() }
    const p = createShipColorProvider({ chain: 'test', networkPreset: 'local', facilitator })
    await expect(p.submit([TOPIC], atomicBeef, [1])).rejects.toMatchObject({
      name: 'ColorProviderError',
      code: 'ERR_UNSUPPORTED',
      retryable: false,
      transport: false
    })
    expect(facilitator.send).not.toHaveBeenCalled()
  })

  test('empty off-chain values are the same as none', async () => {
    const steak = { [TOPIC]: { outputsToAdmit: [0], coinsToRetain: [] } }
    const facilitator = { send: vi.fn().mockResolvedValue(steak) }
    const p = createShipColorProvider({ chain: 'test', networkPreset: 'local', facilitator })
    await expect(p.submit([TOPIC], atomicBeef, [])).resolves.toEqual(steak)
    expect(facilitator.send.mock.calls[0][1].offChainValues).toBeUndefined()
  })

  test('a STEAK missing the topic fails the submit', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({}) }
    const p = createShipColorProvider({ chain: 'test', networkPreset: 'local', facilitator })
    await expect(p.submit([TOPIC], atomicBeef)).rejects.toMatchObject({
      name: 'ColorProviderError',
      code: 'ERR_UNAVAILABLE',
      retryable: true,
      transport: true
    })
  })

  test('a STEAK that admits nothing fails the submit', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({ [TOPIC]: { outputsToAdmit: [], coinsToRetain: [] } }) }
    const p = createShipColorProvider({ chain: 'test', networkPreset: 'local', facilitator })
    await expect(p.submit([TOPIC], atomicBeef)).rejects.toMatchObject({ name: 'ColorProviderError', code: 'ERR_UNAVAILABLE' })
  })

  test('a facilitator throw is a retryable transport error', async () => {
    const facilitator = { send: vi.fn().mockRejectedValue(new Error('Failed to facilitate broadcast')) }
    const p = createShipColorProvider({ chain: 'test', networkPreset: 'local', facilitator })
    await expect(p.submit([TOPIC], atomicBeef)).rejects.toMatchObject({
      name: 'ColorProviderError',
      code: 'ERR_UNAVAILABLE',
      retryable: true,
      transport: true
    })
  })

  test('concurrent submits of one asset each return their own host STEAK', async () => {
    // The host tags each STEAK with the txid it was sent, so a shared capture would leak.
    const steakFor = (txid: string) => ({ [TOPIC]: { outputsToAdmit: [0], coinsToRetain: [], admissionSignature: txid } })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const facilitator = {
      send: vi.fn(async (_url: string, tagged: { beef: number[] }) => {
        const txid = Transaction.fromBEEF(tagged.beef).id('hex')
        await gate
        return steakFor(txid)
      })
    }
    const p = createShipColorProvider({ chain: 'test', networkPreset: 'local', facilitator })
    const a = p.submit([TOPIC], beef)
    const b = p.submit([TOPIC], atomicBeef)
    await vi.waitFor(() => expect(facilitator.send).toHaveBeenCalledTimes(2))
    release()
    await expect(a).resolves.toEqual(steakFor(Transaction.fromAtomicBEEF(beef).id('hex')))
    await expect(b).resolves.toEqual(steakFor(Transaction.fromAtomicBEEF(atomicBeef).id('hex')))
  })
})
