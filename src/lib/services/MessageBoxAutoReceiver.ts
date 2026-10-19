/**
 * MessageBoxAutoReceiver — takes message box payments into the open wallet without a click.
 *
 * Runs app-wide for the active identity and network (WalletService starts it next to direct
 * pay and stops it on lock, profile or network switch and logout): on start it lists the
 * payments waiting in the message box and accepts each, then accepts live arrivals, and
 * lists again every `relistMs` and when the window gets focus as a safety net. Payment
 * requests are never touched.
 *
 * Each payment is accepted once (single flight per message id). A payment whose output this
 * wallet already took another way (a direct payment delivered live, see createSeenStore) is
 * acknowledged silently, with no record or announcement. A failed accept is recorded with its
 * error, left in the message box, and tried again on the next listing or on `retry`.
 *
 * Accepting is background work (beginBackgroundWalletOperation): it yields to Lock, a profile
 * or network switch and wallet removal. Once one is asked for (walletChangeRequests changes),
 * it takes nothing new for {@link YIELD_MS}, so the user's next try gets the wallet; a wallet
 * that is busy or changing networks is not a failure either. In both cases the payment stays
 * in the message box for the next listing, with no record.
 */
import { Transaction } from '@bsv/sdk'
import type { IncomingPayment, PeerPayClient } from '@bsv/message-box-client'
import { paymentKey } from '@bsv/webrtpay'
import { EventEmittable } from './EventEmittable'
import { beginBackgroundWalletOperation, walletChangeRequests } from './httpBridgeSession'
import { createSeenStore } from '../pages/Dashboard/Payments/directPayments'

export interface ReceivedRecord { messageId: string; sender: string; amount: number; at: number; status: 'received' | 'failed'; error?: string }

export type MessageBoxAutoReceiverOptions = { client: PeerPayClient; host: string; identity: string; chain: string; relistMs?: number }

export const RECEIVED_RECORDS_PREFIX = 'messagebox-received-v1:'
const RECORD_LIMIT = 200
/** How long nothing new is accepted after Lock, a switch or removal was asked for. */
export const YIELD_MS = 15_000
/**
 * The longest a listing or an accept may hold the wallet. After that the wallet is released
 * (so Lock or a switch is not held up) and the payment is left for the next listing; an accept
 * that finishes later is still recorded.
 */
export const CALL_MS = 15_000

class TookTooLong extends Error {}

/** `p`, or a {@link TookTooLong} after `ms` (the call goes on, unobserved here). */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TookTooLong('The message box or wallet took too long')), ms) })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}
const NO_RECORDS: ReceivedRecord[] = []

export const recordsStorageKey = (identity: string, chain: string) => `${RECEIVED_RECORDS_PREFIX}${identity}:${chain}`

function readRecords(storageKey: string): ReceivedRecord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(value) ? value.filter((r): r is ReceivedRecord => !!r && typeof r.messageId === 'string' && typeof r.amount === 'number') : []
  } catch { return [] }
}

/** The key the seen store uses for this payment's output (same rule as directPayments.ts). */
function keyOf(p: IncomingPayment): string {
  const txid = Transaction.fromAtomicBEEF(p.token.transaction).id('hex')
  return paymentKey(txid, p.token.outputIndex ?? p.outputIndex ?? 0, p.token.customInstructions.derivationPrefix, p.token.customInstructions.derivationSuffix)
}

/** The window, when there is one that takes events (not in some tests and workers). */
const events = (): Window | undefined => typeof window !== 'undefined' && typeof window?.addEventListener === 'function' ? window : undefined

const messageOf = (error: unknown) => (error instanceof Error && error.message) || 'This payment could not be added to your wallet.'

type Run = Required<MessageBoxAutoReceiverOptions> & { generation: number; storageKey: string }

export class MessageBoxAutoReceiver extends EventEmittable<{ changed: ReceivedRecord[] }> {
  private _generation = 0
  private _run: Run | null = null
  private _records: ReceivedRecord[] = NO_RECORDS
  /** Message ids being accepted, kept across restarts so a new run never starts one twice (review minor 4). */
  private readonly _inFlight = new Set<string>()
  /** The listing in progress, if any (one at a time). */
  private _listing: Promise<void> | null = null
  private _timer: ReturnType<typeof setInterval> | null = null
  private _changes = walletChangeRequests()
  private _pausedUntil = 0
  private _onFocus = () => { if (this._run) void this._relist(this._run.generation) }

