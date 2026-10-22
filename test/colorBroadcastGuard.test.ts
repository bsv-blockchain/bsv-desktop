/**
 * Broadcast guard for 1Color transactions (contract §8.2): no transaction with
 * a BRC-162 output, and no descendant of one this wallet holds, reaches ARC
 * before the renderer has released it after `module.isSettled(txid)`.
 *
 * Stability cases pinned here:
 * - crash after `markHeld` and before parking: the journal entry exists, the
 *   drain releases it normally;
 * - crash after the release write and before the post: `.held` stays, so the
 *   next release redoes the post;
 * - double submit: two concurrent releases post once; a receipt internalized
 *   twice is held twice without error (markHeld is idempotent);
 * - multi-window: releases are serialized per namespace in main;
 * - stale cache: none, every journal read goes to disk;
 * - retry: a withheld req is reported `serviceError` (never invalid);
 * - guard fault: a classifier or journal fault posts nothing.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Beef, LockingScript, P2PKH, Transaction, UnlockingScript } from '@bsv/sdk'
import { OneColor } from '@bsv/templates'
import {
  ColorGuardJournal,
  guardPostBeef,
  installColorBroadcastGuard,
  loadColorClassifier,
  registerColorGuardIpc,
  txHasColorOutput
} from '../electron/colorBroadcastGuard.js'

const A = '02' + 'aa'.repeat(32)
const ID = 'ab'.repeat(32) + '_0'
const PKH = Array.from({ length: 20 }, (_, i) => i + 1)

let root: string
let journal: ColorGuardJournal
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-desktop-color-guard-'))
  journal = new ColorGuardJournal({ root })
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

let nonce = 0
function mkTx (inputs: Array<{ txid: string, vout: number }>, outputs: LockingScript[]): Transaction {
  const tx = new Transaction()
  for (const i of inputs) {
    tx.addInput({ sourceTXID: i.txid, sourceOutputIndex: i.vout, unlockingScript: new UnlockingScript(), sequence: 0xffffffff })
  }
  for (const o of outputs) tx.addOutput({ lockingScript: o, satoshis: 1 })
  tx.lockTime = ++nonce
  return tx
}
const colorLock = (): LockingScript => new OneColor().lock(ID, 1500n, PKH)
const plainLock = (): LockingScript => new P2PKH().lock(PKH)
const fundingTxid = (): string => (++nonce).toString(16).padStart(64, '0')

// T: token tx (output 0 = 1Color, output 1 = BSV change). P: plain. C spends T:1.
function scenario () {
  const T = mkTx([{ txid: fundingTxid(), vout: 0 }], [colorLock(), plainLock()])
  const P = mkTx([{ txid: fundingTxid(), vout: 0 }], [plainLock()])
  const C = mkTx([{ txid: T.id('hex'), vout: 1 }], [plainLock()])
  return { T, P, C, t: T.id('hex'), p: P.id('hex'), c: C.id('hex') }
}

let nextTransactionId = 1
function mkReq (tx: Transaction, status = 'unsent', parents: Transaction[] = []) {
  const inputBeef = new Beef()
  for (const parent of parents) inputBeef.mergeTransaction(parent)
  const req: any = {
    txid: tx.id('hex'),
    rawTx: tx.toBinary(),
    status,
    attempts: 0,
    notify: { transactionIds: [nextTransactionId++] },
    inputBEEF: inputBeef.toBinary(),
    history: [] as any[],
    addHistoryNote: vi.fn((n: any) => { req.history.push(n) }),
    updateStorageDynamicProperties: vi.fn(async () => {})
  }
  return req
}

/** The network: records every BEEF and txid list it is handed. */
function mkArc () {
  const calls: Array<{ txids: string[], beefTxids: string[] }> = []
  const postBeef = vi.fn(async (beef: Beef, txids: string[]) => {
    calls.push({ txids: [...txids], beefTxids: beef.txs.map(t => t.txid) })
    return [{ name: 'FakeArc', status: 'success' as const, txidResults: txids.map(txid => ({ txid, status: 'success' as const })) }]
  })
  return { postBeef, calls, sawTxid: (txid: string) => calls.some(c => c.beefTxids.includes(txid) || c.txids.includes(txid)) }
}

