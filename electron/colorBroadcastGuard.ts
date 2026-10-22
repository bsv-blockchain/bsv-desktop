/**
 * Broadcast guard for 1Color (BRC-162) transactions (contract §8.2).
 *
 * The toolbox broadcasts a proof-less transaction before it persists ownership
 * (`internalizeAction`), on every non-delayed `createAction`/`sendWith`, and from
 * the monitor worker's `TaskSendWaiting`. A 1Color transaction must reach the
 * network only after the color module has a verified overlay admission for it
 * (`module.isSettled(txid)`), so every such broadcast is held until the renderer
 * releases it.
 *
 * Three pieces, one host-owned journal:
 * 1. `ColorGuardJournal` - `<root>/<identityKey>-<chain>/<txid>.held|.released`,
 *    each written atomically. Every read goes to disk (the worker is another
 *    process). It is never keyed on `color.v1.*` store keys.
 * 2. Storage layer (`installColorBroadcastGuard`, main process): a 1Color req that
 *    is not released and whose transaction row is hold-safe is parked at `nosend`
 *    and reported `success`, so `internalizeAction` keeps the credit. Every other
 *    req goes to the original method, where layer 3 decides.
 * 3. Services layer (`guardPostBeef`, main and worker): every txid with an
 *    unreleased 1Color output, or with a proof-less ancestor this wallet holds,
 *    is withheld as `serviceError`, and every held transaction is removed from
 *    the BEEF the network sees.
 *
 * Release (`registerColorGuardIpc`): the renderer drain calls
 * `color-guard:release` only for a txid the module reports settled. Main writes
 * `<txid>.released`, un-parks the req, posts it (through both layers, which now
 * pass it) and deletes `<txid>.held`. A crash anywhere before the delete leaves
 * `.held`, so the next drain redoes the (idempotent) steps.
 *
 * Every guard fault holds: an unloadable classifier or an unreadable journal
 * posts nothing.
 */

import { randomUUID } from 'crypto'
import { promises as fsp } from 'fs'
import os from 'os'
import path from 'path'

export const COLOR_GUARD_CHANNELS = {
  /** invoke: (identityKey, chain) -> string[] of held txids */
  list: 'color-guard:list',
  /** invoke: (identityKey, chain, txid) -> void */
  release: 'color-guard:release',
  /** main -> renderer event: (txid) */
  held: 'color-guard:held'
} as const

export type ColorGuardChain = 'main' | 'test' | 'ttn' | 'tstn'

const IDENTITY_RE = /^0[23][0-9a-f]{64}$/
const TXID_RE = /^[0-9a-f]{64}$/
const CHAINS = new Set(['main', 'test', 'ttn', 'tstn'])
const HELD_RE = /^([0-9a-f]{64})\.held$/

/**
 * Transaction-row statuses a req can be parked under (copied, with its
 * rationale, from bsv-wallet `core/offline/hold.ts` `holdSafeTxStatuses`).
 * Parking writes nothing to the transaction row, so the row must already be one
 * no monitor task acts on: 'unproven' (what `internalizeAction` sets; ignored by
 * `TaskFailAbandoned`, outputs stay spendable) and 'nosend'. 'unprocessed' (a
 * non-delayed `createAction`) is excluded: held there, `TaskFailAbandoned` would
 * fail it within minutes.
 */
export const HOLD_SAFE_TX_STATUSES: readonly string[] = ['unproven', 'nosend']

/** Req statuses the release posts; anything else is already broadcast or final. */
const RELEASE_POST_STATUSES = new Set(['unsent', 'sending', 'unprocessed'])

/** Marks a services object / storage whose broadcast is guarded (shared across module copies). */
const GUARDED = Symbol.for('bsv-desktop.colorBroadcastGuard')

export class ColorBroadcastGuardError extends Error {
  constructor (message: string, readonly cause?: unknown) {
    super(`[ColorBroadcastGuardError] ${message}`)
    this.name = 'ColorBroadcastGuardError'
  }
}

export function defaultColorGuardRoot (): string {
  return path.join(os.homedir(), '.bsv-desktop', 'color-guard')
}