  /** Newest first; the same array until something changes. */
  records(): ReceivedRecord[] { return this._records }

  /** (Re)starts for this client and wallet. Never rejects. */
  async start(o: MessageBoxAutoReceiverOptions): Promise<void> {
    this._halt()
    // A Lock or switch asked for before this start is over: the wallet is open again, so
    // waiting payments are taken now, not after a pause (desktop review finding 2).
    this._changes = walletChangeRequests()
    this._pausedUntil = 0
    const generation = this._generation
    const run: Run = { relistMs: 60_000, ...o, generation, storageKey: recordsStorageKey(o.identity, o.chain) }
    this._run = run
    this._setRecords(readRecords(run.storageKey))
    this._timer = setInterval(() => void this._relist(generation), run.relistMs)
    events()?.addEventListener('focus', this._onFocus)
    const listen = (async () => {
      try { await run.client.listenForLivePayments({ onPayment: payment => { if (this._current(generation)) void this._take(payment, generation) }, overrideHost: run.host }) } catch (error) { console.warn('[MessageBoxAutoReceiver] Live payments are unavailable; listing continues:', error) }
    })()
    await Promise.all([listen, this._relist(generation)])
  }

  /** Stops at once: later callbacks of this run do nothing, and no records are shown. */
  async stop(): Promise<void> {
    this._halt()
    this._setRecords(NO_RECORDS)
  }

  /**
   * For Wallet Check: takes what is waiting now, through the same path as every other intake
   * (records, seen store, toasts), and says what was added during it and what is still failing.
   * Null when not running (no open wallet or message box).
   */
  async takeWaiting(): Promise<{ count: number; sats: number; failed: number } | null> {
    const run = this._run
    if (!run) return null
    const before = new Set(this._records.filter(r => r.status === 'received').map(r => r.messageId))
    await this._listing // a listing already in progress may have started before a payment arrived
    await this._relist(run.generation)
    if (!this._current(run.generation)) return null
    const added = this._records.filter(r => r.status === 'received' && !before.has(r.messageId))
    return { count: added.length, sats: added.reduce((sum, r) => sum + r.amount, 0), failed: this._records.filter(r => r.status === 'failed').length }
  }

  /** Tries a failed payment again, fetching it from the message box. */
  async retry(messageId: string): Promise<void> {
    const run = this._run
    if (!run) return
    let payment: IncomingPayment | undefined
    let problem = ''
    try { [payment] = await run.client.findIncomingPaymentsByMessageId(messageId, run.host) } catch (error) { problem = messageOf(error) }
    if (!this._current(run.generation)) return
    if (payment && this._yielding()) {
      // Lock or a switch was just asked for (review minor 7): say so instead of doing nothing.
      const existing = this._find(messageId)
      if (existing?.status === 'failed') this._record(run, { ...existing, error: 'Your wallet is busy. Try again in a few seconds.' })
      return
    }
    if (payment) return this._take(payment, run.generation)
    const existing = this._find(messageId)
    if (existing?.status === 'failed') this._record(run, { ...existing, error: problem || 'This payment is no longer in your message box.' })
  }

  private _halt() {
    this._generation++
    this._run = null
    this._listing = null
    if (this._timer) clearInterval(this._timer)
    this._timer = null
    events()?.removeEventListener('focus', this._onFocus)
  }

  /** True while yielding to a Lock, switch or removal the user asked for. */
  private _yielding(): boolean {
    const changes = walletChangeRequests()
    if (changes !== this._changes) { this._changes = changes; this._pausedUntil = Date.now() + YIELD_MS }
    return Date.now() < this._pausedUntil
  }

  private _current(generation: number) { return this._run !== null && this._run.generation === generation }

  private _find(messageId: string) { return this._records.find(r => r.messageId === messageId) }

