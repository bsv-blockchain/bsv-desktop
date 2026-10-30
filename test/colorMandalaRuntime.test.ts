/**
 * Host Mandala runtime (design §9 B7): MessageBox receive of v4 hand-overs
 * with the host ledger, then `settleReceipts` → `markSettled`.
 *
 * Cases pinned here:
 * - wiring: receive gets the managed wallet, the MessageBox client, the host
 *   ledger, `markSettled` and one `processed` set for the runtime's life;
 *   settle gets the ledger, `markSettled` and the configured K;
 * - received hand-overs are reported settled (online) or pending (offline);
 * - fail closed: remote storage (or a failing check) skips both steps;
 * - robustness: no wallet or MessageBox yet skips receive only; a receive or
 *   settle failure is reported and never rejects the tick; overlapping ticks
 *   share one pass (double trigger: interval + online + held event);
 * - real lib: a pending ledger record is submitted, the overlay σ by K is
 *   verified, the record becomes `settled` and `markSettled(txid)` runs once;
 *   a transport failure keeps it pending without `markSettled`; a settled but
 *   unmarked record (crash between the two writes) is marked on the next pass;
 * - real lib receive: a body the lib refuses definitively (v3) is
 *   acknowledged and never internalized.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LockingScript, PrivateKey, ProtoWallet, Transaction, UnlockingScript, Utils } from '@bsv/sdk'
import {
  MESSAGEBOX,
  colorTopic,
  configureMandala,
  createHostLedger,
  memoryStorage,
  receiveHandovers,
  settleReceipts,
  signAttestation
} from '@bsv/mandala'
import { createMandalaHostRuntime } from '../src/lib/permissionModules/color/mandalaRuntime'
import { bindOriginator } from '../src/lib/permissionModules/color/bindOriginator'

const OVERLAY_KEY = new PrivateKey(42)
const K = OVERLAY_KEY.toPublicKey().toString()
const ASSET = `${'11'.repeat(32)}_0`

function setup (over: Partial<Parameters<typeof createMandalaHostRuntime>[0]> = {}) {
  const ledger = createHostLedger(memoryStorage())
  const markSettled = vi.fn(async (_txid: string) => {})
  const wallet = { internalizeAction: vi.fn() } as any
  const box = { listMessages: vi.fn(async () => []), acknowledgeMessage: vi.fn(async () => ({})) }
  const receive = vi.fn(async (_p: any) => ({ accepted: [] as any[], failed: [] as any[] }))
  const settle = vi.fn(async (_p: any) => [] as any[])
  const onError = vi.fn()
  const runtime = createMandalaHostRuntime({
    ledger,
    markSettled,
    wallet: () => wallet,
    messageBox: () => box,
    overlayIdentityKey: K,
    isActive: async () => true,
    receiveHandovers: receive as any,
    settleReceipts: settle as any,
    onError,
    ...over
  })
  return { runtime, ledger, markSettled, wallet, box, receive, settle, onError }
}

describe('createMandalaHostRuntime (injected lib)', () => {
  test('receive and settle get the host ledger, markSettled, wallet, MessageBox and K', async () => {
    const s = setup()
    s.receive.mockResolvedValueOnce({
      accepted: [
        { messageId: 'm1', txid: 'aa'.repeat(32), assetId: ASSET, amount: 5n, outputIndex: 0, offline: false },
        { messageId: 'm2', txid: 'bb'.repeat(32), assetId: ASSET, amount: 7n, outputIndex: 1, offline: true }
      ],
      failed: [{ messageId: 'm3', error: new Error('not covered'), code: 'ERR_NOT_COVERED' }]
    })
    s.settle.mockResolvedValueOnce([{ txid: 'bb'.repeat(32), assetId: ASSET, status: 'admitted' }])
    const r = await s.runtime.tick()
    const rp = s.receive.mock.calls[0][0]
    expect(rp).toMatchObject({ wallet: s.wallet, messageBoxClient: s.box, ledger: s.ledger, markSettled: s.markSettled })
    expect(rp.processed).toBeInstanceOf(Set)
    expect(s.settle).toHaveBeenCalledWith({ ledger: s.ledger, markSettled: s.markSettled, overlayIdentityKey: K })
    expect(r.received).toEqual([
      { txid: 'aa'.repeat(32), assetId: ASSET, offline: false },
      { txid: 'bb'.repeat(32), assetId: ASSET, offline: true }
    ])
    expect(r.failed).toEqual([{ messageId: 'm3', code: 'ERR_NOT_COVERED' }])
    expect(r.results).toEqual([{ txid: 'bb'.repeat(32), assetId: ASSET, status: 'admitted' }])
    expect(s.onError).toHaveBeenCalledWith('receive', expect.any(Error))

    // the same processed set on the next tick (a declined message is not re-run this session)
    await s.runtime.tick()
    expect(s.receive.mock.calls[1][0].processed).toBe(rp.processed)
  })

  test('remote storage or a failing check skips both steps', async () => {
    for (const isActive of [async () => false, async () => { throw new Error('x') }, async () => 'yes' as any]) {
      const s = setup({ isActive })
      expect(await s.runtime.tick()).toEqual({ results: [], received: [], failed: [] })
      expect(s.receive).not.toHaveBeenCalled()
      expect(s.settle).not.toHaveBeenCalled()
    }
  })

  test('no wallet or MessageBox yet: receive is skipped, settle still runs', async () => {
    for (const over of [{ wallet: () => undefined }, { messageBox: () => undefined }, { messageBox: () => { throw new Error('gone') } }]) {
      const s = setup(over as any)
      await s.runtime.tick()
      expect(s.receive).not.toHaveBeenCalled()
      expect(s.settle).toHaveBeenCalledTimes(1)
    }
  })

  test('a receive or settle failure is reported and never rejects the tick', async () => {
    const s = setup()
    s.receive.mockRejectedValueOnce(new Error('MessageBox down'))
    s.settle.mockRejectedValueOnce(new Error('OVERLAY_IDENTITY_KEY_UNSET'))
    await expect(s.runtime.tick()).resolves.toEqual({ results: [], received: [], failed: [] })
    expect(s.settle).toHaveBeenCalledTimes(1)
    expect(s.onError).toHaveBeenCalledWith('receive', expect.objectContaining({ message: 'MessageBox down' }))
    expect(s.onError).toHaveBeenCalledWith('settle', expect.objectContaining({ message: 'OVERLAY_IDENTITY_KEY_UNSET' }))
    // a throwing logger does not break it either
    s.onError.mockImplementation(() => { throw new Error('logger') })
    s.receive.mockRejectedValueOnce(new Error('again'))
    await expect(s.runtime.tick()).resolves.toBeDefined()
  })

  test('single flight: overlapping ticks share one pass; a later tick runs again', async () => {
    const s = setup()
    let release!: () => void
    s.receive.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ accepted: [], failed: [] }) }))
    const a = s.runtime.tick()
    const b = s.runtime.tick()
    expect(b).toBe(a)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await a
    expect(s.receive).toHaveBeenCalledTimes(1)
    expect(s.settle).toHaveBeenCalledTimes(1)
    await s.runtime.tick()
    expect(s.receive).toHaveBeenCalledTimes(2)
  })
})

describe('createMandalaHostRuntime (real @bsv/mandala)', () => {
  let tx: Transaction
  let txid: string

  beforeEach(() => {
    configureMandala({ storage: memoryStorage(), overlayUrl: 'https://overlay.test', overlayIdentityKey: K })
    const source = new Transaction()
    source.addOutput({ lockingScript: LockingScript.fromASM('OP_TRUE'), satoshis: 1000 })
    tx = new Transaction()
    tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    tx.addOutput({ lockingScript: LockingScript.fromASM('OP_TRUE'), satoshis: 1 })
    txid = tx.id('hex')
  })
  afterEach(() => {
    configureMandala({ storage: memoryStorage(), overlayUrl: '', overlayIdentityKey: '' })
    vi.unstubAllGlobals()
  })

  const pending = () => ({
    v: 1 as const,
    txid,
    assetId: ASSET,
    state: 'pending' as const,
    outputs: [0],
    submits: [{ txid, beefHex: Utils.toHex(tx.toAtomicBEEF()), offChainHex: '00' }],
    at: Date.now()
  })

  const realRuntime = (ledger = createHostLedger(memoryStorage())) => {
    const markSettled = vi.fn(async (_txid: string) => {})
    const runtime = createMandalaHostRuntime({
      ledger,
      markSettled,
      wallet: () => undefined,
      messageBox: () => undefined,
      overlayIdentityKey: K,
      isActive: async () => true,
      receiveHandovers,
      settleReceipts,
      onError: () => {}
    })
    return { runtime, ledger, markSettled }
  }

  test('a pending receipt the overlay admits with σ by K is settled, then markSettled runs once', async () => {
    const signature = await signAttestation(new ProtoWallet(OVERLAY_KEY), ASSET, txid, [0])
    const fetch = vi.fn(async (_url: string, _init: any) => new Response(JSON.stringify({
      [colorTopic(ASSET)]: { outputsToAdmit: [0], coinsToRetain: [], admissionSignature: signature, admissionIdentityKey: K }
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const { runtime, ledger, markSettled } = realRuntime()
    await ledger.put(pending())

    const r = await runtime.tick()
    expect(r.results).toEqual([{ txid, assetId: ASSET, status: 'admitted' }])
    expect(fetch.mock.calls[0][0]).toBe('https://overlay.test/submit')
    expect(markSettled).toHaveBeenCalledTimes(1)
    expect(markSettled).toHaveBeenCalledWith(txid)
    expect(await ledger.get(txid)).toMatchObject({ state: 'settled', marked: true })

    // nothing is due on the next pass
    await runtime.tick()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(markSettled).toHaveBeenCalledTimes(1)
  })

  test('an answer signed by another key is not admitted: no markSettled, still pending', async () => {
    const signature = await signAttestation(new ProtoWallet(new PrivateKey(43)), ASSET, txid, [0])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      [colorTopic(ASSET)]: { outputsToAdmit: [0], coinsToRetain: [], admissionSignature: signature, admissionIdentityKey: K }
    }), { status: 200 })))
    const { runtime, ledger, markSettled } = realRuntime()
    await ledger.put(pending())
    const r = await runtime.tick()
    expect(r.results[0]).toMatchObject({ txid, status: 'retry' })
    expect(markSettled).not.toHaveBeenCalled()
    expect((await ledger.get(txid))?.state).toBe('pending')
  })

  test('overlay unreachable: retry, still pending, no markSettled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const { runtime, ledger, markSettled } = realRuntime()
    await ledger.put(pending())
    const r = await runtime.tick()
    expect(r.results[0]).toMatchObject({ txid, status: 'retry' })
    expect(markSettled).not.toHaveBeenCalled()
    expect((await ledger.get(txid))?.state).toBe('pending')
  })

  test('a settled record whose markSettled never completed is marked on the next pass', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { runtime, ledger, markSettled } = realRuntime()
    await ledger.put({ v: 1, txid, assetId: ASSET, state: 'settled', outputs: [0], marked: false, at: Date.now() })
    await runtime.tick()
    expect(markSettled).toHaveBeenCalledWith(txid)
    expect(fetch).not.toHaveBeenCalled()
    expect((await ledger.get(txid))?.marked).toBe(true)
  })

  test('receive: a definitively refused body (v3) is acknowledged and never internalized', async () => {
    const ledger = createHostLedger(memoryStorage())
    const internalizeAction = vi.fn()
    const box = {
      listMessages: vi.fn(async () => [{ messageId: 'old', body: JSON.stringify({ v: 3, kind: 'handover' }) }]),
      acknowledgeMessage: vi.fn(async () => ({}))
    }
    vi.stubGlobal('fetch', vi.fn())
    const markSettled = vi.fn()
    const runtime = createMandalaHostRuntime({
      ledger,
      markSettled,
      wallet: () => bindOriginator({ internalizeAction } as any, 'admin'),
      messageBox: () => box,
      overlayIdentityKey: K,
      isActive: async () => true,
      onError: () => {}
    })
    const r = await runtime.tick()
    expect(box.listMessages).toHaveBeenCalledWith({ messageBox: MESSAGEBOX, acceptPayments: false })
    expect(box.acknowledgeMessage).toHaveBeenCalledWith({ messageIds: ['old'] })
    expect(internalizeAction).not.toHaveBeenCalled()
    expect(r.received).toEqual([])
    expect(r.failed.map(f => f.messageId)).toEqual(['old'])
    expect(await ledger.list()).toEqual([])
  })
})

describe('bindOriginator', () => {
  test('supplies the originator only when the caller names none', async () => {
    const w = { internalizeAction: vi.fn(async (_a: unknown, o?: string) => o), name: 'w' }
    const b = bindOriginator(w, 'admin')
    expect(await b.internalizeAction({})).toBe('admin')
    expect(await b.internalizeAction({}, 'app')).toBe('app')
    expect(b.name).toBe('w')
  })
})
