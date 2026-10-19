import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LockingScript, MerklePath, P2PKH, PrivateKey, Transaction, UnlockingScript } from '@bsv/sdk'
import { paymentKey } from '@bsv/webrtpay'
import { CALL_MS, MessageBoxAutoReceiver, recordsStorageKey, YIELD_MS } from '../src/lib/services/MessageBoxAutoReceiver'
import { activeUserWalletOperations, BACKGROUND_RETRY_BUSY, beginBackgroundWalletOperation, MESSAGEBOX_RECEIVE_BUSY, setHttpBridgePaused, walletChangeBlocker, _test_resetHttpBridgeSessions } from '../src/lib/services/httpBridgeSession'
import { createSeenStore } from '../src/lib/pages/Dashboard/Payments/directPayments'

const IDENTITY = '02' + 'ab'.repeat(32)
const CHAIN = 'test'
const HOST = 'https://box.example.com'

let local: Map<string, string>
let events: CustomEvent[]

beforeEach(() => {
  _test_resetHttpBridgeSessions()
  local = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => { local.set(k, v) },
    removeItem: (k: string) => { local.delete(k) }
  })
  const target = new EventTarget()
  events = []
  const dispatch = target.dispatchEvent.bind(target)
  target.dispatchEvent = (event: Event) => { events.push(event as CustomEvent); return dispatch(event) }
  vi.stubGlobal('window', target)
})

/** Atomic BEEF paying `satoshis` at output 0, with a single-leaf proof for the parent. */
function beef(satoshis: number): { tx: number[]; txid: string } {
  const parent = new Transaction()
  parent.addInput({ sourceTXID: '00'.repeat(32), sourceOutputIndex: 0xffffffff, unlockingScript: new UnlockingScript() })
  parent.addOutput({ lockingScript: new P2PKH().lock(PrivateKey.fromRandom().toPublicKey().toHash()), satoshis: satoshis + 1000 })
  parent.merklePath = MerklePath.fromCoinbaseTxidAndHeight(parent.id('hex'), 1)
  const child = new Transaction()
  child.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScript: new UnlockingScript() })
  child.addOutput({ lockingScript: new P2PKH().lock(PrivateKey.fromRandom().toPublicKey().toHash()) as LockingScript, satoshis })
  return { tx: child.toAtomicBEEF(), txid: child.id('hex') }
}

function payment(messageId: string, amount = 1000) {
  const { tx, txid } = beef(amount)
  return { messageId, sender: '03' + 'cd'.repeat(32), txid, token: { customInstructions: { derivationPrefix: 'cHJlZml4', derivationSuffix: `c3Vm${messageId}` }, transaction: tx, amount } }
}

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }

function fakeClient(inbox: any[] = []) {
  let live: ((p: any) => void) | undefined
  const client = {
    inbox,
    listIncomingPayments: vi.fn(async (_host?: string) => [...client.inbox]),
    listIncomingPaymentRequests: vi.fn(async () => []),
    listenForLivePayments: vi.fn(async ({ onPayment }: { onPayment: (p: any) => void }) => { live = onPayment }),
    acceptPayment: vi.fn(async (p: any) => { client.inbox = client.inbox.filter(m => m.messageId !== p.messageId) }),
    acknowledgeMessage: vi.fn(async ({ messageIds }: { messageIds: string[] }) => { client.inbox = client.inbox.filter(m => !messageIds.includes(m.messageId)); return 'success' }),
    findIncomingPaymentsByMessageId: vi.fn(async (id: string) => client.inbox.filter(m => m.messageId === id)),
    deliver: (p: any) => live!(p)
  }
  return client
}

const start = (receiver: MessageBoxAutoReceiver, client: ReturnType<typeof fakeClient>) =>
  receiver.start({ client: client as any, host: HOST, identity: IDENTITY, chain: CHAIN })

const announced = () => events.filter(e => e.type === 'messagebox-payment-received').map(e => e.detail)

