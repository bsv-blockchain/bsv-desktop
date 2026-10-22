/**
 * The 1Color broadcast guard over a real StorageKnex and toolbox Wallet
 * (contract §8.2): an offline 1Color receipt internalized with the overlay
 * down and ARC up is credited, but ARC never sees it until the module reports
 * it settled and the renderer drain releases it.
 *
 * Runs under Electron's Node only (better-sqlite3 is built for Electron's ABI):
 * ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run \
 *   --config vitest.config.electron.ts test/colorBroadcastGuard.integration.test.ts
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import knex from 'knex'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Beef, CachedKeyDeriver, MerklePath, P2PKH, PrivateKey, Transaction, UnlockingScript } from '@bsv/sdk'
import { OneColor } from '@bsv/templates'
import {
  ColorGuardJournal,
  guardPostBeef,
  installColorBroadcastGuard,
  loadColorClassifier,
  releaseColorTx,
  sweepColorGuard
} from '../electron/colorBroadcastGuard'
import { createColorReleaseDrain } from '../src/lib/permissionModules/color/releaseDrain'

async function canUseBetterSqlite3 (): Promise<boolean> {
  try {
    const probe = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    await probe.raw('SELECT 1')
    await probe.destroy()
    return true
  } catch {
    return false
  }
}

const sqliteAvailable = await canUseBetterSqlite3()

describe.skipIf(!sqliteAvailable)('1Color broadcast guard over a real wallet', () => {
  let dir: string
  let db: any
  let storage: any
  let wallet: any
  let identityKey: string
  let journal: ColorGuardJournal
  let arc: { posts: Array<{ txids: string[], beefTxids: string[] }>, postBeef: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    const { StorageKnex, KnexMigrations, Wallet, WalletStorageManager } = await import('@bsv/wallet-toolbox') as any
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-desktop-color-guard-it-'))
    journal = new ColorGuardJournal({ root: path.join(dir, 'color-guard') })
    const rootKey = PrivateKey.fromRandom()
    const keyDeriver = new CachedKeyDeriver(rootKey)
    identityKey = keyDeriver.identityKey
    db = knex({ client: 'better-sqlite3', connection: { filename: path.join(dir, 'wallet.db') }, useNullAsDefault: true })
    await db.migrate.latest({ migrationSource: new KnexMigrations('test', 'color guard test', identityKey, 10000) })
    storage = new StorageKnex({ knex: db, chain: 'test', feeModel: { model: 'sat/kb', value: 100 }, commissionSatoshis: 0 })
    await storage.makeAvailable()

    // Fake ARC: "already known" counts as success, as the toolbox's providers report it.
    arc = {
      posts: [],
      postBeef: vi.fn(async (beef: Beef, txids: string[]) => {
        arc.posts.push({ txids: [...txids], beefTxids: beef.txs.map(t => t.txid) })
        return [{ name: 'FakeArc', status: 'success', txidResults: txids.map(txid => ({ txid, status: 'success', alreadyKnown: true })) }]
      })
    }
    const services: any = {
      chain: 'test',
      postBeef: arc.postBeef,
      getChainTracker: async () => ({ isValidRootForHeight: async () => true, currentHeight: async () => 1000 }),
      getHeight: async () => 1000,
      hashOutputScript: (s: string) => s,
      getStatusForTxids: async (txids: string[]) => ({ status: 'success', results: txids.map(txid => ({ txid, status: 'unknown' })) })
    }
    const o = { identityKey, chain: 'test', journal, classify: loadColorClassifier }
    guardPostBeef(services, { ...o, storage })
    installColorBroadcastGuard(storage, o)
    storage.setServices(services)
    const manager = new WalletStorageManager(identityKey, storage)
    await manager.makeAvailable()
    wallet = new Wallet({ chain: 'test', keyDeriver, storage: manager, services })
  })

  afterEach(async () => {
    await db?.destroy()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  /** A mined funding tx S and a proof-less T spending it, as an AtomicBEEF of T. */
  function receipt (outputs: Array<ReturnType<typeof P2PKH.prototype.lock>>) {
    const S = new Transaction()
    S.addInput({ sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, unlockingScript: new UnlockingScript(), sequence: 0xffffffff })
    S.addOutput({ lockingScript: new P2PKH().lock(new Array(20).fill(9)), satoshis: 1000 })
    S.merklePath = new MerklePath(900, [[{ offset: 0, hash: S.id('hex'), txid: true }]])
    const T = new Transaction()
    T.addInput({ sourceTransaction: S, sourceOutputIndex: 0, unlockingScript: new UnlockingScript(), sequence: 0xffffffff })
    for (const lockingScript of outputs) T.addOutput({ lockingScript, satoshis: 1 })
    const beef = new Beef()
    beef.mergeTransaction(T)
    return { T, t: T.id('hex'), atomic: beef.toBinaryAtomic(T.id('hex')) }
  }

  const reqOf = async (txid: string) => (await storage.findProvenTxReqs({ partial: { txid } }))[0]

  test('fake ARC never sees the receipt before release', async () => {
    const pkh = new Array(20).fill(4)
    const { t, atomic } = receipt([new OneColor().lock(`${'ab'.repeat(32)}_0`, 1500n, pkh)])

    const r = await wallet.internalizeAction({
      tx: atomic,
      outputs: [{ outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: 'p color abcd' } }],
      description: 'offline 1Color receipt'
    })
    expect(r.accepted).toBe(true)
    const listed = await wallet.listOutputs({ basket: 'p color abcd' })
    expect(listed.outputs.map((o: any) => o.outpoint)).toEqual([`${t}.0`])
    expect(arc.posts.some(p => p.txids.includes(t) || p.beefTxids.includes(t))).toBe(false)
    expect((await reqOf(t)).status).toBe('nosend')
    expect(await journal.held(identityKey, 'test')).toEqual([t])

    // The same receipt again: held again, no broadcast, no error.
    await wallet.internalizeAction({
      tx: atomic,
      outputs: [{ outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: 'p color abcd' } }],
      description: 'offline 1Color receipt'
    }).catch(() => undefined)
    expect(arc.posts.some(p => p.txids.includes(t) || p.beefTxids.includes(t))).toBe(false)

    // Not settled yet: the drain releases nothing.
    const api = {
      held: (id: string, chain: any) => journal.held(id, chain),
      release: (id: string, chain: any, txid: string) =>
        releaseColorTx({ journal, withStorage: async (_i, _c, fn) => await fn(storage) }, id, chain, txid)
    }
    let settled = false
    const drain = createColorReleaseDrain({ isSettled: async () => settled, api, identityKey, chain: 'test' })
    expect(await drain.drain()).toEqual({ released: [] })
    expect(arc.posts.some(p => p.txids.includes(t))).toBe(false)

    settled = true
    expect(await drain.drain()).toEqual({ released: [t] })
    expect(arc.posts.filter(p => p.txids.includes(t))).toHaveLength(1)
    expect((await reqOf(t)).status).toBe('unmined')
    expect(await journal.held(identityKey, 'test')).toEqual([])

    // A second drain does nothing.
    expect(await drain.drain()).toEqual({ released: [] })
    expect(arc.posts.filter(p => p.txids.includes(t))).toHaveLength(1)
  })

  test('a withheld req is re-parked by the sweep, and a held receipt child is credited and parked until the receipt is released', async () => {
    const pkh = new Array(20).fill(4)
    const { T, t, atomic } = receipt([new OneColor().lock(`${'ab'.repeat(32)}_0`, 1500n, pkh), new P2PKH().lock(pkh)])
    await wallet.internalizeAction({
      tx: atomic,
      outputs: [{ outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: 'p color abcd' } }],
      description: 'offline 1Color receipt'
    })
    const ipc = { journal, withStorage: async (_i: string, _c: string, fn: (s: any) => Promise<any>) => await fn(storage) } as any

    // What a withheld TaskSendWaiting post leaves behind: req and tx row 'sending', attempts raised.
    const rowT = await reqOf(t)
    await storage.updateProvenTxReq(rowT.provenTxReqId, { status: 'sending', attempts: 99 })
    const txIdsT = JSON.parse(rowT.notify).transactionIds
    await storage.updateTransaction(txIdsT, { status: 'sending' })
    expect(await sweepColorGuard(ipc, identityKey, 'test')).toEqual({ parked: [t], unparked: [] })
    const parkedT = await reqOf(t)
    expect(parkedT.status).toBe('nosend')
    expect(JSON.parse(parkedT.history).notes.map((n: any) => n.what)).toContain('colorGuardHold')
    // idempotent
    expect(await sweepColorGuard(ipc, identityKey, 'test')).toEqual({ parked: [], unparked: [] })

    // A plain receipt C spending T:1 (its parent is held) is credited and parked
    // as a child: no journal entry, nothing posted.
    const C = new Transaction()
    C.addInput({ sourceTransaction: T, sourceOutputIndex: 1, unlockingScript: new UnlockingScript(), sequence: 0xffffffff })
    C.addOutput({ lockingScript: new P2PKH().lock(new Array(20).fill(6)), satoshis: 1 })
    const c = C.id('hex')
    const beefC = new Beef()
    beefC.mergeTransaction(C)
    const rc = await wallet.internalizeAction({
      tx: beefC.toBinaryAtomic(c),
      outputs: [{ outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: 'plain' } }],
      description: 'child of a held receipt'
    })
    expect(rc.accepted).toBe(true)
    const listedC = await wallet.listOutputs({ basket: 'plain' })
    expect(listedC.outputs.map((o: any) => o.outpoint)).toEqual([`${c}.0`])
    expect(arc.posts.some(p => p.txids.includes(c) || p.beefTxids.includes(c))).toBe(false)
    const rowC = await reqOf(c)
    expect(rowC.status).toBe('nosend')
    expect(JSON.parse(rowC.history).notes.map((n: any) => n.what)).toContain('colorGuardHoldChild')
    expect(await sweepColorGuard(ipc, identityKey, 'test')).toEqual({ parked: [], unparked: [] })
    expect((await reqOf(c)).status).toBe('nosend')
    expect(await journal.held(identityKey, 'test')).toEqual([t])

    // What a worker race leaves behind (a withheld post writes 'sending' back): the sweep re-parks C.
    await storage.updateProvenTxReq(rowC.provenTxReqId, { status: 'sending', attempts: 50 })
    expect(await sweepColorGuard(ipc, identityKey, 'test')).toEqual({ parked: [c], unparked: [] })
    expect((await reqOf(c)).attempts).toBe(0)

    // Release T: it is posted once, and C goes back to 'unsent' for TaskSendWaiting.
    await releaseColorTx(ipc, identityKey, 'test', t)
    expect(arc.posts.filter(p => p.txids.includes(t))).toHaveLength(1)
    expect((await reqOf(t)).status).toBe('unmined')
    const freedC = await reqOf(c)
    expect(freedC.status).toBe('unsent')
    expect(JSON.parse(freedC.history).notes.map((n: any) => n.what)).toEqual(
      expect.arrayContaining(['colorGuardHoldChild', 'colorGuardReleaseChild']))
    expect(arc.posts.some(p => p.txids.includes(c))).toBe(false)
  })

  test('a plain BSV internalize is unaffected', async () => {
    const { t, atomic } = receipt([new P2PKH().lock(new Array(20).fill(5))])
    const r = await wallet.internalizeAction({
      tx: atomic,
      outputs: [{ outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: 'plain' } }],
      description: 'plain receipt'
    })
    expect(r.accepted).toBe(true)
    expect(arc.posts.filter(p => p.txids.includes(t))).toHaveLength(1)
    expect((await reqOf(t)).status).toBe('unmined')
    expect(await journal.held(identityKey, 'test')).toEqual([])
  })
})
