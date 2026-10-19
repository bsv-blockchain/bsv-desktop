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
 */
import { Transaction } from '@bsv/sdk'
import type { IncomingPayment, PeerPayClient } from '@bsv/message-box-client'
import { paymentKey } from '@bsv/webrtpay'
import { EventEmittable } from './EventEmittable'
import { beginUserWalletOperation } from './httpBridgeSession'
import { createSeenStore } from '../pages/Dashboard/Payments/directPayments'

export interface ReceivedRecord { messageId: string; sender: string; amount: number; at: number; status: 'received' | 'failed'; error?: string }

export type MessageBoxAutoReceiverOptions = { client: PeerPayClient; host: string; identity: string; chain: string; relistMs?: number }

export const RECEIVED_RECORDS_PREFIX = 'messagebox-received-v1:'
const RECORD_LIMIT = 200
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
  private _inFlight = new Set<string>()
  private _listing = false
  private _timer: ReturnType<typeof setInterval> | null = null
  private _onFocus = () => { if (this._run) void this._relist(this._run.generation) }

  /** Newest first; the same array until something changes. */
  records(): ReceivedRecord[] { return this._records }

  /** (Re)starts for this client and wallet. Never rejects. */
  async start(o: MessageBoxAutoReceiverOptions): Promise<void> {
    this._halt()
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

  /** Tries a failed payment again, fetching it from the message box. */
  async retry(messageId: string): Promise<void> {
    const run = this._run
    if (!run) return
    let payment: IncomingPayment | undefined
    let problem = ''
    try { [payment] = await run.client.findIncomingPaymentsByMessageId(messageId, run.host) } catch (error) { problem = messageOf(error) }
    if (!this._current(run.generation)) return
    if (payment) return this._take(payment, run.generation)
    const existing = this._find(messageId)
    if (existing?.status === 'failed') this._record(run, { ...existing, error: problem || 'This payment is no longer in your message box.' })
  }

  private _halt() {
    this._generation++
    this._run = null
    this._inFlight = new Set()
    this._listing = false
    if (this._timer) clearInterval(this._timer)
    this._timer = null
    events()?.removeEventListener('focus', this._onFocus)
  }

  private _current(generation: number) { return this._run !== null && this._run.generation === generation }

  private _find(messageId: string) { return this._records.find(r => r.messageId === messageId) }

  private async _relist(generation: number): Promise<void> {
    const run = this._run
    if (!run || run.generation !== generation || this._listing) return
    this._listing = true
    try {
      const payments = await run.client.listIncomingPayments(run.host)
      for (const payment of payments) { if (!this._current(generation)) return; await this._take(payment, generation) }
    } catch (error) {
      console.warn('[MessageBoxAutoReceiver] Could not list message box payments:', error)
    } finally { if (this._current(generation)) this._listing = false }
  }

  private async _take(payment: IncomingPayment, generation: number): Promise<void> {
    const run = this._run
    const id = payment?.messageId
    if (!run || run.generation !== generation || typeof id !== 'string') return
    if (this._inFlight.has(id) || this._find(id)?.status === 'received') return
    const inFlight = this._inFlight
    inFlight.add(id)
    const base = { messageId: id, sender: String(payment.sender ?? ''), amount: Number(payment.token?.amount) || 0 }
    try {
      const seen = createSeenStore(run.identity, run.chain)
      const key = keyOf(payment)
      if (seen.has(key)) { await run.client.acknowledgeMessage({ messageIds: [id], host: run.host }); return }
      const release = beginUserWalletOperation()
      try { await run.client.acceptPayment(payment) } finally { release() }
      seen.add(key)
      this._record(run, { ...base, at: Date.now(), status: 'received' })
      const win = events()
      if (this._current(generation) && win) {
        win.dispatchEvent(new CustomEvent('messagebox-payment-received', { detail: { amount: base.amount, sender: base.sender } }))
        win.dispatchEvent(new CustomEvent('balance-changed'))
      }
    } catch (error) {
      this._record(run, { ...base, at: this._find(id)?.at ?? Date.now(), status: 'failed', error: messageOf(error) })
    } finally { inFlight.delete(id) }
  }

  /**
   * Stores the record for the run's wallet, in place of one for the same message or else
   * newest first, and shows it if the run is current.
   */
  private _record(run: Run, record: ReceivedRecord) {
    const current = this._current(run.generation)
    const rows = current ? this._records : readRecords(run.storageKey)
    const at = rows.findIndex(r => r.messageId === record.messageId)
    // A payment that keeps failing the same way on every listing changes nothing.
    if (at >= 0 && rows[at].status === record.status && rows[at].error === record.error && rows[at].at === record.at) return
    const next = (at < 0 ? [record, ...rows] : rows.map((r, i) => i === at ? record : r)).slice(0, RECORD_LIMIT)
    try { localStorage.setItem(run.storageKey, JSON.stringify(next)) } catch { /* the record is shown for this session only */ }
    if (current) this._setRecords(next)
  }

  private _setRecords(rows: ReceivedRecord[]) {
    if (rows === this._records) return
    this._records = rows
    this.emit('changed', rows)
  }
}