/**
 * A StorageKnex stand-in. Its original `attemptToPostReqsToNetwork` does what the
 * toolbox does: merge every req's BEEF, post it through `getServices().postBeef`,
 * and report each txid's aggregate.
 */
function mkStorage (o: { txStatus?: Record<string, string>, reqRows?: any[], arc?: ReturnType<typeof mkArc> } = {}) {
  const arc = o.arc ?? mkArc()
  const services: any = { postBeef: arc.postBeef }
  const statusByTransactionId = new Map<number, string>()
  const storage: any = {
    services,
    arc,
    reqRows: o.reqRows ?? [],
    setTxStatus (req: any, status: string) { statusByTransactionId.set(req.notify.transactionIds[0], status) },
    getServices: () => services,
    findTransactions: vi.fn(async ({ partial }: any) => {
      const status = statusByTransactionId.get(partial.transactionId)
      return status === undefined ? [] : [{ transactionId: partial.transactionId, status }]
    }),
    findProvenTxReqs: vi.fn(async ({ partial }: any) => storage.reqRows.filter((r: any) => r.txid === partial.txid))
  }
  const original = vi.fn(async (reqs: any[], _trx?: unknown, _logger?: unknown) => {
    const beef = new Beef()
    const invalid: any[] = []
    const valid: any[] = []
    for (const req of reqs) {
      try {
        beef.mergeBeef(req.inputBEEF)
        beef.mergeRawTx(req.rawTx)
        valid.push(req)
      } catch {
        invalid.push({ txid: req.txid, req, status: 'invalid' })
      }
    }
    if (valid.length === 0) return { status: 'success', details: invalid, log: '' }
    const rs = await storage.getServices().postBeef(beef, valid.map(r => r.txid))
    const details = valid.map(req => {
      const results = rs.flatMap((r: any) => r.txidResults.filter((t: any) => t.txid === req.txid))
      const status = results.some((t: any) => t.status === 'success') ? 'success' : 'serviceError'
      if (status === 'success') req.status = 'unmined'
      else req.status = 'sending'
      return { txid: req.txid, req, status }
    })
    return { status: 'success', details: [...details, ...invalid], log: '' }
  })
  storage.attemptToPostReqsToNetwork = original
  storage.original = original
  return storage
}

const notifyHeld = vi.fn()
async function guarded (storage: any) {
  notifyHeld.mockReset()
  const classify = () => loadColorClassifier()
  guardPostBeef(storage.services, { identityKey: A, chain: 'test', journal, classify, storage })
  installColorBroadcastGuard(storage, { identityKey: A, chain: 'test', journal, classify, notifyHeld })
  return storage
}

describe('classifier', () => {
  test('a 1Color output with any remainder is BRC-162; a plain output is not', async () => {
    const classify = await loadColorClassifier()
    expect(classify(colorLock())).toBe(true)
    // 0162:102-104: any remainder, not only P2PKH (CG-DESK-CLS)
    const multisigLike = new LockingScript([{ op: 0x51 }, { op: 0x51 }, { op: 0xae }])
    expect(classify(OneColor.lockRemainder(ID, 7n, multisigLike))).toBe(true)
    expect(classify(plainLock())).toBe(false)
    expect(classify(colorLock().toHex())).toBe(true)
    const { T, P } = scenario()
    expect(txHasColorOutput(T, classify)).toBe(true)
    expect(txHasColorOutput(P, classify)).toBe(false)
  })
})

