/**
 * Wallet Toolbox reaches some storage through methods that are optional on
 * WalletStorageWriter: the BRC-177 "noSend with expiry" lifecycle
 * (wallet-toolbox >= 2.11) and action batch resume, packed uploads and digest
 * commit. The renderer's WalletStorageManager calls them on its active store,
 * the StorageElectronIPC proxy, so each one has to cross the IPC bridge and
 * pass the main process allow-list. A missing link surfaces to apps as
 * "Active storage does not support BRC-177 noSend expiry" or
 * WERR_NOT_IMPLEMENTED.
 *
 * The renderer half is the real WalletDataStorageManager, built as
 * WalletService builds it, over the real StorageElectronIPC; the main half is
 * the real StorageManager, entered through request() as electron/main.ts does.
 * The Electron transport is modelled, with structuredClone standing in for
 * IPC serialization, and the monitor worker process is a stand-in. The gate
 * and allow-list cases put stub storage behind the real StorageManager; the
 * real-StorageKnex cases run the toolbox's own storage logic.
 *
 * BRC-177 also requires that no funding transaction is created unless the
 * monitor can enforce the deadline, so main-process storage offers noSend
 * expiry only while the wallet's monitor worker reports that its tasks run.
 */

import { EventEmitter } from 'events'
import knex, { type Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Beef, CachedKeyDeriver, Hash, P2PKH, PrivateKey, Script, Transaction, Utils, Validation } from '@bsv/sdk'
import { KnexMigrations, MockServices, Monitor, StorageKnex, WalletStorageManager as MainWalletStorageManager } from '@bsv/wallet-toolbox'
import { ScriptTemplateBRC29, Wallet, WalletStorageManager, sdk } from '@bsv/wallet-toolbox-client'
import { storageCallFailure, storageManager } from '../electron/storage'
import { StorageElectronIPC } from '../src/lib/StorageElectronIPC'
import { WalletDataStorageManager } from '../src/lib/walletPortability/WalletDataStorageManager'

type FakeWorker = EventEmitter & { lingerOnStop: boolean }
const forked: FakeWorker[] = []

// A monitor worker that is ready at once and exits when asked to stop. Its
// Monitor is running only once the test sends 'monitor-started' for it.
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    fork: () => {
      const worker: any = Object.assign(new EventEmitter(), {
        exitCode: null, signalCode: null, connected: true, stdout: null, stderr: null, lingerOnStop: false,
        send: (message: { type: string }, callback?: (error: Error | null) => void) => {
          if (message.type === 'stop' && !worker.lingerOnStop) setImmediate(() => worker.emit('exit', 0, null))
          callback?.(null)
        },
        kill: () => {}
      })
      worker.on('exit', (code: number | null, signal: string | null) => {
        Object.assign(worker, { exitCode: code, signalCode: signal, connected: false })
      })
      forked.push(worker)
      setImmediate(() => worker.emit('message', { type: 'ready' }))
      return worker
    }
  }
})

// better-sqlite3 is rebuilt for Electron's ABI by postinstall; skip the real
// StorageKnex cases when plain node cannot load it, and only then.
async function canUseSqlite(): Promise<boolean> {
  const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
  try { await db.raw('SELECT 1'); return true }
  catch (error: any) {
    if (!/ERR_DLOPEN_FAILED|NODE_MODULE_VERSION|Could not locate the bindings file/.test(`${error?.code} ${error?.message}`)) throw error
    console.warn(`Skipping real StorageKnex cases: ${error.message}`)
    return false
  }
  finally { await db.destroy() }
}
const sqliteAvailable = await canUseSqlite()

const chain = 'test' as const
const identityKey = new PrivateKey(1).toPublicKey().toString()
const storageIdentityKey = new PrivateKey(2).toPublicKey().toString()

// Derived from the toolbox: every writer method WalletStorageManager refuses
// when its active store lacks it. One added upstream is covered here before it
// can silently fail behind the proxy. Only the `writer.<name> == null` guard is
// recognised; the fixed six-name assertion below is the backstop.
const optionalWriterMethods = Object.getOwnPropertyNames(WalletStorageManager.prototype).filter(name => {
  const member = Object.getOwnPropertyDescriptor(WalletStorageManager.prototype, name)?.value
  return typeof member === 'function' && member.toString().includes(`writer.${name} == null`)
})

