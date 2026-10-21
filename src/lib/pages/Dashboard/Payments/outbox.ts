/**
 * The payer's saved payments (the outbox): payments to wallet identities, saved on this
 * device before they are broadcast and kept until they are delivered, by the message box or
 * directly. They survive logout (see WalletService).
 *
 * A delivery can finish 30–75 s after it began, in the background, after other flows (Send,
 * a retry, a remounted Payments page) saved rows of their own. So every write starts
 * from the rows stored at that moment, never from a copy read earlier: a stale copy would
 * drop rows saved since (and with them the only copy of a broadcast payment's token) or undo
 * another delivery's `delivered` flag. Each write is announced in this window, so every open
 * view can show the stored rows.
 */
import type { OutgoingPayment } from './messageBoxPayments'
import { validAmount } from './paymentProtocol'

const CHANGED_EVENT = 'peerpay-outbox-changed'

export const outboxStorageKey = (identity: string, chain: string) => `peerpay-outbox-v1:${identity}:${chain}`

/** The saved payments as stored now, or null when they cannot be read. */
export function readOutbox(key: string): OutgoingPayment[] | null {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(rows) && rows.every(isRow) ? rows : null
  } catch {
    return null
  }
}

/**
 * The only outbox write: applies `change` to the rows stored now and stores the result.
 * Returns the rows stored. Throws when they cannot be stored, and when the stored outbox
 * cannot be read: replacing it would erase every saved payment, broadcast ones' only tokens
 * among them (final review M18). `whenUnreadable` ends that error's first sentence.
 */
export function updateOutbox(key: string, change: (rows: OutgoingPayment[]) => OutgoingPayment[], whenUnreadable = 'they were left as they are'): OutgoingPayment[] {
  const current = localStorage.getItem(key) === null ? [] : readOutbox(key)
  if (!current) throw new Error(`Saved payments on this device could not be read, so ${whenUnreadable}. Check Activity before sending again.`)
  const rows = change(current)
  localStorage.setItem(key, JSON.stringify(rows))
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { key } }))
  return rows
}

/**
 * Saves a newly prepared payment (before it is broadcast). When this throws, the payment flows
 * release the prepared transaction instead of broadcasting it, so nothing is spent.
 */
export const addToOutbox = (key: string, row: OutgoingPayment) => updateOutbox(key, rows => [...rows, row], 'this payment was not saved, and nothing was spent')

export const markOutboxDelivered = (key: string, txid: string) =>
  updateOutbox(key, rows => rows.map(row => (row.txid === txid ? { ...row, delivered: true } : row)))

/** Calls `fn` with the outbox key after every write in this window; returns the unsubscribe. */
export function subscribeOutbox(fn: (key: string) => void): () => void {
  const listener = (event: Event) => fn((event as CustomEvent<{ key: string }>).detail.key)
  window.addEventListener(CHANGED_EVENT, listener)
  return () => window.removeEventListener(CHANGED_EVENT, listener)
}

function isRow(row: any): row is OutgoingPayment {
  return !!row && /^[0-9a-f]{64}$/.test(row.txid) && validAmount(row.amount) && !!row.token && Array.isArray(row.token.transaction)
}