describe('storage layer (main)', () => {
  test('holds an offline 1Color receipt and reports success', async () => {
    const storage = await guarded(mkStorage())
    const { T, t } = scenario()
    const reqT = mkReq(T)
    storage.setTxStatus(reqT, 'unproven')
    const r = await storage.attemptToPostReqsToNetwork([reqT])
    expect(r.details).toEqual([{ txid: t, req: reqT, status: 'success' }])
    expect(storage.original).not.toHaveBeenCalled()
    expect(storage.arc.postBeef).not.toHaveBeenCalled()
    expect(reqT.status).toBe('nosend')
    expect(reqT.history).toEqual([expect.objectContaining({ what: 'colorGuardHold' })])
    expect(reqT.updateStorageDynamicProperties).toHaveBeenCalled()
    expect(await journal.held(A, 'test')).toEqual([t])
    expect(notifyHeld).toHaveBeenCalledWith(t)
  })

  test('the same receipt held twice is idempotent', async () => {
    const storage = await guarded(mkStorage())
    const { T, t } = scenario()
    const reqT = mkReq(T)
    storage.setTxStatus(reqT, 'unproven')
    await storage.attemptToPostReqsToNetwork([reqT])
    reqT.status = 'nosend'
    const r = await storage.attemptToPostReqsToNetwork([reqT])
    expect(r.details[0].status).toBe('success')
    expect(await journal.held(A, 'test')).toEqual([t])
    expect(storage.arc.postBeef).not.toHaveBeenCalled()
  })

  test('plain BSV passes through with the original arguments', async () => {
    const storage = await guarded(mkStorage())
    const { P, p } = scenario()
    const reqP = mkReq(P)
    storage.setTxStatus(reqP, 'unprocessed')
    const trx = { trx: true }
    const logger = { log: () => {} }
    const r = await storage.attemptToPostReqsToNetwork([reqP], trx, logger)
    expect(storage.original).toHaveBeenCalledWith([reqP], trx, logger)
    expect(r.details).toEqual([{ txid: p, req: reqP, status: 'success' }])
    expect(storage.arc.calls).toEqual([{ txids: [p], beefTxids: [p] }])
    expect(await journal.held(A, 'test')).toEqual([])
    expect(notifyHeld).not.toHaveBeenCalled()
  })

  test('a mixed batch splits: token parked, plain posted, details merged', async () => {
    const storage = await guarded(mkStorage())
    const { T, P, t, p } = scenario()
    const reqT = mkReq(T)
    const reqP = mkReq(P)
    storage.setTxStatus(reqT, 'unproven')
    storage.setTxStatus(reqP, 'unproven')
    const r = await storage.attemptToPostReqsToNetwork([reqT, reqP])
    expect(storage.original).toHaveBeenCalledTimes(1)
    expect(storage.original.mock.calls[0][0]).toEqual([reqP])
    expect(r.details).toHaveLength(2)
    expect(r.details).toEqual(expect.arrayContaining([
      { txid: t, req: reqT, status: 'success' },
      { txid: p, req: reqP, status: 'success' }
    ]))
    expect(storage.arc.sawTxid(t)).toBe(false)
    expect(storage.arc.sawTxid(p)).toBe(true)
    expect(reqT.status).toBe('nosend')
    expect(await journal.held(A, 'test')).toEqual([t])
  })

  test('an unparseable rawTx is held', async () => {
    const storage = await guarded(mkStorage())
    const { P } = scenario()
    const bad = mkReq(P)
    bad.rawTx = [1, 2, 3]
    storage.setTxStatus(bad, 'unproven')
    const r = await storage.attemptToPostReqsToNetwork([bad])
    expect(storage.arc.postBeef).not.toHaveBeenCalled()
    expect(r.details[0].status).not.toBe('success')
  })

  test('a child of a held tx is held; a child of a released tx is not', async () => {
    const storage = await guarded(mkStorage())
    const { T, C, t, c } = scenario()
    const reqT = mkReq(T)
    storage.setTxStatus(reqT, 'unproven')
    await storage.attemptToPostReqsToNetwork([reqT])

    const reqC = mkReq(C, 'unsent', [T])
    storage.setTxStatus(reqC, 'unprocessed')
    const r1 = await storage.attemptToPostReqsToNetwork([reqC])
    expect(r1.details).toEqual([{ txid: c, req: reqC, status: 'serviceError' }])
    expect(storage.arc.postBeef).not.toHaveBeenCalled()

    await journal.markReleased(A, 'test', t)
    const reqC2 = mkReq(C, 'unsent', [T])
    storage.setTxStatus(reqC2, 'unprocessed')
    const r2 = await storage.attemptToPostReqsToNetwork([reqC2])
    expect(r2.details[0].status).toBe('success')
    expect(storage.arc.sawTxid(c)).toBe(true)
  })

  test("a child spending an own nosend hand-over's change is held", async () => {
    const { T: H, C, t: h, c } = scenario()
    // H is parked by the toolbox (plain noSend), so it has no .held file.
    const storage = await guarded(mkStorage({ reqRows: [{ txid: h, status: 'nosend', rawTx: H.toBinary() }] }))
    const reqC = mkReq(C, 'unsent', [H])
    storage.setTxStatus(reqC, 'unprocessed')
    const r = await storage.attemptToPostReqsToNetwork([reqC])
    expect(r.details).toEqual([{ txid: c, req: reqC, status: 'serviceError' }])
    expect(storage.arc.postBeef).not.toHaveBeenCalled()
    expect(storage.arc.sawTxid(h)).toBe(false)
  })

  test('a foreign proof-less ancestor in a receipt BEEF does not hold the receipt once released', async () => {
    const storage = await guarded(mkStorage())
    // F is the sender's own unmined 1Color tx; the receipt R spends it.
    const F = mkTx([{ txid: fundingTxid(), vout: 0 }], [colorLock(), plainLock()])
    const R = mkTx([{ txid: F.id('hex'), vout: 0 }], [colorLock()])
    const r = R.id('hex')
    await journal.markHeld(A, 'test', r)
    await journal.markReleased(A, 'test', r)
    const reqR = mkReq(R, 'unsent', [F])
    storage.setTxStatus(reqR, 'unproven')
    const out = await storage.attemptToPostReqsToNetwork([reqR])
    expect(out.details[0].status).toBe('success')
    expect(storage.arc.calls[0].txids).toEqual([r])
    expect(storage.arc.calls[0].beefTxids).toEqual(expect.arrayContaining([F.id('hex'), r]))
  })

  test('a journal read fault holds the whole batch and posts nothing', async () => {
    const storage = await guarded(mkStorage())
    const { T, P } = scenario()
    const reqT = mkReq(T)
    const reqP = mkReq(P)
    storage.setTxStatus(reqT, 'unproven')
    storage.setTxStatus(reqP, 'unproven')
    vi.spyOn(journal, 'isReleased').mockRejectedValue(Object.assign(new Error('EIO'), { code: 'EIO' }))
    vi.spyOn(journal, 'held').mockRejectedValue(Object.assign(new Error('EIO'), { code: 'EIO' }))
    await expect(storage.attemptToPostReqsToNetwork([reqT, reqP])).rejects.toThrow(/\[ColorBroadcastGuardError\]/)
    expect(storage.arc.postBeef).not.toHaveBeenCalled()
    expect(reqT.status).toBe('unsent')
    expect(reqP.status).toBe('unsent')
  })

  test('a non-hold-safe token req is not parked but withheld by postBeef as serviceError', async () => {
    const storage = await guarded(mkStorage())
    const { T, t } = scenario()
    const reqT = mkReq(T)
    storage.setTxStatus(reqT, 'unprocessed')
    const r = await storage.attemptToPostReqsToNetwork([reqT])
    expect(storage.original).toHaveBeenCalledTimes(1)
    expect(r.details).toEqual([{ txid: t, req: reqT, status: 'serviceError' }])
    expect(storage.arc.postBeef).not.toHaveBeenCalled()
    expect(reqT.status).toBe('sending')
    expect(await journal.held(A, 'test')).toEqual([t])
  })

  test('refuses to post through unguarded services', async () => {
    const storage = mkStorage()
    installColorBroadcastGuard(storage, { identityKey: A, chain: 'test', journal, classify: () => loadColorClassifier() })
    const { P } = scenario()
    const reqP = mkReq(P)
    storage.setTxStatus(reqP, 'unproven')
    await expect(storage.attemptToPostReqsToNetwork([reqP])).rejects.toThrow(/\[ColorBroadcastGuardError\]/)
    expect(storage.arc.postBeef).not.toHaveBeenCalled()
  })

  test('after release the same req posts', async () => {
    const storage = await guarded(mkStorage())
    const { T, t } = scenario()
    const reqT = mkReq(T)
    storage.setTxStatus(reqT, 'unproven')
    await journal.markReleased(A, 'test', t)
    const r = await storage.attemptToPostReqsToNetwork([reqT])
    expect(storage.original).toHaveBeenCalledWith([reqT], undefined, undefined)
    expect(r.details[0].status).toBe('success')
    expect(storage.arc.sawTxid(t)).toBe(true)
  })

  test('classifier load failure holds every tx', async () => {
    const storage = mkStorage()
    const classify = () => Promise.reject(new Error('ERR_REQUIRE_ESM'))
    guardPostBeef(storage.services, { identityKey: A, chain: 'test', journal, classify, storage })
    installColorBroadcastGuard(storage, { identityKey: A, chain: 'test', journal, classify })
    const { P } = scenario()
    const reqP = mkReq(P)
    storage.setTxStatus(reqP, 'unproven')
    await expect(storage.attemptToPostReqsToNetwork([reqP])).rejects.toThrow(/\[ColorBroadcastGuardError\]/)
    expect(storage.arc.postBeef).not.toHaveBeenCalled()
  })
})

