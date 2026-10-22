/**
 * Asset display resolver (deploy `dec`/`sym`/`label` via `color-admission` +
 * `readDeploy`) and consent-message enrichment.
 *
 * Stability cases pinned here:
 * - untrusted overlay answers: an answer for another transaction, a wrong
 *   output index, a non-deploy script or an asset id `readDeploy` does not
 *   confirm is ignored and the next provider is asked (display spoofing,
 *   0162 "Display spoofing", 0207:960-962);
 * - retry / overlay down: a throwing or never-answering provider is skipped
 *   within `timeoutMs`, a late rejection is swallowed, and nothing is cached
 *   for an unresolved asset (a later prompt asks again);
 * - multi-window / double prompt: concurrent resolves of one asset share one
 *   lookup; resolved deploys are cached (deploys are immutable), bounded by
 *   `maxEntries` (oldest first);
 * - stale configuration: `providers()` is read on every resolve;
 * - enrichment never removes or alters module members, overwrites any
 *   pre-existing `hostDisplay`, and leaves an unparseable message unchanged.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { LockingScript, Transaction, UnlockingScript } from '@bsv/sdk'
import {
  createAssetDisplayResolver,
  enrichConsentMessage
} from '../src/lib/permissionModules/color/assetDisplay'

const DEPLOY_SCRIPT_HEX = readFileSync(join(__dirname, 'fixtures', '1color-deploy-script.hex'), 'utf8').trim()

/** A tx whose output 0 is `script` (1 sat) and whose one input has a proof-less source. */
function txWith (script: LockingScript, tag: number): Transaction {
  const source = new Transaction()
  source.addOutput({ lockingScript: LockingScript.fromASM('OP_TRUE'), satoshis: 1000 + tag })
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
  tx.addOutput({ lockingScript: script, satoshis: 1 })
  return tx
}

const deployTx = txWith(LockingScript.fromHex(DEPLOY_SCRIPT_HEX), 0)
const TXID = deployTx.id('hex')
const ID = `${TXID}_0`
const deployTx2 = txWith(LockingScript.fromHex(DEPLOY_SCRIPT_HEX), 1)
const ID2 = `${deployTx2.id('hex')}_0`
const otherTx = txWith(LockingScript.fromASM('OP_TRUE'), 2)

const TUSD = { assetId: ID, sym: 'TUSD', label: 'Test Dollar', dec: 2, mandala: true }

type Out = { beef: number[], outputIndex: number, txid?: string }
const answer = (outputs: Out[]) => ({ type: 'output-list' as const, outputs })

const providerFor = (tx: Transaction, beef: number[] = tx.toBEEF(true)) => ({
  admission: vi.fn().mockResolvedValue(answer([{ beef, outputIndex: 0, txid: tx.id('hex') }])),
  spendability: vi.fn(),
  submit: vi.fn()
})

/** Answers each asset with its own deploy tx. */
const multiProvider = (...txs: Transaction[]) => ({
  admission: vi.fn(async (assetId: string) => {
    const tx = txs.find(t => `${t.id('hex')}_0` === assetId)
    return answer(tx === undefined ? [] : [{ beef: tx.toBEEF(true), outputIndex: 0, txid: tx.id('hex') }])
  }),
  spendability: vi.fn(),
  submit: vi.fn()
})

const throwing = () => ({
  admission: vi.fn().mockRejectedValue(new Error('overlay down')),
  spendability: vi.fn(),
  submit: vi.fn()
})