describe('MessageBoxAutoReceiver', () => {
  it('accepts waiting payments on start', async () => {
    const [a, b] = [payment('m1', 1000), payment('m2', 2500)]
    const client = fakeClient([a, b])
    const receiver = new MessageBoxAutoReceiver()
    const changed = vi.fn()
    receiver.on('changed', changed)

    await start(receiver, client)

    expect(client.listIncomingPayments).toHaveBeenCalledWith(HOST)
    expect(client.acceptPayment).toHaveBeenCalledTimes(2)
    expect(receiver.records().map(r => [r.messageId, r.status, r.amount])).toEqual([['m2', 'received', 2500], ['m1', 'received', 1000]])
    expect(announced()).toEqual([{ amount: 1000, sender: a.sender }, { amount: 2500, sender: b.sender }])
    expect(events.filter(e => e.type === 'balance-changed')).toHaveLength(2)
    expect(JSON.parse(local.get(recordsStorageKey(IDENTITY, CHAIN))!)).toEqual(receiver.records())
    expect(changed).toHaveBeenLastCalledWith(receiver.records())
    await receiver.stop()
  })

  it('accepts a live payment', async () => {
    const client = fakeClient()
    const receiver = new MessageBoxAutoReceiver()
    await start(receiver, client)
    expect(client.listenForLivePayments).toHaveBeenCalledWith(expect.objectContaining({ overrideHost: HOST }))

    const p = payment('live-1', 700)
    client.inbox.push(p)
    client.deliver(p)
    await vi.waitFor(() => expect(receiver.records()).toHaveLength(1))

    expect(client.acceptPayment).toHaveBeenCalledWith(p)
    expect(announced()).toEqual([{ amount: 700, sender: p.sender }])
    await receiver.stop()
  })

  it('accepts each payment once across list and live', async () => {
    const p = payment('m1', 1000)
    const client = fakeClient([p])
    const gate = deferred()
    client.acceptPayment.mockImplementationOnce(async () => { await gate.promise; client.inbox = [] })
    const receiver = new MessageBoxAutoReceiver()
    const started = start(receiver, client)
    await vi.waitFor(() => expect(client.acceptPayment).toHaveBeenCalledTimes(1))

    // The same message arrives live, and a re-list (window focus) sees it while it is in flight.
    client.deliver(p)
    window.dispatchEvent(new Event('focus'))
    gate.resolve()
    await started
    // After it was taken, later copies are ignored too.
    client.deliver(p)
    window.dispatchEvent(new Event('focus'))
    await new Promise(r => setTimeout(r, 0))

    expect(client.acceptPayment).toHaveBeenCalledTimes(1)
    expect(receiver.records()).toHaveLength(1)
    expect(announced()).toHaveLength(1)
    await receiver.stop()
  })

  it('records failure and retries', async () => {
    const p = payment('m1', 1200)
    const client = fakeClient([p])
    client.acceptPayment.mockRejectedValueOnce(new Error('Your wallet is locked.'))
    const receiver = new MessageBoxAutoReceiver()

    await start(receiver, client)
    expect(receiver.records()).toEqual([expect.objectContaining({ messageId: 'm1', status: 'failed', error: 'Your wallet is locked.', amount: 1200 })])
    expect(client.acknowledgeMessage).not.toHaveBeenCalled()
    expect(client.inbox).toHaveLength(1)
    expect(announced()).toEqual([])

    await receiver.retry('m1')
    expect(client.findIncomingPaymentsByMessageId).toHaveBeenCalledWith('m1', HOST)
    expect(receiver.records()).toEqual([expect.objectContaining({ messageId: 'm1', status: 'received' })])
    expect(receiver.records()[0].error).toBeUndefined()
    expect(announced()).toEqual([{ amount: 1200, sender: p.sender }])
    await receiver.stop()
  })

  it('retries a failure on the next listing', async () => {
    const client = fakeClient([payment('m1')])
    client.acceptPayment.mockRejectedValueOnce(new Error('busy')).mockRejectedValueOnce(new Error('busy'))
    const receiver = new MessageBoxAutoReceiver()
    await start(receiver, client)
    expect(receiver.records()[0].status).toBe('failed')
    // The same failure again leaves the records as they were.
    const failed = receiver.records()
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(client.acceptPayment).toHaveBeenCalledTimes(2))
    await new Promise(r => setTimeout(r, 0))
    expect(receiver.records()).toBe(failed)

    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(receiver.records()[0].status).toBe('received'))
    expect(receiver.records()).toHaveLength(1)
    await receiver.stop()
  })

  it('says when a failed payment is no longer in the message box', async () => {
    const client = fakeClient([payment('m1')])
    client.acceptPayment.mockRejectedValueOnce(new Error('busy'))
    const receiver = new MessageBoxAutoReceiver()
    await start(receiver, client)
    client.inbox = []

    await receiver.retry('m1')
    expect(receiver.records()).toEqual([expect.objectContaining({ status: 'failed', error: 'This payment is no longer in your message box.' })])
    await receiver.stop()
  })

  it('stop ignores late callbacks', async () => {
    const client = fakeClient()
    const receiver = new MessageBoxAutoReceiver()
    await start(receiver, client)
    await receiver.stop()

    client.deliver(payment('late'))
    window.dispatchEvent(new Event('focus'))
    await new Promise(r => setTimeout(r, 0))

    expect(client.acceptPayment).not.toHaveBeenCalled()
    expect(client.listIncomingPayments).toHaveBeenCalledTimes(1)
    expect(receiver.records()).toEqual([])
  })

  it('keeps an accept that finished after stop on the device, without announcing it', async () => {
    const client = fakeClient([payment('m1')])
    const gate = deferred()
    client.acceptPayment.mockImplementationOnce(async () => { await gate.promise })
    const receiver = new MessageBoxAutoReceiver()
    const started = start(receiver, client)
    await vi.waitFor(() => expect(client.acceptPayment).toHaveBeenCalled())
    await receiver.stop()
    gate.resolve()
    await started

    expect(receiver.records()).toEqual([])
    expect(announced()).toEqual([])
    expect(JSON.parse(local.get(recordsStorageKey(IDENTITY, CHAIN))!)).toEqual([expect.objectContaining({ messageId: 'm1', status: 'received' })])
  })

  it('does not list payment requests', async () => {
    const client = fakeClient([payment('m1')])
    const receiver = new MessageBoxAutoReceiver()
    await start(receiver, client)
    expect(client.listIncomingPaymentRequests).not.toHaveBeenCalled()
    await receiver.stop()
  })

  it('message box copy of a seen txid is acked without toast or record', async () => {
    const p = payment('m1')
    createSeenStore(IDENTITY, CHAIN).add(paymentKey(p.txid, 0, p.token.customInstructions.derivationPrefix, p.token.customInstructions.derivationSuffix))
    const client = fakeClient([p])
    const receiver = new MessageBoxAutoReceiver()

    await start(receiver, client)

    expect(client.acknowledgeMessage).toHaveBeenCalledWith({ messageIds: ['m1'], host: HOST })
    expect(client.acceptPayment).not.toHaveBeenCalled()
    expect(receiver.records()).toEqual([])
    expect(events).toEqual([])
  })

  it('remembers what it took, so a later live copy of the same output is acked silently', async () => {
    const p = payment('m1')
    const client = fakeClient([p])
    const receiver = new MessageBoxAutoReceiver()
    await start(receiver, client)
    await receiver.stop()

    // A fresh run (the app restarted) without the old records sees the same output again.
    local.delete(recordsStorageKey(IDENTITY, CHAIN))
    const again = { ...p, messageId: 'm2' }
    client.inbox = [again]
    await start(receiver, client)
    expect(client.acceptPayment).toHaveBeenCalledTimes(1)
    expect(client.acknowledgeMessage).toHaveBeenCalledWith({ messageIds: ['m2'], host: HOST })
    expect(receiver.records()).toEqual([])
    await receiver.stop()
  })

  it('shows the records stored for the wallet when it starts, and a restart with the same records keeps the reference stable', async () => {
    const client = fakeClient([payment('m1')])
    const receiver = new MessageBoxAutoReceiver()
    await start(receiver, client)
    const first = receiver.records()
    expect(receiver.records()).toBe(first)
    await receiver.stop()
    expect(receiver.records()).toEqual([])

    await start(receiver, client)
    expect(receiver.records()).toEqual(first)
    await receiver.stop()
  })

  it('keeps listing when live payments are unavailable', async () => {
    const client = fakeClient([payment('m1')])
    client.listenForLivePayments.mockRejectedValueOnce(new Error('no websocket'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const receiver = new MessageBoxAutoReceiver()
    await expect(start(receiver, client)).resolves.toBeUndefined()
    expect(receiver.records()).toHaveLength(1)
    warn.mockRestore()
    await receiver.stop()
  })

  describe('review minors', () => {
    it('acknowledges quietly a payment it took whose acknowledgement was lost', async () => {
      const p = payment('m1')
      const client = fakeClient([p])
      client.acceptPayment.mockImplementationOnce(async () => {}) // internalized, but the ack was lost: still listed
      const receiver = new MessageBoxAutoReceiver()
      await start(receiver, client)
      expect(client.inbox).toEqual([p])

      window.dispatchEvent(new Event('focus'))
      await vi.waitFor(() => expect(client.acknowledgeMessage).toHaveBeenCalledWith({ messageIds: ['m1'], host: HOST }))
      expect(client.acceptPayment).toHaveBeenCalledTimes(1)
      expect(receiver.records()).toEqual([expect.objectContaining({ messageId: 'm1', status: 'received' })])
      expect(announced()).toHaveLength(1)
      await receiver.stop()
    })

    it('shows no failure when acknowledging a copy of a payment it already has fails', async () => {
      const p = payment('m1')
      createSeenStore(IDENTITY, CHAIN).add(paymentKey(p.txid, 0, p.token.customInstructions.derivationPrefix, p.token.customInstructions.derivationSuffix))
      const client = fakeClient([p])
      client.acknowledgeMessage.mockRejectedValueOnce(new Error('offline'))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const receiver = new MessageBoxAutoReceiver()
      await start(receiver, client)
      expect(receiver.records()).toEqual([])
      warn.mockRestore()
      await receiver.stop()
    })

    it('does not accept twice across a restart, and keeps the record of the accept that outlived it', async () => {
      const client = fakeClient([payment('m1', 300)])
      const gate = deferred()
      client.acceptPayment.mockImplementationOnce(async () => { await gate.promise; client.inbox = [] })
      const receiver = new MessageBoxAutoReceiver()
      void start(receiver, client)
      await vi.waitFor(() => expect(client.acceptPayment).toHaveBeenCalledTimes(1))

      // Restarted (say, a new message box client) while the first accept still runs.
      const restarted = start(receiver, client)
      gate.resolve()
      await restarted
      await new Promise(r => setTimeout(r, 0))

      expect(client.acceptPayment).toHaveBeenCalledTimes(1)
      expect(receiver.records()).toEqual([expect.objectContaining({ messageId: 'm1', status: 'received', amount: 300 })])
      // A later record of the new run keeps it.
      const next = payment('m2')
      client.inbox = [next]
      client.deliver(next)
      await vi.waitFor(() => expect(receiver.records().map(r => r.messageId)).toEqual(['m2', 'm1']))
      expect(JSON.parse(local.get(recordsStorageKey(IDENTITY, CHAIN))!).map((r: any) => r.messageId)).toEqual(['m2', 'm1'])
      await receiver.stop()
    })

    it('says to try again when Retry is pressed while it gives way to Lock', async () => {
      const client = fakeClient([payment('m1')])
      client.acceptPayment.mockRejectedValueOnce(new Error('busy'))
      const receiver = new MessageBoxAutoReceiver()
      await start(receiver, client)
      walletChangeBlocker('Finish your current payment first.')

      await receiver.retry('m1')
      expect(client.acceptPayment).toHaveBeenCalledTimes(1)
      expect(receiver.records()).toEqual([expect.objectContaining({ status: 'failed', error: 'Your wallet is busy. Try again in a few seconds.' })])
      await receiver.stop()
    })
  })

  describe('takeWaiting (Wallet Check)', () => {
    it('is null while not running', async () => {
      expect(await new MessageBoxAutoReceiver().takeWaiting()).toBeNull()
    })

    it('takes what is waiting through the usual path and says what it added and what still fails', async () => {
      const client = fakeClient()
      const receiver = new MessageBoxAutoReceiver()
      await start(receiver, client)
      const [a, b, c] = [payment('m1', 500), payment('m2', 1000), payment('m3', 50)]
      client.inbox = [a, b, c]
      client.acceptPayment.mockImplementation(async (p: any) => {
        if (p.messageId === 'm3') throw new Error('busy')
        client.inbox = client.inbox.filter(m => m.messageId !== p.messageId)
      })

      expect(await receiver.takeWaiting()).toEqual({ count: 2, sats: 1500, failed: 1 })
      expect(announced()).toHaveLength(2)
      // Asked again, nothing new: each payment is taken once.
      expect(await receiver.takeWaiting()).toEqual({ count: 0, sats: 0, failed: 1 })
      expect(client.acceptPayment.mock.calls.filter(([p]) => p.messageId !== 'm3')).toHaveLength(2)
      await receiver.stop()
    })
  })

  describe('as background work', () => {
    it('yields to Lock: the blocker names message box receiving, and nothing new is taken until the pause ends', async () => {
      const [a, b] = [payment('m1', 1000), payment('m2', 2000)]
      const client = fakeClient([a, b])
      const gate = deferred()
      client.acceptPayment.mockImplementationOnce(async () => { await gate.promise; client.inbox = client.inbox.filter(m => m !== a) })
      const receiver = new MessageBoxAutoReceiver()
      const started = start(receiver, client)
      await vi.waitFor(() => expect(client.acceptPayment).toHaveBeenCalledTimes(1))

      // Lock is asked for while the first payment is being accepted.
      expect(activeUserWalletOperations()).toBe(1)
      expect(walletChangeBlocker('Finish your current payment first.')).toBe(MESSAGEBOX_RECEIVE_BUSY)
      gate.resolve()
      await started

      // The accept in progress finished; the next one was left in the message box, not failed.
      expect(client.acceptPayment).toHaveBeenCalledTimes(1)
      expect(receiver.records().map(r => [r.messageId, r.status])).toEqual([['m1', 'received']])
      expect(client.inbox).toEqual([b])
      expect(walletChangeBlocker('Finish your current payment first.')).toBe('') // the user's next try goes ahead

      // Still paused: a live copy and a re-list take nothing.
      client.deliver(b)
      window.dispatchEvent(new Event('focus'))
      await new Promise(r => setTimeout(r, 0))
      expect(client.acceptPayment).toHaveBeenCalledTimes(1)

      // After the pause the next listing takes it.
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now + YIELD_MS + 1)
      window.dispatchEvent(new Event('focus'))
      await vi.waitFor(() => expect(receiver.records()).toHaveLength(2))
      expect(client.acceptPayment).toHaveBeenCalledTimes(2)
      vi.restoreAllMocks()
      await receiver.stop()
    })

    it('takes waiting payments at once when it starts after a Lock or switch was asked for (desktop review finding 2)', async () => {
      const client = fakeClient([payment('m1')])
      const receiver = new MessageBoxAutoReceiver()
      await start(receiver, client)
      await receiver.stop()

      // Lock (or a switch) is asked for, the wallet closes and opens again.
      expect(walletChangeBlocker('Finish your current payment first.')).toBe('')
      client.inbox = [payment('m2')]
      await start(receiver, client)

      expect(receiver.records().map(r => r.messageId)).toEqual(['m2', 'm1'])
      await receiver.stop()
    })

    it('treats a busy or switching wallet as no failure: the payment waits for the next listing', async () => {
      const client = fakeClient([payment('m1')])
      setHttpBridgePaused(true)
      const receiver = new MessageBoxAutoReceiver()
      await start(receiver, client)

      expect(client.acceptPayment).not.toHaveBeenCalled()
      expect(receiver.records()).toEqual([])
      expect(client.inbox).toHaveLength(1)

      setHttpBridgePaused(false)
      window.dispatchEvent(new Event('focus'))
      await vi.waitFor(() => expect(receiver.records()).toEqual([expect.objectContaining({ messageId: 'm1', status: 'received' })]))
      await receiver.stop()
    })

    it('releases the wallet when an accept hangs, leaves no failure, and records it if it finishes later (desktop review finding 3)', async () => {
      vi.useFakeTimers()
      try {
        const client = fakeClient([payment('m1', 900)])
        const gate = deferred()
        client.acceptPayment.mockImplementationOnce(async () => { await gate.promise; client.inbox = [] })
        const receiver = new MessageBoxAutoReceiver()
        const started = start(receiver, client)
        await vi.advanceTimersByTimeAsync(0)
        expect(activeUserWalletOperations()).toBe(1)

        await vi.advanceTimersByTimeAsync(CALL_MS)
        await started
        expect(activeUserWalletOperations()).toBe(0) // Lock or a switch can go ahead
        expect(receiver.records()).toEqual([])

        // Still running: a new listing does not start it twice.
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(0)
        expect(client.acceptPayment).toHaveBeenCalledTimes(1)

        gate.resolve()
        await vi.advanceTimersByTimeAsync(0)
        expect(receiver.records()).toEqual([expect.objectContaining({ messageId: 'm1', status: 'received', amount: 900 })])
        expect(announced()).toHaveLength(1)
        await receiver.stop()
      } finally { vi.useRealTimers() }
    })

    it('gives up on a listing that hangs, so the next one runs', async () => {
      vi.useFakeTimers()
      try {
        const client = fakeClient([payment('m1')])
        client.listIncomingPayments.mockImplementationOnce(() => new Promise(() => {}))
        const receiver = new MessageBoxAutoReceiver()
        const started = start(receiver, client)
        await vi.advanceTimersByTimeAsync(CALL_MS)
        await started
        expect(receiver.records()).toEqual([])

        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(0)
        expect(receiver.records()).toEqual([expect.objectContaining({ messageId: 'm1', status: 'received' })])
        await receiver.stop()
      } finally { vi.useRealTimers() }
    })

    it('leaves the direct-pay busy message to direct-pay retries', () => {
      const releaseReceive = beginBackgroundWalletOperation('messagebox-receive')
      const releaseRetry = beginBackgroundWalletOperation()
      expect(walletChangeBlocker('x')).toBe(BACKGROUND_RETRY_BUSY)
      releaseRetry()
      expect(walletChangeBlocker('x')).toBe(MESSAGEBOX_RECEIVE_BUSY)
      releaseReceive()
      expect(walletChangeBlocker('x')).toBe('')
    })
  })
})