function assertIdentity (identityKey: unknown): asserts identityKey is string {
  if (typeof identityKey !== 'string' || !IDENTITY_RE.test(identityKey)) throw new Error('Invalid color guard identity')
}
function assertChain (chain: unknown): asserts chain is ColorGuardChain {
  if (typeof chain !== 'string' || !CHAINS.has(chain)) throw new Error('Invalid color guard chain')
}
function assertTxid (txid: unknown): asserts txid is string {
  if (typeof txid !== 'string' || !TXID_RE.test(txid)) throw new Error('Invalid color guard txid')
}
function isMissing (error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

async function syncDirectory (dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fsp.open>> | undefined
  try {
    handle = await fsp.open(dir, 'r')
    await handle.sync()
  } catch {
    // best effort (not supported on Windows)
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function writeFileAtomic (dir: string, name: string, contents: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true })
  const target = path.join(dir, name)
  const tmp = path.join(dir, `${name}.${randomUUID()}.tmp`)
  try {
    const handle = await fsp.open(tmp, 'wx')
    try {
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fsp.rename(tmp, target)
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
  await syncDirectory(dir)
}

async function exists (file: string): Promise<boolean> {
  try {
    await fsp.stat(file)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

/**
 * The host-owned hold journal. No cache: the monitor worker writes to the same
 * directory from another process. Read faults throw; callers hold on a throw.
 */
export class ColorGuardJournal {
  readonly root: string
  private readonly tails = new Map<string, Promise<void>>()

  constructor (o: { root?: string } = {}) {
    this.root = o.root ?? defaultColorGuardRoot()
  }

  private dir (identityKey: unknown, chain: unknown): string {
    assertIdentity(identityKey)
    assertChain(chain)
    return path.join(this.root, `${identityKey}-${chain}`)
  }

  /** Idempotent: an existing entry (and its time) is kept. */
  async markHeld (identityKey: string, chain: string, txid: string): Promise<void> {
    const dir = this.dir(identityKey, chain)
    assertTxid(txid)
    if (await exists(path.join(dir, `${txid}.held`))) return
    await writeFileAtomic(dir, `${txid}.held`, JSON.stringify({ txid, at: Date.now() }))
  }

  async isHeld (identityKey: string, chain: string, txid: string): Promise<boolean> {
    const dir = this.dir(identityKey, chain)
    assertTxid(txid)
    return await exists(path.join(dir, `${txid}.held`))
  }

  async isReleased (identityKey: string, chain: string, txid: string): Promise<boolean> {
    const dir = this.dir(identityKey, chain)
    assertTxid(txid)
    return await exists(path.join(dir, `${txid}.released`))
  }

  /** Every `<txid>.held`, sorted, released or not (a release is done only once `.held` is gone). */
  async held (identityKey: string, chain: string): Promise<string[]> {
    const dir = this.dir(identityKey, chain)
    let entries: string[]
    try {
      entries = await fsp.readdir(dir)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const out: string[] = []
    for (const entry of entries) {
      const m = HELD_RE.exec(entry)
      if (m) out.push(m[1])
    }
    return out.sort()
  }

  /** Every held txid without a `.released` entry. */
  async heldUnreleased (identityKey: string, chain: string): Promise<Set<string>> {
    const out = new Set<string>()
    for (const txid of await this.held(identityKey, chain)) {
      if (!(await this.isReleased(identityKey, chain, txid))) out.add(txid)
    }
    return out
  }

  async markReleased (identityKey: string, chain: string, txid: string): Promise<void> {
    const dir = this.dir(identityKey, chain)
    assertTxid(txid)
    if (await exists(path.join(dir, `${txid}.released`))) return
    await writeFileAtomic(dir, `${txid}.released`, JSON.stringify({ txid, at: Date.now() }))
  }

  async clearHeld (identityKey: string, chain: string, txid: string): Promise<void> {
    const dir = this.dir(identityKey, chain)
    assertTxid(txid)
    try {
      await fsp.unlink(path.join(dir, `${txid}.held`))
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
    await syncDirectory(dir)
  }

  /**
   * Runs `work` after every earlier exclusive section of this namespace in this
   * process (main: storage-layer parking and the release's state changes).
   * A failure never stalls the chain. Not re-entrant: never post inside it.
   */
  async exclusive<T> (identityKey: string, chain: string, work: () => Promise<T>): Promise<T> {
    assertIdentity(identityKey)
    assertChain(chain)
    const key = `${identityKey}-${chain}`
    const run = (this.tails.get(key) ?? Promise.resolve()).then(work)
    this.tails.set(key, run.then(() => undefined, () => undefined))
    return await run
  }
}

let sharedJournal: ColorGuardJournal | undefined
/** The main process's journal: shared by the storage layer and the release IPC. */
export function sharedColorGuardJournal (): ColorGuardJournal {
  sharedJournal ??= new ColorGuardJournal()
  return sharedJournal
}

// ---------------------------------------------------------------------------
// Classifier

/** A locking script (any sdk copy: only `toHex()` is used) or its hex. */
export type ScriptLike = { toHex: () => string } | string
export type ScriptClassifier = (script: ScriptLike) => boolean
/** Structurally an sdk `Transaction`: outputs with locking scripts, inputs with source txids. */
export interface TxLike {
  outputs: Array<{ lockingScript?: ScriptLike }>
  inputs: Array<{ sourceTXID?: string, sourceTransaction?: { id: (enc: 'hex') => string } }>
}

/** True iff some output is a BRC-162 (1Color) output. */
export function txHasColorOutput (tx: TxLike, classify: ScriptClassifier): boolean {
  return tx.outputs.some(o => o.lockingScript !== undefined && classify(o.lockingScript))
}

interface ColorKit {
  classify: ScriptClassifier
  parseTx: (rawTx: number[] | Uint8Array) => TxLike & { id: (enc: 'hex') => string }
}

// `@bsv/templates` and `@bsv/sdk` are loaded with a native dynamic import, as the
// monitor worker loads the toolbox: lazily (startup cost) and once.
let kitLoad: Promise<ColorKit> | null = null
let kitFailureLogged = false

async function loadKit (): Promise<ColorKit> {
  kitLoad ??= (async (): Promise<ColorKit> => {
    const [{ OneColor }, { LockingScript, Transaction }] = await Promise.all([
      import('@bsv/templates'),
      import('@bsv/sdk')
    ])
    // `OneColor.decode` reads the 1Color prefix and accepts any remainder
    // (0162:102-104), so it is the complete test: lib `decodeToken` is non-null
    // only for a P2PKH remainder, a strict subset.
    const classify: ScriptClassifier = script => {
      let hex: string
      try {
        hex = typeof script === 'string' ? script : script.toHex()
      } catch {
        return false
      }
      try {
        OneColor.decode(LockingScript.fromHex(hex))
        return true
      } catch {
        return false
      }
    }
    // Self-test: a classifier that cannot tell a token from P2PKH must not load.
    const token = new OneColor().lock(`${'ab'.repeat(32)}_0`, 1n, new Array(20).fill(1))
    const p2pkh = `76a914${'01'.repeat(20)}88ac`
    if (!classify(token) || !classify(token.toHex()) || classify(p2pkh)) {
      throw new Error('1Color classifier self-test failed')
    }
    return { classify, parseTx: raw => Transaction.fromBinary(Array.from(raw)) as any }
  })().catch(error => {
    kitLoad = null
    if (!kitFailureLogged) {
      kitFailureLogged = true
      console.error('[color-guard] classifier unavailable', error)
    }
    throw error
  })
  return await kitLoad
}

/** The BRC-162 output classifier. Rejects (and every tx is then held) when it cannot load. */
export async function loadColorClassifier (): Promise<ScriptClassifier> {
  return (await loadKit()).classify
}

// ---------------------------------------------------------------------------
// Layer 3: services.postBeef

export interface ColorGuardOptions {
  identityKey: string
  chain: ColorGuardChain | string
  journal: ColorGuardJournal
  classify: () => Promise<ScriptClassifier>
  notifyHeld?: (txid: string) => void
}

export interface GuardPostBeefOptions extends ColorGuardOptions {
  /** This process's own storage: finds own `nosend` 1Color reqs (no `.held` file). */
  storage?: { findProvenTxReqs: (args: { partial: { txid: string } }) => Promise<any[]> }
}

interface BeefLike {
  txs: Array<{ txid: string, tx?: TxLike, inputTxids?: string[], hasProof?: boolean, isTxidOnly?: boolean }>
  findTxid: (txid: string) => { txid: string, tx?: TxLike, inputTxids?: string[], hasProof?: boolean, isTxidOnly?: boolean } | undefined
  clone: () => BeefLike
  removeExistingTxid: (txid: string) => void
}

type TxidResult = { txid: string, status: 'success' | 'error', serviceError?: boolean, [k: string]: unknown }
type PostBeefResultLike = { name: string, status: 'success' | 'error', txidResults: TxidResult[], [k: string]: unknown }

const withheld = (txid: string): TxidResult => ({ txid, status: 'error', serviceError: true })

function safeNotify (notify: ((txid: string) => void) | undefined, txid: string): void {
  if (notify === undefined) return
  try { notify(txid) } catch (error) { console.warn('[color-guard] held listener failed', error) }
}

function parentsOf (btx: { tx?: TxLike, inputTxids?: string[] }): string[] {
  if (Array.isArray(btx.inputTxids)) return btx.inputTxids
  const tx = btx.tx
  if (tx === undefined) return []
  return tx.inputs
    .map(i => i.sourceTXID ?? i.sourceTransaction?.id('hex'))
    .filter((t): t is string => typeof t === 'string')
}

/**
 * Decides which of `txids` the network may see. A txid is held iff its tx is
 * missing or unclassifiable, or it has an unreleased 1Color output, or a
 * proof-less ancestor in `beef` is held: in the journal and not released, a
 * held subject of this call, or an own `nosend` 1Color req that is not released.
 * Foreign proof-less ancestors are never classified by their outputs.
 */
async function decideHeld (
  beef: BeefLike,
  txids: string[],
  o: GuardPostBeefOptions
): Promise<{ held: Set<string>, colorHeld: string[], strip: Set<string> }> {
  const classify = await o.classify()
  const unreleasedJournal = await o.journal.heldUnreleased(o.identityKey, o.chain)
  const released = new Map<string, boolean>()
  const isReleased = async (txid: string): Promise<boolean> => {
    let r = released.get(txid)
    if (r === undefined) {
      r = await o.journal.isReleased(o.identityKey, o.chain, txid)
      released.set(txid, r)
    }
    return r
  }
  const ownNosend = new Map<string, boolean>()
  const isOwnNosendColor = async (txid: string, tx: TxLike): Promise<boolean> => {
    let r = ownNosend.get(txid)
    if (r !== undefined) return r
    r = false
    if (o.storage !== undefined && txHasColorOutput(tx, classify)) {
      const rows = await o.storage.findProvenTxReqs({ partial: { txid } })
      r = rows.some(row => row?.status === 'nosend') && !(await isReleased(txid))
    }
    ownNosend.set(txid, r)
    return r
  }

  const held = new Set<string>()
  const colorHeld: string[] = []
  for (const txid of txids) {
    const tx = beef.findTxid(txid)?.tx
    if (tx === undefined) { held.add(txid); continue }
    let color: boolean
    try {
      color = txHasColorOutput(tx, classify)
    } catch {
      held.add(txid)
      continue
    }
    if (color && !(await isReleased(txid))) {
      held.add(txid)
      colorHeld.push(txid)
    }
  }

  // Taint: a proof-less beef tx is tainted when it is held itself or any
  // proof-less ancestor is. Recomputed until the held subjects stop growing.
  let tainted = new Map<string, boolean>()
  const isTainted = async (txid: string, path: Set<string>): Promise<boolean> => {
    const known = tainted.get(txid)
    if (known !== undefined) return known
    const btx = beef.findTxid(txid)
    if (btx === undefined || btx.isTxidOnly === true || btx.hasProof === true) return false
    if (path.has(txid)) return false
    path.add(txid)
    let r = held.has(txid) || unreleasedJournal.has(txid)
    if (!r && btx.tx !== undefined && !txids.includes(txid)) r = await isOwnNosendColor(txid, btx.tx)
    if (!r) {
      for (const parent of parentsOf(btx)) {
        if (await isTainted(parent, path)) { r = true; break }
      }
    }
    path.delete(txid)
    tainted.set(txid, r)
    return r
  }
  for (let changed = true; changed;) {
    changed = false
    tainted = new Map()
    for (const txid of txids) {
      if (held.has(txid)) continue
      const btx = beef.findTxid(txid)
      if (btx === undefined) { held.add(txid); changed = true; continue }
      for (const parent of parentsOf(btx)) {
        if (await isTainted(parent, new Set())) { held.add(txid); changed = true; break }
      }
    }
  }

  const strip = new Set<string>(held)
  if (held.size > 0) {
    tainted = new Map()
    for (const btx of beef.txs) {
      if (await isTainted(btx.txid, new Set())) strip.add(btx.txid)
    }
  }
  return { held, colorHeld, strip }
}

/** Keeps only the remaining subjects and their ancestors; drops everything held. */
function pruneBeef (beef: BeefLike, keepSubjects: string[], strip: Set<string>): BeefLike {
  const needed = new Set<string>()
  const visit = (txid: string): void => {
    if (needed.has(txid) || strip.has(txid)) return
    const btx = beef.findTxid(txid)
    if (btx === undefined) return
    needed.add(txid)
    if (btx.hasProof === true) return
    for (const parent of parentsOf(btx)) visit(parent)
  }
  for (const txid of keepSubjects) visit(txid)
  const out = beef.clone()
  for (const btx of [...out.txs]) {
    if (!needed.has(btx.txid)) out.removeExistingTxid(btx.txid)
  }
  return out
}

export function isColorGuardedServices (services: unknown): boolean {
  return services !== null && typeof services === 'object' && (services as any)[GUARDED] === true
}

/**
 * Wraps `services.postBeef` (main and worker). Held txids never reach the
 * providers: they are removed from the call and from the BEEF, and each
 * provider result reports them as `serviceError`, which the toolbox retries
 * (`TaskSendWaiting`) and never turns into `invalid` by itself. Idempotent.
 */
export function guardPostBeef (services: { postBeef: (...args: any[]) => Promise<any> }, o: GuardPostBeefOptions): void {
  if (isColorGuardedServices(services)) return
  const inner = services.postBeef.bind(services)
  services.postBeef = async (beef: BeefLike, txids: string[], logger?: unknown): Promise<PostBeefResultLike[]> => {
    const list = Array.isArray(txids) ? [...txids] : []
    let decision: Awaited<ReturnType<typeof decideHeld>>
    try {
      decision = await decideHeld(beef, list, o)
    } catch (error) {
      console.warn('[color-guard] cannot classify a broadcast; holding it', error)
      return [{ name: 'ColorBroadcastGuard', status: 'error', txidResults: list.map(withheld) }]
    }
    const { held, colorHeld, strip } = decision
    if (held.size === 0) return await inner(beef, txids, logger)

    for (const txid of colorHeld) {
      try {
        await o.journal.markHeld(o.identityKey, o.chain, txid)
        safeNotify(o.notifyHeld, txid)
      } catch (error) {
        // Withheld anyway; without its journal entry no drain releases it, and the
        // next attempt marks it again.
        console.warn('[color-guard] cannot record a held tx', txid, error)
      }
    }
    const remaining = list.filter(txid => !held.has(txid))
    const heldResults = list.filter(txid => held.has(txid)).map(withheld)
    if (remaining.length === 0) {
      return [{ name: 'ColorBroadcastGuard', status: 'error', txidResults: heldResults }]
    }
    const rs: PostBeefResultLike[] = await inner(pruneBeef(beef, remaining, strip), remaining, logger)
    const out = Array.isArray(rs) ? rs : []
    if (out.length === 0) return [{ name: 'ColorBroadcastGuard', status: 'error', txidResults: heldResults }]
    return out.map(r => ({ ...r, status: 'error', txidResults: [...(r.txidResults ?? []), ...heldResults.map(h => ({ ...h }))] }))
  }
  ;(services as any)[GUARDED] = true
}

// ---------------------------------------------------------------------------
// Layer 2: StorageKnex.attemptToPostReqsToNetwork (main)

export interface GuardedStorageLike {
  attemptToPostReqsToNetwork: (reqs: any[], trx?: unknown, logger?: unknown) => Promise<any>
  findTransactions: (args: { partial: { transactionId: number }, noRawTx?: boolean, trx?: unknown }) => Promise<any[]>
  getServices?: () => unknown
}

/**
 * Replaces the instance method `attemptToPostReqsToNetwork`. An unreleased
 * 1Color req on a hold-safe transaction row is parked (journal first, then
 * `nosend`) and reported `success`; everything else goes to the original
 * method, whose `postBeef` is guarded (layer 3). With nothing parked the
 * original runs with the caller's arguments. A classifier or journal fault
 * throws: nothing is posted. Idempotent.
 */
export function installColorBroadcastGuard (storage: GuardedStorageLike, o: ColorGuardOptions): void {
  if ((storage as any)[GUARDED] === true) return
  const original = storage.attemptToPostReqsToNetwork.bind(storage)

  const holdSafe = async (req: any, trx: unknown): Promise<boolean> => {
    const ids: unknown[] = req?.notify?.transactionIds ?? []
    if (ids.length === 0) return false
    for (const transactionId of ids) {
      const rows = await storage.findTransactions({
        partial: { transactionId: transactionId as number },
        noRawTx: true,
        ...(trx === undefined ? {} : { trx })
      })
      if (rows.length === 0 || !rows.every(row => HOLD_SAFE_TX_STATUSES.includes(row?.status))) return false
    }
    return true
  }

  const assertGuardedServices = (): void => {
    let services: unknown
    try {
      services = storage.getServices?.()
    } catch {
      return // no services: the original method fails on its own, posting nothing
    }
    if (!isColorGuardedServices(services)) {
      throw new ColorBroadcastGuardError('broadcast services are not guarded')
    }
  }

  storage.attemptToPostReqsToNetwork = async (reqs: any[], trx?: unknown, logger?: unknown): Promise<any> => {
    if (!Array.isArray(reqs) || reqs.length === 0) return await original(reqs, trx, logger)

    let decision: { park: any[], markedOnly: string[] }
    try {
      decision = await o.journal.exclusive(o.identityKey, o.chain, async () => {
        const kit = await loadKitVia(o)
        const park: any[] = []
        const markedOnly: string[] = []
        for (const req of reqs) {
          let tx: TxLike
          try {
            tx = kit.parseTx(req.rawTx)
          } catch {
            continue // unparseable: layer 3 withholds it (missing from the BEEF)
          }
          if (!txHasColorOutput(tx, kit.classify)) continue
          if (await o.journal.isReleased(o.identityKey, o.chain, req.txid)) continue
          if (await holdSafe(req, trx)) park.push(req)
          else markedOnly.push(req.txid)
        }
        // Journal first: a crash after markHeld leaves an entry the drain releases
        // normally, so no parked req exists without one.
        for (const req of park) {
          await o.journal.markHeld(o.identityKey, o.chain, req.txid)
          req.status = 'nosend'
          req.addHistoryNote({ when: new Date().toISOString(), what: 'colorGuardHold' })
          await req.updateStorageDynamicProperties(storage, trx)
        }
        for (const txid of markedOnly) await o.journal.markHeld(o.identityKey, o.chain, txid)
        return { park, markedOnly }
      })
    } catch (error) {
      if (error instanceof ColorBroadcastGuardError) throw error
      throw new ColorBroadcastGuardError('cannot classify a broadcast; holding it', error)
    }
    for (const req of decision.park) safeNotify(o.notifyHeld, req.txid)
    for (const txid of decision.markedOnly) safeNotify(o.notifyHeld, txid)

    const parkedDetails = decision.park.map(req => ({ txid: req.txid, req, status: 'success' as const }))
    if (decision.park.length === 0) {
      assertGuardedServices()
      return await original(reqs, trx, logger)
    }
    const rest = reqs.filter(req => !decision.park.includes(req))
    if (rest.length === 0) return { status: 'success', details: parkedDetails, log: '' }
    assertGuardedServices()
    const r = await original(rest, trx, logger)
    return { ...r, details: [...(r?.details ?? []), ...parkedDetails] }
  }
  ;(storage as any)[GUARDED] = true
}

async function loadKitVia (o: ColorGuardOptions): Promise<ColorKit> {
  // The caller's classifier decides (tests and hosts may inject one); the sdk
  // parser always comes from the shared kit.
  const [classify, kit] = await Promise.all([o.classify(), loadKit()])
  return { classify, parseTx: kit.parseTx }
}

// ---------------------------------------------------------------------------
// Release (main IPC)

export interface ColorGuardIpcMainLike {
  handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void
}

export interface ColorGuardIpcOptions {
  journal: ColorGuardJournal
  /** Runs `fn` with this wallet's storage, inside the storage access fence. */
  withStorage: <T>(identityKey: string, chain: ColorGuardChain, fn: (storage: any) => Promise<T>) => Promise<T>
  /** Wraps a `proven_tx_reqs` row as an `EntityProvenTxReq` (default: the toolbox class). */
  toReq?: (row: any) => any | Promise<any>
}

async function defaultToReq (row: any): Promise<any> {
  const { EntityProvenTxReq } = await import('@bsv/wallet-toolbox')
  return new EntityProvenTxReq(row)
}

const releasesInFlight = new Map<string, Promise<void>>()

/**
 * Releases one held txid. Order: `.released`, un-park, post, delete `.held`.
 * Each step is idempotent; a crash before the delete is redone by the next
 * drain. Concurrent releases of one txid share one run; a release of a txid
 * with no `.held` entry does nothing.
 */
export async function releaseColorTx (o: ColorGuardIpcOptions, identityKey: unknown, chain: unknown, txid: unknown): Promise<void> {
  assertIdentity(identityKey)
  assertChain(chain)
  assertTxid(txid)
  const key = `${identityKey}-${chain}:${txid}`
  const pending = releasesInFlight.get(key)
  if (pending) return await pending
  const run = doRelease(o, identityKey, chain, txid).finally(() => {
    if (releasesInFlight.get(key) === run) releasesInFlight.delete(key)
  })
  releasesInFlight.set(key, run)
  return await run
}

async function doRelease (o: ColorGuardIpcOptions, identityKey: string, chain: ColorGuardChain, txid: string): Promise<void> {
  const { journal } = o
  if (!(await journal.isHeld(identityKey, chain, txid))) return
  const toReq = o.toReq ?? defaultToReq
  await o.withStorage(identityKey, chain, async storage => {
    const req = await journal.exclusive(identityKey, chain, async () => {
      await journal.markReleased(identityKey, chain, txid)
      const rows: any[] = await storage.findProvenTxReqs({ partial: { txid } })
      if (rows.length === 0) return undefined
      const req = await toReq(rows[0])
      if (req.status === 'nosend') {
        req.status = 'unsent'
        req.addHistoryNote({ when: new Date().toISOString(), what: 'colorGuardRelease' })
        await req.updateStorageDynamicProperties(storage)
      }
      return req
    })
    // Outside the exclusive section: the post passes through the storage layer,
    // which takes it. "Already known/mined" and success are done; a serviceError
    // leaves the req 'sending' for TaskSendWaiting, which the guard now lets pass.
    if (req !== undefined && RELEASE_POST_STATUSES.has(req.status)) {
      await storage.attemptToPostReqsToNetwork([req])
    }
  })
  await journal.exclusive(identityKey, chain, async () => await journal.clearHeld(identityKey, chain, txid))
}

/** Registers `color-guard:list` and `color-guard:release`. */
export function registerColorGuardIpc (ipcMain: ColorGuardIpcMainLike, o: ColorGuardIpcOptions): void {
  ipcMain.handle(COLOR_GUARD_CHANNELS.list, async (_event, identityKey, chain) => {
    assertIdentity(identityKey)
    assertChain(chain)
    return await o.journal.held(identityKey, chain)
  })
  ipcMain.handle(COLOR_GUARD_CHANNELS.release, async (_event, identityKey, chain, txid) =>
    await releaseColorTx(o, identityKey, chain, txid))
}