describe('createAssetDisplayResolver', () => {
  test('resolves a Mandala deploy from F-REQ', async () => {
    const good = providerFor(deployTx)
    const r = createAssetDisplayResolver({ providers: () => [good] })
    expect(await r.resolve([ID])).toEqual({ [ID]: TUSD })
    expect(good.admission).toHaveBeenCalledWith(ID, [`${TXID}.0`])
  })

  test('accepts an AtomicBEEF answer and an answer without the txid hint', async () => {
    const p = {
      admission: vi.fn().mockResolvedValue(answer([{ beef: deployTx.toAtomicBEEF(true), outputIndex: 0 }])),
      spendability: vi.fn(),
      submit: vi.fn()
    }
    const r = createAssetDisplayResolver({ providers: () => [p] })
    expect(await r.resolve([ID])).toEqual({ [ID]: TUSD })
  })

  test('falls through a failing provider and caches the result', async () => {
    const bad = throwing()
    const good = providerFor(deployTx)
    const r = createAssetDisplayResolver({ providers: () => [bad, good] })
    expect(await r.resolve([ID])).toEqual({ [ID]: TUSD })
    expect(await r.resolve([ID])).toEqual({ [ID]: TUSD })
    expect(bad.admission).toHaveBeenCalledTimes(1)
    expect(good.admission).toHaveBeenCalledTimes(1)
  })

  test('a timed-out provider is skipped and its late rejection is swallowed', async () => {
    let rejectLate: (e: Error) => void = () => {}
    const hanging = {
      admission: vi.fn(() => new Promise((_resolve, reject) => { rejectLate = reject })),
      spendability: vi.fn(),
      submit: vi.fn()
    }
    const r = createAssetDisplayResolver({ providers: () => [hanging], timeoutMs: 20 })
    expect(await r.resolve([ID])).toEqual({})
    rejectLate(new Error('late overlay failure'))
    await new Promise(resolve => setTimeout(resolve, 5))
  })

  test('a timed-out provider falls through to the next one', async () => {
    const hanging = { admission: vi.fn(() => new Promise(() => {})), spendability: vi.fn(), submit: vi.fn() }
    const good = providerFor(deployTx)
    const r = createAssetDisplayResolver({ providers: () => [hanging, good], timeoutMs: 20 })
    expect(await r.resolve([ID])).toEqual({ [ID]: TUSD })
  })

  test('an answer for a different transaction is ignored', async () => {
    const liar = {
      admission: vi.fn().mockResolvedValue(answer([{ beef: otherTx.toBEEF(true), outputIndex: 0, txid: TXID }])),
      spendability: vi.fn(),
      submit: vi.fn()
    }
    const r = createAssetDisplayResolver({ providers: () => [liar] })
    expect(await r.resolve([ID])).toEqual({})
  })

  test('an answer for another output index or another txid label is ignored', async () => {
    const beef = deployTx.toBEEF(true)
    const p = {
      admission: vi.fn().mockResolvedValue(answer([
        { beef, outputIndex: 1, txid: TXID },
        { beef, outputIndex: 0, txid: 'c'.repeat(64) }
      ])),
      spendability: vi.fn(),
      submit: vi.fn()
    }
    const r = createAssetDisplayResolver({ providers: () => [p] })
    expect(await r.resolve([ID])).toEqual({})
  })

  test('a non-deploy output is not a display source', async () => {
    const plain = providerFor(otherTx)
    const r = createAssetDisplayResolver({ providers: () => [plain] })
    expect(await r.resolve([`${otherTx.id('hex')}_0`])).toEqual({})
  })

  test('a non-zero vout is never confirmed by readDeploy (no display mislabelled as _0)', async () => {
    // Output 1 carries the deploy script, but readDeploy reads it as `<txid>_0`.
    const tx = txWith(LockingScript.fromASM('OP_TRUE'), 3)
    tx.addOutput({ lockingScript: LockingScript.fromHex(DEPLOY_SCRIPT_HEX), satoshis: 1 })
    const txid = tx.id('hex')
    const p = {
      admission: vi.fn().mockResolvedValue(answer([{ beef: tx.toBEEF(true), outputIndex: 1, txid }])),
      spendability: vi.fn(),
      submit: vi.fn()
    }
    const r = createAssetDisplayResolver({ providers: () => [p] })
    expect(await r.resolve([`${txid}_1`])).toEqual({})
    expect(p.admission).toHaveBeenCalledWith(`${txid}_1`, [`${txid}.1`])
  })

  test('malformed ids are never queried', async () => {
    const good = providerFor(deployTx)
    const r = createAssetDisplayResolver({ providers: () => [good] })
    expect(await r.resolve(['abc', 'A'.repeat(64) + '_0', `${TXID}_01`, `${TXID}.0`, 'ISSUE'])).toEqual({})
    expect(good.admission).not.toHaveBeenCalled()
  })

  test('nothing is cached for an unresolved asset', async () => {
    const bad = throwing()
    const r = createAssetDisplayResolver({ providers: () => [bad] })
    expect(await r.resolve([ID])).toEqual({})
    expect(await r.resolve([ID])).toEqual({})
    expect(bad.admission).toHaveBeenCalledTimes(2)
  })

  test('concurrent resolves of one asset share one lookup; duplicates are queried once', async () => {
    const good = providerFor(deployTx)
    const r = createAssetDisplayResolver({ providers: () => [good] })
    const [a, b] = await Promise.all([r.resolve([ID, ID]), r.resolve([ID])])
    expect(a).toEqual({ [ID]: TUSD })
    expect(b).toEqual({ [ID]: TUSD })
    expect(good.admission).toHaveBeenCalledTimes(1)
  })

  test('the cache is bounded by maxEntries, oldest first', async () => {
    const p = multiProvider(deployTx, deployTx2)
    const r = createAssetDisplayResolver({ providers: () => [p], maxEntries: 1 })
    expect(Object.keys(await r.resolve([ID]))).toEqual([ID])
    expect(Object.keys(await r.resolve([ID2]))).toEqual([ID2])
    expect(Object.keys(await r.resolve([ID]))).toEqual([ID])
    expect(p.admission).toHaveBeenCalledTimes(3)
  })

  test('providers() is read on every resolve', async () => {
    let list: any[] = []
    const r = createAssetDisplayResolver({ providers: () => list })
    expect(await r.resolve([ID])).toEqual({})
    list = [providerFor(deployTx)]
    expect(await r.resolve([ID])).toEqual({ [ID]: TUSD })
  })

  test('a throwing providers() resolves nothing instead of throwing', async () => {
    const r = createAssetDisplayResolver({ providers: () => { throw new Error('settings unavailable') } })
    expect(await r.resolve([ID])).toEqual({})
  })
})