describe('services layer (worker)', () => {
  test('the worker postBeef wrapper withholds an unreleased token tx', async () => {
    const arc = mkArc()
    const services: any = { postBeef: arc.postBeef }
    const workerNotify = vi.fn()
    guardPostBeef(services, { identityKey: A, chain: 'test', journal, classify: () => loadColorClassifier(), notifyHeld: workerNotify })
    const { T, P, t, p } = scenario()
    const beef = new Beef()
    beef.mergeTransaction(T)
    beef.mergeTransaction(P)
    const rs = await services.postBeef(beef, [t, p])
    expect(arc.calls).toEqual([{ txids: [p], beefTxids: [p] }])
    const forT = rs.flatMap((r: any) => r.txidResults.filter((x: any) => x.txid === t))
    expect(forT.length).toBeGreaterThan(0)
    expect(forT.every((x: any) => x.status === 'error' && x.serviceError === true)).toBe(true)
    expect(await journal.held(A, 'test')).toEqual([t])
    expect(workerNotify).toHaveBeenCalledWith(t)
    // the caller's BEEF is left as it was
    expect(beef.findTxid(t)).toBeDefined()
  })

  test('withholds a grandchild of a held tx and strips the whole held chain', async () => {
    const arc = mkArc()
    const services: any = { postBeef: arc.postBeef }
    guardPostBeef(services, { identityKey: A, chain: 'test', journal, classify: () => loadColorClassifier() })
    const { T, C, t } = scenario()
    await journal.markHeld(A, 'test', t)
    const G = mkTx([{ txid: C.id('hex'), vout: 0 }], [plainLock()])
    const beef = new Beef()
    beef.mergeTransaction(T)
    beef.mergeTransaction(C)
    beef.mergeTransaction(G)
    const rs = await services.postBeef(beef, [G.id('hex')])
    expect(arc.postBeef).not.toHaveBeenCalled()
    expect(rs).toEqual([expect.objectContaining({ name: 'ColorBroadcastGuard', status: 'error' })])
    expect(rs[0].txidResults).toEqual([{ txid: G.id('hex'), status: 'error', serviceError: true }])
  })

  test('nothing held: the inner call gets the caller arguments unchanged', async () => {
    const arc = mkArc()
    const services: any = { postBeef: arc.postBeef }
    guardPostBeef(services, { identityKey: A, chain: 'test', journal, classify: () => loadColorClassifier() })
    const { P, p } = scenario()
    const beef = new Beef()
    beef.mergeTransaction(P)
    const logger = { log: () => {} }
    await services.postBeef(beef, [p], logger)
    expect(arc.postBeef).toHaveBeenCalledWith(beef, [p], logger)
  })

  test('a journal fault withholds every txid without calling the network', async () => {
    const arc = mkArc()
    const services: any = { postBeef: arc.postBeef }
    guardPostBeef(services, { identityKey: A, chain: 'test', journal, classify: () => loadColorClassifier() })
    vi.spyOn(journal, 'held').mockRejectedValue(new Error('EIO'))
    const { P, p } = scenario()
    const beef = new Beef()
    beef.mergeTransaction(P)
    const rs = await services.postBeef(beef, [p])
    expect(arc.postBeef).not.toHaveBeenCalled()
    expect(rs[0].txidResults).toEqual([{ txid: p, status: 'error', serviceError: true }])
  })
})