  /** Lists and takes what is waiting; while a listing is in progress, that one. Never rejects. */
  private _relist(generation: number): Promise<void> {
    const run = this._run
    if (!run || run.generation !== generation) return Promise.resolve()
    if (this._listing) return this._listing
    const listing = (async () => {
      try {
        const payments = await withDeadline(run.client.listIncomingPayments(run.host), CALL_MS)
        for (const payment of payments) { if (!this._current(generation) || this._yielding()) return; await this._take(payment, generation) }
      } catch (error) {
        console.warn('[MessageBoxAutoReceiver] Could not list message box payments:', error)
      } finally { if (this._listing === listing) this._listing = null }
    })()
    this._listing = listing
    return listing
  }

  private async _take(payment: IncomingPayment, generation: number): Promise<void> {
    const run = this._run
    const id = payment?.messageId
    if (!run || run.generation !== generation || typeof id !== 'string') return
    if (this._inFlight.has(id)) return
    // Taken, yet still listed: its acknowledgement was lost (acceptPayment does not retry it). Ack it quietly (review minor 3).
    if (this._find(id)?.status === 'received') { await this._ackQuietly(run, id); return }
    const inFlight = this._inFlight
    inFlight.add(id)
    // Kept while an accept that took too long is still running, so it is not started twice.
    let settled: Promise<unknown> | undefined
    const base = { messageId: id, sender: String(payment.sender ?? ''), amount: Number(payment.token?.amount) || 0 }
    try {
      const seen = createSeenStore(run.identity, run.chain)
      const key = keyOf(payment)
      if (seen.has(key)) { await this._ackQuietly(run, id); return } // already in the wallet: never a failure row (review minor 5)
      if (this._yielding()) return
      let release: () => void
      try { release = beginBackgroundWalletOperation('messagebox-receive') } catch { return } // busy or switching: the next listing tries again
      const taken = () => {
        seen.add(key)
        this._record(run, { ...base, at: Date.now(), status: 'received' })
        const win = events()
        if (this._current(generation) && win) {
          win.dispatchEvent(new CustomEvent('messagebox-payment-received', { detail: { amount: base.amount, sender: base.sender } }))
          win.dispatchEvent(new CustomEvent('balance-changed'))
        }
      }
      const accepting = run.client.acceptPayment(payment)
      try {
        await withDeadline(accepting, CALL_MS)
      } catch (error) {
        if (!(error instanceof TookTooLong)) throw error
        // Release the wallet now; record the payment if the accept finishes after all, else
        // the next listing tries again. Not a failure.
        settled = accepting.then(taken, () => {})
        return
      } finally { release() }
      taken()
    } catch (error) {
      this._record(run, { ...base, at: this._find(id)?.at ?? Date.now(), status: 'failed', error: messageOf(error) })
    } finally {
      if (settled) void settled.finally(() => inFlight.delete(id))
      else inFlight.delete(id)
    }
  }

  /**
   * Stores the record for the run's wallet, in place of one for the same message or else
   * newest first, and shows it if the run is current.
   */
  private _record(run: Run, record: ReceivedRecord) {
    const current = this._current(run.generation)
    // A stopped run of the wallet that is open again (a restart) updates the shown list too, so
    // the new run does not write over its record (review minor 4); it still announces nothing.
    const shown = current || (this._run !== null && this._run.storageKey === run.storageKey)
    const rows = shown ? this._records : readRecords(run.storageKey)
    const at = rows.findIndex(r => r.messageId === record.messageId)
    // A payment that keeps failing the same way on every listing changes nothing.
    if (at >= 0 && rows[at].status === record.status && rows[at].error === record.error && rows[at].at === record.at) return
    const next = (at < 0 ? [record, ...rows] : rows.map((r, i) => i === at ? record : r)).slice(0, RECORD_LIMIT)
    try { localStorage.setItem(run.storageKey, JSON.stringify(next)) } catch { /* the record is shown for this session only */ }
    if (shown) this._setRecords(next)
  }

  /** Acknowledges a message whose payment the wallet already has; a failure only waits for the next listing. */
  private async _ackQuietly(run: Run, messageId: string): Promise<void> {
    try { await run.client.acknowledgeMessage({ messageIds: [messageId], host: run.host }) } catch (error) { console.warn('[MessageBoxAutoReceiver] Could not acknowledge a payment already received:', error) }
  }

  private _setRecords(rows: ReceivedRecord[]) {
    if (rows === this._records) return
    this._records = rows
    this.emit('changed', rows)
  }
}
