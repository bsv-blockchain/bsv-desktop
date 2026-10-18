/**
 * The payer's saved payments (the outbox). Deliveries run in the background for up to a
 * minute and finish in any order, after other flows (Send, Retry, Nearby, a remounted
 * Payments page) saved rows of their own. Every write therefore starts from the rows stored
 * at that moment: no delivery can drop another's row or undo its `delivered` flag.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addToOutbox, markOutboxDelivered, outboxStorageKey, readOutbox, subscribeOutbox, updateOutbox } from '../src/lib/pages/Dashboard/Payments/outbox'
import type { OutgoingPayment } from '../src/lib/pages/Dashboard/Payments/messageBoxPayments'

const KEY = outboxStorageKey(`02${'42'.repeat(32)}`, 'main')

let local: Map<string, string>
let setItem: (key: string, value: string) => void

beforeEach(() => {
  local = new Map()
  setItem = (key, value) => { local.set(key, value) }
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => setItem(key, value),
    removeItem: (key: string) => { local.delete(key) }
  })
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('CustomEvent', class extends Event {
    detail: unknown
    constructor(type: string, init?: { detail?: unknown }) { super(type); this.detail = init?.detail }
  })
})

const row = (n: number, change: Partial<OutgoingPayment> = {}): OutgoingPayment => ({
  txid: String(n).repeat(64).slice(0, 64),
  recipient: `03${'17'.repeat(32)}`,
  amount: 1000 + n,
  createdAt: n,
  delivered: false,
  via: 'direct',
  token: { transaction: [1, 2, n], amount: 1000 + n, outputIndex: 0, customInstructions: { derivationPrefix: 'p', derivationSuffix: 's' } },
  ...change
})

const stored = () => JSON.parse(local.get(KEY) ?? '[]') as OutgoingPayment[]

/** Resolves when `release` is called: the moment a background delivery gets its ack. */
function gate() {
  let release!: () => void
  const opened = new Promise<void>(resolve => { release = resolve })
  return { opened, release }
}

describe('the outbox', () => {
  it('keys saved payments by identity and network', () => {
    expect(outboxStorageKey('02ab', 'test')).toBe('peerpay-outbox-v1:02ab:test')
  })

  it('keeps every delivery\'s row and flag when deliveries finish in any order', async () => {
    const first = gate(), second = gate()
    // Two deliveries, each saving its row before broadcast and marking it once acked.
    const deliver = async (payment: OutgoingPayment, acked: Promise<void>) => {
      addToOutbox(KEY, payment)
      await acked
      markOutboxDelivered(KEY, payment.txid)
    }
    const a = deliver(row(1), first.opened)
    const b = deliver(row(2), second.opened)
    addToOutbox(KEY, row(3)) // a Send-tab payment saved meanwhile, not delivered yet

    second.release()
    await b
    first.release()
    await a

    expect(stored()).toEqual([row(1, { delivered: true }), row(2, { delivered: true }), row(3)])
  })

  it('applies a change to the rows stored when it runs, not to rows read earlier', () => {
    addToOutbox(KEY, row(1))
    const earlier = readOutbox(KEY)!
    addToOutbox(KEY, row(2)) // saved by another flow after `earlier` was read

    const rows = updateOutbox(KEY, current => current.map(r => (r.txid === earlier[0].txid ? { ...r, delivered: true } : r)))

    expect(rows).toEqual([row(1, { delivered: true }), row(2)])
    expect(stored()).toEqual(rows)
  })

  it('reads nothing as an empty outbox, and an unreadable one as null', () => {
    expect(readOutbox(KEY)).toEqual([])
    local.set(KEY, '{not json')
    expect(readOutbox(KEY)).toBeNull()
    local.set(KEY, JSON.stringify([{ ...row(1), txid: 'not a txid' }]))
    expect(readOutbox(KEY)).toBeNull()
    local.set(KEY, JSON.stringify([row(1), { ...row(2), amount: 0 }]))
    expect(readOutbox(KEY)).toBeNull()
  })

  it('replaces an unreadable outbox on the next write, as the page shows it empty', () => {
    local.set(KEY, '{not json')
    addToOutbox(KEY, row(1))
    expect(stored()).toEqual([row(1)])
  })

  it('tells every view in this window about each write, until it stops listening', () => {
    const heard = vi.fn()
    const stop = subscribeOutbox(heard)

    addToOutbox(KEY, row(1))
    markOutboxDelivered(KEY, row(1).txid)
    expect(heard.mock.calls).toEqual([[KEY], [KEY]])

    stop()
    addToOutbox(KEY, row(2))
    expect(heard).toHaveBeenCalledTimes(2)
  })

  it('throws when the row cannot be stored, and tells no one', () => {
    const heard = vi.fn()
    subscribeOutbox(heard)
    setItem = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') }

    expect(() => addToOutbox(KEY, row(1))).toThrow(/quota/)
    expect(heard).not.toHaveBeenCalled()
  })
})