// The manager awaits these without returning the store's result.
const returnsVoid = new Set(['armNoSendExpiry', 'putActionBatchPack'])

/** Route window.electronAPI.storage the way electron/main.ts does, into the real StorageManager. */
function bridgeTo(mainStorage: unknown): void {
  vi.spyOn(storageManager, 'getOrCreateStorage').mockResolvedValue(mainStorage as StorageKnex)
  const reply = async (operation: () => Promise<unknown>) => {
    try { return { success: true, result: structuredClone(await operation()) } }
    catch (error) { return storageCallFailure(error) }
  }
  vi.stubGlobal('window', {
    electronAPI: {
      storage: {
        makeAvailable: async (identity: string, network: typeof chain) => ({
          success: true,
          settings: structuredClone(await storageManager.request(identity, network, () => (mainStorage as StorageKnex).makeAvailable()))
        }),
        callMethod: async (identity: string, network: typeof chain, method: string, args: unknown[]) =>
          reply(() => storageManager.request(identity, network, () =>
            storageManager.callStorageMethod(identity, network, method, structuredClone(args))))
      }
    }
  })
}

function rendererStorageManager(): WalletDataStorageManager {
  return new WalletDataStorageManager(identityKey, new StorageElectronIPC(identityKey, chain) as any, [])
}

/** Start the wallet's monitor worker as initializeServices does, and report its tasks running. */
async function startMonitor(network: 'main' | 'test' = chain): Promise<FakeWorker> {
  await storageManager.startMonitorWorker(identityKey, network)
  const worker = forked[forked.length - 1]
  worker.emit('message', { type: 'monitor-started' })
  return worker
}