describe('release IPC', () => {
  function setup (storage: any) {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, fn) } }
    registerColorGuardIpc(ipcMain, {
      journal,
      withStorage: async (_id: string, _chain: string, fn: (s: any) => Promise<any>) => await fn(storage),
      toReq: (row: any) => row
    })
    return {
      handlers,
      held: async () => await handlers.get('color-guard:list')!({}, A, 'test') as string[],
      release: async (txid: string) => await handlers.get('color-guard:release')!({}, A, 'test', txid)
    }
  }

  async function parkedReceipt () {
    const storage = await guarded(mkStorage())
    const { T, t } = scenario()
    const reqT = mkReq(T)
    storage.setTxStatus(reqT, 'unproven')
    await storage.attemptToPostReqsToNetwork([reqT])
    storage.reqRows.push(reqT)
    return { storage, reqT, t }
  }

  test('lists held txids and releases a parked receipt', async () => {
    const { storage, reqT, t } = await parkedReceipt()
    const ipc = setup(storage)
    expect(await ipc.held()).toEqual([t])
    await ipc.release(t)
    expect(storage.arc.calls.filter(c => c.txids.includes(t))).toHaveLength(1)
    expect(reqT.status).toBe('unmined')
    expect(reqT.history.map((n: any) => n.what)).toContain('colorGuardRelease')
    expect(await ipc.held()).toEqual([])
    expect(await journal.isReleased(A, 'test', t)).toBe(true)
  })

  test('a crash after the release write re-posts on the next release', async () => {
    const { storage, reqT, t } = await parkedReceipt()
    const ipc = setup(storage)
    const guardedPost = storage.attemptToPostReqsToNetwork
    storage.attemptToPostReqsToNetwork = vi.fn()
      .mockRejectedValueOnce(new Error('process died'))
      .mockImplementation(guardedPost)
    await expect(ipc.release(t)).rejects.toThrow('process died')
    expect(await journal.isReleased(A, 'test', t)).toBe(true)
    expect(await journal.held(A, 'test')).toEqual([t])
    expect(storage.arc.sawTxid(t)).toBe(false)

    await ipc.release(t)
    expect(storage.arc.calls.filter(c => c.txids.includes(t))).toHaveLength(1)
    expect(reqT.status).toBe('unmined')
    expect(await journal.held(A, 'test')).toEqual([])

    await ipc.release(t)
    expect(storage.attemptToPostReqsToNetwork).toHaveBeenCalledTimes(2)
  })

  test('a crash after markHeld and before parking is released normally', async () => {
    const storage = await guarded(mkStorage())
    const { T, t } = scenario()
    const reqT = mkReq(T, 'unsent')
    storage.reqRows.push(reqT)
    await journal.markHeld(A, 'test', t)
    const ipc = setup(storage)
    await ipc.release(t)
    expect(storage.arc.calls.filter(c => c.txids.includes(t))).toHaveLength(1)
    expect(await ipc.held()).toEqual([])
  })

  test('two concurrent releases of one txid post once', async () => {
    const { storage, t } = await parkedReceipt()
    const ipc = setup(storage)
    await Promise.all([ipc.release(t), ipc.release(t)])
    expect(storage.arc.calls.filter(c => c.txids.includes(t))).toHaveLength(1)
    expect(await ipc.held()).toEqual([])
  })

  test('IPC validates identity, chain and txid', async () => {
    const { storage } = await parkedReceipt()
    const ipc = setup(storage)
    const release = ipc.handlers.get('color-guard:release')!
    const list = ipc.handlers.get('color-guard:list')!
    await expect(Promise.resolve(release({}, A, 'test', 'zz'))).rejects.toThrow('Invalid color guard txid')
    await expect(Promise.resolve(release({}, A, 'test', 'AB'.repeat(32)))).rejects.toThrow('Invalid color guard txid')
    await expect(Promise.resolve(release({}, 'nope', 'test', 'ab'.repeat(32)))).rejects.toThrow('Invalid color guard identity')
    await expect(Promise.resolve(release({}, A, 'regtest', 'ab'.repeat(32)))).rejects.toThrow('Invalid color guard chain')
    await expect(Promise.resolve(list({}, A, '../x'))).rejects.toThrow('Invalid color guard chain')
  })
})