describe('enrichConsentMessage', () => {
  const resolver = () => createAssetDisplayResolver({ providers: () => [providerFor(deployTx)] })

  test('enrich adds hostDisplay and keeps every module member', async () => {
    const msg = {
      type: 'color_send',
      assets: [{ assetId: ID, outgoingAmount: '1500' }],
      destinations: [{ outputIndex: 0, assetId: 'ISSUE' }],
      seekPermission: true
    }
    const out = JSON.parse(await enrichConsentMessage(JSON.stringify(msg), resolver()))
    expect({ ...out, hostDisplay: undefined }).toEqual({ ...msg, hostDisplay: undefined })
    expect(out.hostDisplay[ID].dec).toBe(2)
    expect(out.hostDisplay).toEqual({ [ID]: TUSD })
  })

  test('collects destination and top-level asset ids, never ISSUE', async () => {
    const p = multiProvider(deployTx, deployTx2)
    const r = createAssetDisplayResolver({ providers: () => [p] })
    const send = { type: 'color_send', assets: [], destinations: [{ outputIndex: 0, assetId: ID2 }, { outputIndex: 1, assetId: 'ISSUE' }] }
    expect(Object.keys(JSON.parse(await enrichConsentMessage(JSON.stringify(send), r)).hostDisplay)).toEqual([ID2])
    const offline = { type: 'color_receive_offline', assetId: ID, outputs: [{ outputIndex: 0, amount: '1' }] }
    expect(Object.keys(JSON.parse(await enrichConsentMessage(JSON.stringify(offline), r)).hostDisplay)).toEqual([ID])
    expect(p.admission.mock.calls.map(c => c[0])).toEqual([ID2, ID])
  })

  test('a module-supplied hostDisplay is replaced by the host resolution', async () => {
    const spoof = { type: 'color_access', assetId: ID, hostDisplay: { [ID]: { assetId: ID, dec: 18, sym: 'BTC', mandala: true } } }
    const out = JSON.parse(await enrichConsentMessage(JSON.stringify(spoof), resolver()))
    expect(out.hostDisplay).toEqual({ [ID]: TUSD })
  })

  test('an unresolved asset leaves an empty hostDisplay (base units)', async () => {
    const r = createAssetDisplayResolver({ providers: () => [throwing()] })
    const out = JSON.parse(await enrichConsentMessage(JSON.stringify({ type: 'color_access', assetId: ID }), r))
    expect(out).toEqual({ type: 'color_access', assetId: ID, hostDisplay: {} })
  })

  test('an unparseable or non-object message is returned unchanged', async () => {
    const r = { resolve: vi.fn() }
    for (const m of ['not json', '[1,2]', 'null', '42', '"text"']) {
      expect(await enrichConsentMessage(m, r)).toBe(m)
    }
    expect(r.resolve).not.toHaveBeenCalled()
  })

  test('a resolver failure returns the message unchanged', async () => {
    const msg = JSON.stringify({ type: 'color_access', assetId: ID })
    const r = { resolve: vi.fn().mockRejectedValue(new Error('boom')) }
    expect(await enrichConsentMessage(msg, r)).toBe(msg)
  })

  test('malformed members are tolerated', async () => {
    const msg = { type: 'color_send', assets: 'x', destinations: [null, 7, { assetId: 5 }], assetId: ['nope'] }
    const out = JSON.parse(await enrichConsentMessage(JSON.stringify(msg), resolver()))
    expect(out).toEqual({ ...msg, hostDisplay: {} })
  })
})