afterEach(async () => {
  await storageManager.cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('optional storage writer methods over IPC', () => {
  const settings = { storageIdentityKey, storageName: 'ipc test', chain, dbtype: 'SQLite', maxOutputScript: 10000 }
  let main: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(async () => {
    main = {
      makeAvailable: vi.fn(async () => settings),
      findOrInsertUser: vi.fn(async () => ({ user: { userId: 7, identityKey, activeStorage: storageIdentityKey }, isNew: false })),
      getCapabilities: vi.fn(async () => ({ brc177NoSendExpiry: { version: 1 } }))
    }
    for (const method of optionalWriterMethods) main[method] = vi.fn(async () => ({ handledBy: method }))
    bridgeTo(main)
    await startMonitor()
  })

  test('the toolbox optional writer methods are discovered', () => {
    expect(optionalWriterMethods).toEqual(expect.arrayContaining([
      'prepareNoSendExpiry', 'activateNoSendExpiry', 'armNoSendExpiry',
      'resumeActionBatch', 'putActionBatchPack', 'commitActionBatchByDigest'
    ]))
  })

  test('getCapabilities is answered by main-process storage', async () => {
    await expect(rendererStorageManager().getCapabilities()).resolves.toEqual({ brc177NoSendExpiry: { version: 1 } })
    expect(main.getCapabilities).toHaveBeenCalledOnce()
  })

  test.each(optionalWriterMethods)('%s reaches main-process storage as the active writer', async method => {
    const args = { batchId: 'batch', reference: 'cmVm', reclaimRawTx: new Uint8Array([1, 2, 3]) }

    const result = await (rendererStorageManager() as any)[method](args)

    expect(result).toEqual(returnsVoid.has(method) ? undefined : { handledBy: method })
    expect(main[method]).toHaveBeenCalledWith({ identityKey, userId: 7, isActive: true }, args)
  })
})

describe('BRC-177 noSend expiry is offered only while the wallet monitor runs', () => {
  const settings = { storageIdentityKey, storageName: 'ipc test', chain, dbtype: 'SQLite', maxOutputScript: 10000 }
  const offered = { brc177NoSendExpiry: { version: 1 }, actionBatch: { version: 1 } }
  const withheld = { actionBatch: { version: 1 } }
  const refused = /^Storage method prepareNoSendExpiry failed: BRC-177 noSend expiry is unavailable while the wallet monitor is not running$/
  let main: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(() => {
    main = {
      makeAvailable: vi.fn(async () => settings),
      findOrInsertUser: vi.fn(async () => ({ user: { userId: 7, identityKey, activeStorage: storageIdentityKey }, isNew: false })),
      getCapabilities: vi.fn(async () => offered),
      prepareNoSendExpiry: vi.fn(async () => ({ handledBy: 'prepareNoSendExpiry' }))
    }
    bridgeTo(main)
  })

  const capabilities = () => rendererStorageManager().getCapabilities()
  const prepare = () => rendererStorageManager().prepareNoSendExpiry({ reference: 'cmVm' } as any)

  test('withheld, and prepare refused, before the monitor has started', async () => {
    await expect(capabilities()).resolves.toEqual(withheld)
    await expect(prepare()).rejects.toThrow(refused)

    // Forked, but its Monitor has not started yet.
    await storageManager.startMonitorWorker(identityKey, chain)
    await expect(capabilities()).resolves.toEqual(withheld)
    await expect(prepare()).rejects.toThrow(refused)
    expect(main.prepareNoSendExpiry).not.toHaveBeenCalled()
  })

  test('offered, and prepare reaches storage, while the monitor runs', async () => {
    await startMonitor()

    await expect(capabilities()).resolves.toEqual(offered)
    await expect(prepare()).resolves.toEqual({ handledBy: 'prepareNoSendExpiry' })
  })

  test.each([
    ['exits', (worker: FakeWorker) => worker.emit('exit', 1, null)],
    ['emits a process error', (worker: FakeWorker) => worker.emit('error', new Error('monitor worker failed'))]
  ])('withdrawn, and prepare refused, when the monitor worker %s', async (_, crash) => {
    const worker = await startMonitor()
    await expect(capabilities()).resolves.toEqual(offered)

    crash(worker)

    await expect(capabilities()).resolves.toEqual(withheld)
    await expect(prepare()).rejects.toThrow(refused)
    expect(main.prepareNoSendExpiry).not.toHaveBeenCalled()
  })

  test.each(['activateNoSendExpiry', 'armNoSendExpiry'])('%s is refused like prepare while no monitor runs', async method => {
    main[method] = vi.fn(async () => undefined)
    const call = () => (rendererStorageManager() as any)[method]({ reference: 'cmVm' })

    await expect(call()).rejects.toThrow(`Storage method ${method} failed: BRC-177 noSend expiry is unavailable while the wallet monitor is not running`)
    expect(main[method]).not.toHaveBeenCalled()

    await startMonitor()
    await call()
    expect(main[method]).toHaveBeenCalledOnce()
  })

  test.each(['createAction', 'processAction'])('%s reaches storage while no monitor runs', async method => {
    main[method] = vi.fn(async () => ({ handledBy: method }))

    await expect((rendererStorageManager() as any)[method]({ description: 'plain' })).resolves.toEqual({ handledBy: method })
    expect(main[method]).toHaveBeenCalledOnce()
  })

  test('withdrawn as soon as the monitor is asked to stop', async () => {
    const worker = await startMonitor()
    worker.lingerOnStop = true

    const stopping = storageManager.stopMonitorWorker(identityKey, chain)

    try {
      await expect(capabilities()).resolves.toEqual(withheld)
    } finally {
      worker.emit('exit', 0, null)
      await stopping
    }
  })

  test('not offered when monitor-started arrives after the stop began', async () => {
    // Sent by the worker before it handled 'stop', so it is still in flight.
    await storageManager.startMonitorWorker(identityKey, chain)
    const worker = forked[forked.length - 1]
    worker.lingerOnStop = true

    const stopping = storageManager.stopMonitorWorker(identityKey, chain)
    worker.emit('message', { type: 'monitor-started' })

    try {
      await expect(capabilities()).resolves.toEqual(withheld)
      await expect(prepare()).rejects.toThrow(refused)
      expect(main.prepareNoSendExpiry).not.toHaveBeenCalled()
    } finally {
      worker.emit('exit', 0, null)
      await stopping
    }
  })

  test('a network switch withdraws it for the released network only', async () => {
    await startMonitor('test')
    await startMonitor('main')

    await storageManager.releaseNetwork(identityKey, 'test')

    await expect(capabilities()).resolves.toEqual(withheld)
    await expect(storageManager.callStorageMethod(identityKey, 'main', 'getCapabilities', [])).resolves.toEqual(offered)
  })
})

describe.skipIf(!sqliteAvailable)('optional storage writer methods over IPC with real StorageKnex', () => {
  let db: Knex
  let storage: StorageKnex

  beforeEach(async () => {
    db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    await db.migrate.latest({ migrationSource: new KnexMigrations(chain, 'ipc test', storageIdentityKey, 10000) })
    storage = new StorageKnex({ knex: db, chain, feeModel: { model: 'sat/kb', value: 100 }, commissionSatoshis: 0 })
    await storage.makeAvailable()
    bridgeTo(storage)
  })

  afterEach(async () => {
    await db.destroy()
  })

  test('without a running monitor, only BRC-177 is withheld from StorageKnex capabilities', async () => {
    const { brc177NoSendExpiry, ...others } = await storage.getCapabilities() as any

    expect(brc177NoSendExpiry).toEqual({ version: 1 })
    expect(await rendererStorageManager().getCapabilities()).toEqual(others)
  })

  test('advertises BRC-177 and runs prepareNoSendExpiry in StorageKnex', async () => {
    await startMonitor()
    const manager = rendererStorageManager()
    expect(await manager.getCapabilities()).toMatchObject({ brc177NoSendExpiry: { version: 1 } })

    const args = Validation.validateCreateActionArgs({
      description: 'BRC-177 IPC test',
      labels: ['p nosend expiry seconds 600'],
      outputs: [{
        lockingScript: new P2PKH().lock(new PrivateKey(3).toPublicKey().toAddress()).toHex(),
        satoshis: 1000,
        outputDescription: 'protected output'
      }],
      options: { noSend: true }
    })

    // An empty wallet cannot fund the anchor: failing there proves the call got
    // past the proxy and the allow-list into StorageKnex's own funding logic.
    await expect(manager.prepareNoSendExpiry(args)).rejects.toThrow(/^Storage method prepareNoSendExpiry failed: .*[Ii]nsufficient funds/)
  })

  test('advertises the action batch features that need the optional methods', async () => {
    expect(await rendererStorageManager().getCapabilities()).toMatchObject({
      actionBatch: { commitByDigest: true, packedUploads: { version: 1 } }
    })
  })

  // No batch exists, so each call fails inside StorageKnex's own batch logic,
  // which proves it got past the proxy and the allow-list.
  const bytes = new Uint8Array([1, 2, 3])
  test.each([
    ['resumeActionBatch', { batchId: 'none', outpoints: [{ txid: '00'.repeat(32), vout: 0 }] }, /cannot continue because it is missing/],
    // The digest is checked before the batch lookup, so reaching "missing"
    // also shows the bytes crossed the bridge intact.
    ['putActionBatchPack', { batchId: 'none', items: [{ digest: Utils.toHex(Hash.sha256(Array.from(bytes))), bytes }] }, /cannot continue because it is missing/],
    ['commitActionBatchByDigest', { batchId: 'none', digest: '00'.repeat(32) }, /prepared action batch manifest was not found/]
  ])('runs %s in StorageKnex', async (method, args, reason) => {
    const call = (rendererStorageManager() as any)[method](args)

    await expect(call).rejects.toThrow(new RegExp(`^Storage method ${method} failed: .*${reason.source}`))
  })

  // The renderer's toolbox acts on the storage error's code: an empty wallet's
  // WERR_INSUFFICIENT_FUNDS, for one, lets WalletPermissionsManager keep a
  // grant whose token cannot be funded instead of asking for it again.
  test('an empty wallet createAction rejects with the toolbox error code over IPC', async () => {
    const wallet = new Wallet({ chain: 'mock', keyDeriver: new CachedKeyDeriver(new PrivateKey(1)), storage: rendererStorageManager(), services: new MockServices(db) })
    const action = { description: 'empty wallet test', outputs: [{ lockingScript: '51', satoshis: 1, outputDescription: 'token' }] }

    const failure = await wallet.createAction(action).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(sdk.WERR_INSUFFICIENT_FUNDS)
    expect(failure).toMatchObject({ code: 'WERR_INSUFFICIENT_FUNDS', moreSatoshisNeeded: expect.any(Number) })
    expect((failure as Error).message).toMatch(/^Storage method createAction failed: Insufficient funds/)
  })

  const protectedAction = {
    description: 'BRC-177 IPC test',
    labels: ['p nosend expiry seconds 3600'],
    outputs: [{ lockingScript: '51', satoshis: 5000, outputDescription: 'protected output' }],
    options: { noSend: true, randomizeOutputs: false }
  }

  /** Run with a renderer Wallet over the bridge, funded on a fresh MockServices chain. */
  async function withFundedWallet(run: (wallet: Wallet, services: MockServices) => Promise<void>): Promise<void> {
    const chainDb = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    try {
      const services = new MockServices(chainDb)
      await services.initialize()
      // A mock coinbase can be spent after 100 confirmations.
      for (let i = 0; i < 101; i++) await services.mineBlock()
      storage.setServices(services)
      const wallet = new Wallet({ chain: 'mock', keyDeriver: new CachedKeyDeriver(new PrivateKey(1)), storage: rendererStorageManager(), services })
      await fundWallet(wallet, services, chainDb)
      await run(wallet, services)
    } finally {
      await chainDb.destroy()
    }
  }

  test('a funded BRC-177 createAction completes over IPC and expires to its reclaim', async () => {
    await withFundedWallet(async (wallet, services) => {
      const callMethod = vi.spyOn((window as any).electronAPI.storage, 'callMethod')

      // No monitor running: the wallet refuses before any funding transaction exists.
      const before = await storage.findTransactions({ partial: {} })
      await expect(wallet.createAction(protectedAction)).rejects.toThrow('Active storage does not support BRC-177 noSend expiry')
      expect(callMethod.mock.calls.map(call => call[2])).not.toContain('prepareNoSendExpiry')
      expect(await storage.findTransactions({ partial: {} })).toEqual(before)

      await startMonitor()
      callMethod.mockClear()
      const { txid } = await wallet.createAction(protectedAction)

      expect(txid).toMatch(/^[0-9a-f]{64}$/)
      expect(callMethod.mock.calls.map(call => call[2])).toEqual(expect.arrayContaining(['prepareNoSendExpiry', 'activateNoSendExpiry', 'armNoSendExpiry']))
      expect(await services.getRawTx(txid!)).not.toHaveProperty('rawTx')
      const [target] = await storage.findTransactions({ partial: { txid } })
      expect(target).toMatchObject({ noSendExpiryState: 'signed', noSendExpiryReclaimRawTx: expect.any(Array) })

      // Past the deadline, a Monitor with the default tasks (which
      // electron/monitor-worker.ts also adds, in its own process) broadcasts the
      // pre-signed reclaim, and settles once it is mined.
      await storage.updateTransaction(target.transactionId, { noSendExpiryDeadline: 0 })
      const monitorStorage = new MainWalletStorageManager(identityKey, storage)
      await monitorStorage.makeAvailable()
      const monitor = new Monitor({
        chain: 'mock', services, storage: monitorStorage, chaintracks: services.tracker,
        msecsWaitPerMerkleProofServiceReq: 0, taskRunWaitMsecs: 5000, abandonedMsecs: 300000,
        unprovenAttemptsLimitTest: 100, unprovenAttemptsLimitMain: 144, maxRebroadcastAttempts: 0
      } as any)
      monitor.addDefaultTasks()
      await monitor.runTask('NoSendExpiry')
      expect(await services.getRawTx(target.noSendExpiryReclaimTxid!)).toHaveProperty('rawTx')
      monitor.processNewBlockHeader(await services.mineBlock())
      await monitor.runTask('CheckForProofs')
      await monitor.runTask('NoSendExpiry')
      const [expired] = await storage.findTransactions({ partial: { txid } })
      expect(expired.noSendExpiryState).toBe('reclaimed')
    })
  })

  // The monitor exits after prepareNoSendExpiry has funded the anchor. The next
  // BRC-177 call is refused, and the toolbox returns the anchor as change: a
  // refused activate leaves it unclaimed, and a refused arm aborts the action.
  test.each([
    ['activateNoSendExpiry', []],
    ['armNoSendExpiry', [{ status: 'failed', noSendExpiryState: 'cancelled' }]]
  ])('a monitor that exits before %s: refused, the anchor stays spendable and only the funding fee is spent', async (method, protectedRows) => {
    await withFundedWallet(async wallet => {
      const worker = await startMonitor()
      const api = (window as any).electronAPI.storage
      const send = api.callMethod
      let prepared: any
      vi.spyOn(api, 'callMethod').mockImplementation(async (identity: any, network: any, name: any, args: any) => {
        if (name === method) worker.emit('exit', 1, null)
        const reply = await send(identity, network, name, args)
        if (name === 'prepareNoSendExpiry') prepared = reply.result
        return reply
      })
      const reached = vi.spyOn(storage as any, method)
      const balance = async () => (await storage.findOutputs({ partial: { spendable: true } })).reduce((sum, output) => sum + output.satoshis, 0)
      const before = await balance()

      await expect(wallet.createAction(protectedAction)).rejects.toThrow(`Storage method ${method} failed: BRC-177 noSend expiry is unavailable while the wallet monitor is not running`)

      expect(reached).not.toHaveBeenCalled()
      const transactions = await storage.findTransactions({ partial: {} })
      expect(transactions.map(tx => tx.noSendExpiryState)).not.toContain('signed')
      expect(transactions.filter(tx => tx.description === protectedAction.description)).toMatchObject(protectedRows)
      const [funding] = await storage.findTransactions({ partial: { reference: prepared.funding.reference } })
      const [anchor] = await storage.findOutputs({ partial: { transactionId: funding.transactionId, vout: prepared.anchorVout } })
      expect(anchor).toMatchObject({ spendable: true, change: true })
      const spent = (await storage.findOutputs({ partial: { spentBy: funding.transactionId } })).reduce((sum, output) => sum + output.satoshis, 0)
      const created = (await storage.findOutputs({ partial: { transactionId: funding.transactionId } })).reduce((sum, output) => sum + output.satoshis, 0)
      expect(spent - created).toBeGreaterThan(0)
      expect(await balance()).toBe(before - (spent - created))

      // Only BRC-177 needs the monitor: an ordinary action still goes through.
      await expect(wallet.createAction({
        description: 'plain action',
        outputs: [{ lockingScript: '51', satoshis: 1000, outputDescription: 'plain output' }],
        options: { noSend: true }
      })).resolves.toHaveProperty('txid', expect.stringMatching(/^[0-9a-f]{64}$/))
    })
  })
})

/** Pay a matured mock coinbase into the wallet's change basket. */
async function fundWallet(wallet: Wallet, services: MockServices, chainDb: Knex): Promise<void> {
  const height = await services.getHeight()
  const coinbase = await chainDb('mockchain_utxos')
    .where({ isCoinbase: true, spentByTxid: null }).where('blockHeight', '<=', height - 100).first()
  const sourceRawTx = (await services.getRawTx(coinbase.txid)).rawTx!
  const derivationPrefix = Utils.toBase64(Array(16).fill(1))
  const derivationSuffix = Utils.toBase64(Array(16).fill(2))
  const keys = wallet.getClientChangeKeyPair()
  const payment = new Transaction()
  payment.addInput({ sourceTransaction: Transaction.fromBinary(sourceRawTx), sourceOutputIndex: 0, unlockingScript: new Script() })
  payment.addOutput({
    satoshis: 1_000_000,
    lockingScript: new ScriptTemplateBRC29({ derivationPrefix, derivationSuffix, keyDeriver: wallet.keyDeriver }).lock(keys.privateKey, keys.publicKey)
  })
  const txid = payment.id('hex')
  const beef = new Beef()
  beef.mergeRawTx(sourceRawTx, beef.mergeBump((await services.getMerklePath(coinbase.txid)).merklePath!))
  beef.mergeRawTx(payment.toBinary())
  expect((await services.postBeef(beef, [txid]))[0].status).toBe('success')
  await services.mineBlock()
  const proven = new Beef()
  proven.mergeRawTx(payment.toBinary(), proven.mergeBump((await services.getMerklePath(txid)).merklePath!))
  await wallet.internalizeAction({
    tx: proven.toBinaryAtomic(txid),
    outputs: [{ outputIndex: 0, protocol: 'wallet payment', paymentRemittance: { derivationPrefix, derivationSuffix, senderIdentityKey: wallet.identityKey } }],
    description: 'Fund BRC-177 IPC test'
  })
}
