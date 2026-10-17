import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LockingScript, MerklePath, OP, P2PKH, PrivateKey, ProtoWallet, PublicKey, Random, Transaction, UnlockingScript, Utils } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'
import { createMemoryHub, DirectPayClient, paymentKey, WebRTPayError } from '@bsv/webrtpay'
import type { AuthenticatedPeer, IncomingPayment, InboundLimits, MemoryHub } from '@bsv/webrtpay'
import { createSeenStore, deliverDirect, receiveDirectPayment, retryReceivedDirectPayments } from '../src/lib/pages/Dashboard/Payments/directPayments'
import { prepareMessageBoxPayment } from '../src/lib/pages/Dashboard/Payments/messageBoxPayments'
import type { OutgoingPayment } from '../src/lib/pages/Dashboard/Payments/messageBoxPayments'

const ORIGIN = 'admin.test'
const CHAIN = 'test'

// ---- localStorage (renderer) -------------------------------------------------------------

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
})

const stored = (key: string): any[] => JSON.parse(local.get(key) ?? '[]')
const retries = (identity: string) => stored(`direct-pay-retry-v1:${identity}:${CHAIN}`)
const seenKeys = (identity: string) => stored(`direct-pay-seen-v1:${identity}:${CHAIN}`)

// ---- wallets and transactions ------------------------------------------------------------

/**
 * Atomic BEEF paying `satoshis` to `lockingScript` at output 0, built without a network: the
 * parent is the only transaction in its block, so a single-leaf MerklePath proves it.
 */
function paymentBeef(lockingScript: string, satoshis: number, padBytes = 0): { tx: number[]; txid: string } {
  const parent = new Transaction()
  parent.addInput({ sourceTXID: '00'.repeat(32), sourceOutputIndex: 0xffffffff, unlockingScript: new UnlockingScript() })
  parent.addOutput({ lockingScript: new P2PKH().lock(PrivateKey.fromRandom().toPublicKey().toHash()), satoshis: satoshis + 1000 })
  parent.merklePath = MerklePath.fromCoinbaseTxidAndHeight(parent.id('hex'), 1)
  const child = new Transaction()
  child.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScript: new UnlockingScript() })
  child.addOutput({ lockingScript: LockingScript.fromHex(lockingScript), satoshis })
  if (padBytes > 0) child.addOutput({ lockingScript: new LockingScript().writeOpCode(OP.OP_FALSE).writeOpCode(OP.OP_RETURN).writeBin(new Array(padBytes).fill(7)), satoshis: 0 })
  return { tx: child.toAtomicBEEF(), txid: child.id('hex') }
}

const txidOf = (tx: number[]) => Transaction.fromAtomicBEEF(tx).id('hex')

interface Payer {
  wallet: WalletInterface
  identityKey: string
  createAction: ReturnType<typeof vi.fn>
  signAction: ReturnType<typeof vi.fn>
  abortAction: ReturnType<typeof vi.fn>
  /** createAction calls that built a new transaction (not the sendWith broadcast). */
  created: () => number
}

/** A ProtoWallet (real keys and encryption) whose createAction/signAction build a local payment. */
async function makePayer(): Promise<Payer> {
  const built: { tx: number[]; txid: string }[] = []
  const createAction = vi.fn(async (args: any) => {
    if (args.options?.sendWith) return { sendWithResults: args.options.sendWith.map((txid: string) => ({ txid, status: 'unproven' })) }
    const output = args.outputs[0]
    built.push(paymentBeef(output.lockingScript, output.satoshis))
    return { signableTransaction: { reference: String(built.length - 1), tx: built[built.length - 1].tx } }
  })
  const signAction = vi.fn(async (args: any) => built[Number(args.reference)])
  const abortAction = vi.fn(async () => ({ aborted: true }))
  const wallet = Object.assign(new ProtoWallet(PrivateKey.fromRandom()), { createAction, signAction, abortAction }) as unknown as WalletInterface
  const { publicKey } = await wallet.getPublicKey({ identityKey: true })
  return { wallet, identityKey: publicKey, createAction, signAction, abortAction, created: () => createAction.mock.calls.filter(([args]) => !args.options?.sendWith).length }
}

interface Payee {
  wallet: WalletInterface
  identityKey: string
  internalizeAction: ReturnType<typeof vi.fn>
}

async function makePayee(): Promise<Payee> {
  const internalizeAction = vi.fn(async (_args: any, _originator?: string) => ({ accepted: true }))
  const wallet = Object.assign(new ProtoWallet(PrivateKey.fromRandom()), { internalizeAction }) as unknown as WalletInterface
  const { publicKey } = await wallet.getPublicKey({ identityKey: true })
  return { wallet, identityKey: publicKey, internalizeAction }
}

/** A payment from `payer` to `payee` exactly as a payer wallet builds it (BRC-29 derived output 0). */
async function incoming(payer: Payer, payee: Payee, amount = 1000, padBytes = 0): Promise<IncomingPayment> {
  const derivationPrefix = Utils.toBase64(Random(16)), derivationSuffix = Utils.toBase64(Random(16))
  const { publicKey } = await payer.wallet.getPublicKey({ protocolID: [2, '3241645161d8'], keyID: `${derivationPrefix} ${derivationSuffix}`, counterparty: payee.identityKey })
  const { tx } = paymentBeef(new P2PKH().lock(PublicKey.fromString(publicKey).toHash()).toHex(), amount, padBytes)
  return { messageId: Utils.toHex(Random(8)), sender: payer.identityKey, token: { customInstructions: { derivationPrefix, derivationSuffix }, transaction: tx, amount, outputIndex: 0 } }
}

const keyOf = (p: IncomingPayment) => paymentKey(txidOf(p.token.transaction), 0, p.token.customInstructions.derivationPrefix, p.token.customInstructions.derivationSuffix)

const receive = (payee: Payee, payment: IncomingPayment) =>
  receiveDirectPayment({ wallet: payee.wallet, originator: ORIGIN, identity: payee.identityKey, chain: CHAIN, payment })

const retry = (payee: Payee) =>
  retryReceivedDirectPayments({ wallet: payee.wallet, originator: ORIGIN, identity: payee.identityKey, chain: CHAIN })

/** An error shaped like the wallet-toolbox / SDK WERR_* classes (they set `name`). */
const werr = (name: string, message: string) => Object.assign(new Error(message), { name })

// ---- real WebRTC peers (node-datachannel, loopback only: the sandbox drops other UDP) -----

let RTCPeerConnection: typeof globalThis.RTCPeerConnection
beforeAll(async () => {
  RTCPeerConnection = (await import('node-datachannel/polyfill')).RTCPeerConnection as unknown as typeof globalThis.RTCPeerConnection
})
afterAll(async () => {
  (await import('node-datachannel')).cleanup()
})

const clients: DirectPayClient[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()))
})

function client(hub: MemoryHub, party: { wallet: WalletInterface; identityKey: string }, limits?: Partial<InboundLimits>): DirectPayClient {
  const c = new DirectPayClient({
    limits,
    wallet: party.wallet,
    originator: ORIGIN,
    signaler: hub.signaler(party.identityKey),
    chain: CHAIN,
    rtc: { RTCPeerConnection, iceServers: [], extraConfig: { bindAddress: '127.0.0.1' } },
    timeouts: { connectMs: 10_000, ackMs: 10_000 }
  })
  clients.push(c)
  return c
}

/** The payee's wallet listening with the desktop receive flow. */
async function receiving(hub: MemoryHub, payee: Payee, limits?: Partial<InboundLimits>): Promise<DirectPayClient> {
  const c = client(hub, payee, limits)
  await c.startReceiving({ onPayment: p => receive(payee, p) })
  return c
}

/** Resolves once `peer` is closed; fails if that takes longer than a moment (the payee's idle timeout is 60 s). */
function closedSoon(peer: AuthenticatedPeer, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The peer was left open')), ms)
    peer.onClose(() => { clearTimeout(timer); resolve() })
  })
}

function outbox() {
  const order: string[] = []
  const rows: OutgoingPayment[] = []
  return {
    order,
    rows,
    persist: vi.fn((row: OutgoingPayment) => { order.push('persist'); rows.push(row) }),
    markDelivered: vi.fn((txid: string) => { order.push(`delivered ${txid}`) })
  }
}

describe('deliverDirect', () => {
  it('deliverDirect does not call createAction when connect fails', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee() // the payee's wallet is not running
    const box = outbox()
    await expect(deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 1500, persist: box.persist, markDelivered: box.markDelivered }))
      .rejects.toThrow(/Nothing was spent.*message box/i)
    expect(payer.createAction).not.toHaveBeenCalled()
    expect(payer.signAction).not.toHaveBeenCalled()
    expect(box.persist).not.toHaveBeenCalled()
    expect(box.markDelivered).not.toHaveBeenCalled()
  })

  it('spends nothing when the recipient refuses the connection', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    await receiving(hub, payee, { offersPerMinutePerSender: 1 })
    const payerClient = client(hub, payer)
    ;(await payerClient.connect(payee.identityKey)).close() // uses up this payer's one offer
    const box = outbox()
    await expect(deliverDirect({ client: payerClient, wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 1500, persist: box.persist, markDelivered: box.markDelivered }))
      .rejects.toThrow(/not taking direct payments right now\. Nothing was spent/)
    expect(payer.createAction).not.toHaveBeenCalled()
  })

  it('says a saved payment is unchanged, not that nothing was spent, when it cannot be redelivered', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    const existing = await prepareMessageBoxPayment(payer.wallet, payee.identityKey, 2500, ORIGIN, undefined, () => {})
    payer.createAction.mockClear()
    const box = outbox()
    const error = await deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 2500, existing, persist: box.persist, markDelivered: box.markDelivered }).catch(e => e)
    expect(error.message).toMatch(/saved payment is unchanged.*message box/)
    expect(error.message).not.toMatch(/Nothing was spent/)
    expect(payer.createAction).not.toHaveBeenCalled()
  })

  it('connects, persists the row with via direct before sending, and marks it delivered on accepted', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    await receiving(hub, payee)
    const payerClient = client(hub, payer)
    const box = outbox()
    const send = vi.spyOn(payerClient, 'sendPayment')
    send.mockImplementation(async (...args) => {
      box.order.push('send')
      return DirectPayClient.prototype.sendPayment.apply(payerClient, args)
    })

    const { payment, ack } = await deliverDirect({ client: payerClient, wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 1500, persist: box.persist, markDelivered: box.markDelivered })

    expect(ack).toMatchObject({ status: 'accepted', txid: payment.txid })
    expect(payment).toMatchObject({ recipient: payee.identityKey, amount: 1500, delivered: false, via: 'direct' })
    expect(box.rows).toEqual([payment])
    expect(box.order).toEqual(['persist', 'send', `delivered ${payment.txid}`])
    expect(payer.created()).toBe(1)
    expect(payer.createAction).toHaveBeenCalledWith(expect.objectContaining({ options: { sendWith: [payment.txid] } }), ORIGIN)
    expect(payee.internalizeAction).toHaveBeenCalledTimes(1)
    const [args, originator] = payee.internalizeAction.mock.calls[0]
    expect(originator).toBe(ORIGIN)
    expect(txidOf(args.tx)).toBe(payment.txid)
    expect(args.outputs).toEqual([{ outputIndex: 0, protocol: 'wallet payment', paymentRemittance: { senderIdentityKey: payer.identityKey, ...payment.token.customInstructions } }])
    expect(seenKeys(payee.identityKey)).toHaveLength(1)
    expect(retries(payee.identityKey)).toEqual([])
  })

  it('redelivers an existing row with the same transaction and creates none', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    await receiving(hub, payee)
    const existing = await prepareMessageBoxPayment(payer.wallet, payee.identityKey, 2500, ORIGIN, undefined, () => {})
    payer.createAction.mockClear(); payer.signAction.mockClear()
    const box = outbox()

    const { payment, ack } = await deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 2500, existing, persist: box.persist, markDelivered: box.markDelivered })

    expect(payment).toBe(existing)
    expect(ack).toMatchObject({ status: 'accepted', txid: existing.txid })
    expect(payer.created()).toBe(0)
    expect(payer.signAction).not.toHaveBeenCalled()
    expect(box.persist).not.toHaveBeenCalled()
    expect(box.markDelivered).toHaveBeenCalledWith(existing.txid)
    expect(txidOf(payee.internalizeAction.mock.calls[0][0].tx)).toBe(existing.txid)
  })

  it('refuses an invalid amount or a saved row for another recipient before connecting', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee(), other = await makePayee()
    await receiving(hub, payee)
    const existing = await prepareMessageBoxPayment(payer.wallet, other.identityKey, 2500, ORIGIN, undefined, () => {})
    payer.createAction.mockClear()
    const payerClient = client(hub, payer)
    const connect = vi.spyOn(payerClient, 'connect')
    const box = outbox()
    await expect(deliverDirect({ client: payerClient, wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 2500, existing, persist: box.persist, markDelivered: box.markDelivered }))
      .rejects.toThrow(/another recipient/)
    await expect(deliverDirect({ client: payerClient, wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 0, persist: box.persist, markDelivered: box.markDelivered }))
      .rejects.toThrow(/positive amount/)
    expect(connect).not.toHaveBeenCalled()
    expect(payer.createAction).not.toHaveBeenCalled()
  })

  it('uses a peer that is already connected, and refuses one that is not the recipient', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee(), other = await makePayee()
    await receiving(hub, payee)
    const payerClient = client(hub, payer)
    const connect = vi.spyOn(payerClient, 'connect')
    const box = outbox()

    const wrongPeer = await payerClient.connect(payee.identityKey)
    await expect(deliverDirect({ client: payerClient, wallet: payer.wallet, originator: ORIGIN, recipient: other.identityKey, amount: 700, peer: wrongPeer, persist: box.persist, markDelivered: box.markDelivered }))
      .rejects.toThrow(/not the recipient/)
    await closedSoon(wrongPeer)
    expect(payer.createAction).not.toHaveBeenCalled()

    const peer = await payerClient.connect(payee.identityKey)
    const { ack } = await deliverDirect({ client: payerClient, wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 700, peer, persist: box.persist, markDelivered: box.markDelivered })
    expect(ack.status).toBe('accepted')
    expect(connect).toHaveBeenCalledTimes(2) // only the test's own dials
    await closedSoon(peer)
  })

  it('closes the connection and saves nothing when the payment cannot be prepared', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    payer.createAction.mockRejectedValueOnce(werr('WERR_INSUFFICIENT_FUNDS', 'Insufficient funds in the available inputs.'))
    await receiving(hub, payee)
    const payerClient = client(hub, payer)
    const connect = vi.spyOn(payerClient, 'connect')
    const box = outbox()
    await expect(deliverDirect({ client: payerClient, wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 700, persist: box.persist, markDelivered: box.markDelivered }))
      .rejects.toThrow('Insufficient funds')
    await closedSoon(await connect.mock.results[0].value)
    expect(box.persist).not.toHaveBeenCalled()
    expect(payee.internalizeAction).not.toHaveBeenCalled()
  })

  it('keeps the row pending and reports the reason when the recipient rejects the payment', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(werr('WERR_INVALID_PARAMETER', 'The tx parameter must be valid AtomicBEEF'))
    await receiving(hub, payee)
    const box = outbox()
    await expect(deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 900, persist: box.persist, markDelivered: box.markDelivered }))
      .rejects.toThrow(/^The recipient rejected this payment: \S/)
    expect(box.rows).toHaveLength(1)
    expect(box.markDelivered).not.toHaveBeenCalled()
    expect(retries(payee.identityKey)).toEqual([])
    expect(seenKeys(payee.identityKey)).toEqual([])
  })

  it('keeps the row pending with a clear error when the recipient drops before acking', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    const payeeClient = client(hub, payee)
    await payeeClient.startReceiving({ onPayment: async () => { await payeeClient.close(); return 'accepted' } })
    const box = outbox()
    const started = Date.now()
    await expect(deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 800, persist: box.persist, markDelivered: box.markDelivered }))
      .rejects.toThrow(/did not confirm the payment.*Retry delivery directly or through the message box/)
    expect(Date.now() - started).toBeLessThan(5000) // the close, not the 10 s ack timeout
    expect(box.rows).toHaveLength(1)
    expect(box.markDelivered).not.toHaveBeenCalled()
  })

  it('acks received when internalize fails transiently, and a later retry adds the payment', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValueOnce(new Error('User is not authenticated.'))
    await receiving(hub, payee)
    const box = outbox()

    const { payment, ack } = await deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 1200, persist: box.persist, markDelivered: box.markDelivered })

    expect(ack).toMatchObject({ status: 'received', txid: payment.txid })
    expect(box.markDelivered).toHaveBeenCalledWith(payment.txid)
    const [entry] = retries(payee.identityKey)
    expect(retries(payee.identityKey)).toHaveLength(1)
    expect(entry).toMatchObject({ error: 'User is not authenticated.', payment: { sender: payer.identityKey } })
    expect(seenKeys(payee.identityKey)).toEqual([])

    await expect(retry(payee)).resolves.toBe(1)
    expect(payee.internalizeAction).toHaveBeenCalledTimes(2)
    const [args] = payee.internalizeAction.mock.calls[1]
    expect(txidOf(args.tx)).toBe(payment.txid)
    expect(args.outputs[0].paymentRemittance).toEqual({ senderIdentityKey: payer.identityKey, ...payment.token.customInstructions })
    expect(retries(payee.identityKey)).toEqual([])
    expect(seenKeys(payee.identityKey)).toHaveLength(1)
  })
})

describe('receiveDirectPayment', () => {
  it('internalizes once and acks a repeated delivery as accepted without a second internalize', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const payment = await incoming(payer, payee)
    await expect(receive(payee, payment)).resolves.toBe('accepted')
    await expect(receive(payee, { ...payment, messageId: 'again' })).resolves.toBe('accepted')
    expect(payee.internalizeAction).toHaveBeenCalledTimes(1)
    expect(seenKeys(payee.identityKey)).toEqual([keyOf(payment)])
  })

  it('rethrows invalid_payment and stores nothing for a payment that does not pay this wallet', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const payment = await incoming(payer, payee, 1000)
    const error = await receive(payee, { ...payment, token: { ...payment.token, amount: 999 } }).catch(e => e)
    expect(error).toBeInstanceOf(WebRTPayError)
    expect(error.code).toBe('invalid_payment')
    expect(payee.internalizeAction).not.toHaveBeenCalled()
    expect(local.size).toBe(0)
  })

  it.each([
    ['the wallet is locked', new Error('User is not authenticated.')],
    ['storage IPC failed', new Error('Storage method internalizeAction failed: SQLITE_BUSY: database is locked')],
    ['storage is not ready', new Error('Settings not available - call makeAvailable() first')],
    ['no active storage', werr('WERR_NOT_ACTIVE', "WalletStorageManager is not accessing user's active storage.")],
    ['the network is down', new TypeError('fetch failed')],
    ['a connection was refused', new Error('connect ECONNREFUSED 127.0.0.1:443')]
  ])('keeps the payment for retry and acks received when %s', async (_, failure) => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(failure)
    const payment = await incoming(payer, payee)
    await expect(receive(payee, payment)).resolves.toBe('received')
    expect(retries(payee.identityKey)).toEqual([expect.objectContaining({ key: keyOf(payment), error: failure.message })])
  })

  it.each([
    ['an invalid BEEF', werr('WERR_INVALID_PARAMETER', 'The tx parameter must be valid AtomicBEEF')],
    ['a missing argument', werr('WERR_MISSING_PARAMETER', 'The required tx parameter is missing.')],
    ['a bad merkle root', werr('WERR_INVALID_MERKLE_ROOT', 'Invalid merkleRoot 00 for block 00 at height 1.')],
    ['a storage validation error', new Error('Storage method internalizeAction failed: The tx parameter must be valid AtomicBEEF')],
    ['a refusal', new Error('The wallet did not accept the payment')],
    ['an unknown failure', new Error('Something unexpected')]
  ])('rejects and stores nothing for %s', async (_, failure) => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(failure)
    const error = await receive(payee, await incoming(payer, payee)).catch(e => e)
    expect(error).toBeInstanceOf(WebRTPayError)
    expect(error.message).not.toContain(failure.message) // the peer learns nothing about this wallet's internals
    expect(error.cause).toBe(failure)
    expect(local.size).toBe(0)
  })

  it('keeps one retry entry per payment however often it is redelivered', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(new Error('User is not authenticated.'))
    const payment = await incoming(payer, payee)
    await receive(payee, payment)
    await receive(payee, { ...payment, messageId: 'again' })
    expect(retries(payee.identityKey)).toHaveLength(1)
  })

  it('removes the retry entry when a redelivery succeeds', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValueOnce(new Error('User is not authenticated.'))
    const payment = await incoming(payer, payee)
    await expect(receive(payee, payment)).resolves.toBe('received')
    await expect(receive(payee, payment)).resolves.toBe('accepted')
    expect(retries(payee.identityKey)).toEqual([])
  })

  it('refuses new payments once 50 are waiting, and never drops one it acknowledged', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(new Error('User is not authenticated.'))
    const kept: string[] = []
    for (let i = 0; i < 50; i++) {
      const payment = await incoming(payer, payee)
      await expect(receive(payee, payment)).resolves.toBe('received')
      kept.push(keyOf(payment))
    }
    const error = await receive(payee, await incoming(payer, payee)).catch(e => e)
    expect(error).toBeInstanceOf(WebRTPayError)
    expect(retries(payee.identityKey).map(entry => entry.key)).toEqual(kept)
  })

  it('refuses rather than acks received when the retry list cannot be written', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(new Error('User is not authenticated.'))
    setItem = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') }
    const error = await receive(payee, await incoming(payer, payee)).catch(e => e)
    expect(error).toBeInstanceOf(WebRTPayError)
    expect(error.message).toMatch(/try again later/i)
  })

  it('refuses a payment too large to keep within the retry budget', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(new Error('User is not authenticated.'))
    const huge = await incoming(payer, payee, 1000, 800_000) // about 1.07 million base64 characters
    const error = await receive(payee, huge).catch(e => e)
    expect(error).toBeInstanceOf(WebRTPayError)
    expect(retries(payee.identityKey)).toEqual([])
  })

  it('still acks accepted when the idempotency record cannot be saved', async () => {
    const payer = await makePayer(), payee = await makePayee()
    setItem = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') }
    await expect(receive(payee, await incoming(payer, payee))).resolves.toBe('accepted')
  })
})

describe('retryReceivedDirectPayments', () => {
  it('adds what the wallet now accepts, keeps transient failures and drops payments it refuses', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const [ok, later, bad] = [await incoming(payer, payee), await incoming(payer, payee), await incoming(payer, payee)]
    payee.internalizeAction.mockRejectedValue(new Error('User is not authenticated.'))
    for (const payment of [ok, later, bad]) await receive(payee, payment)
    expect(retries(payee.identityKey)).toHaveLength(3)

    payee.internalizeAction.mockReset()
    payee.internalizeAction
      .mockResolvedValueOnce({ accepted: true })
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(werr('WERR_INVALID_PARAMETER', 'The tx parameter must be valid AtomicBEEF'))
    await expect(retry(payee)).resolves.toBe(1)
    expect(retries(payee.identityKey)).toEqual([expect.objectContaining({ key: keyOf(later) })])
    expect(seenKeys(payee.identityKey)).toEqual([keyOf(ok)])
  })

  it('returns 0 when nothing is waiting or the stored list is unreadable', async () => {
    const payee = await makePayee()
    await expect(retry(payee)).resolves.toBe(0)
    local.set(`direct-pay-retry-v1:${payee.identityKey}:${CHAIN}`, '{not json')
    await expect(retry(payee)).resolves.toBe(0)
    expect(payee.internalizeAction).not.toHaveBeenCalled()
  })
})

describe('createSeenStore', () => {
  it('remembers payment keys per identity and network, capped at the newest 5000', async () => {
    const seen = createSeenStore('id', CHAIN)
    local.set(`direct-pay-seen-v1:id:${CHAIN}`, JSON.stringify(Array.from({ length: 5000 }, (_, i) => `k${i}`)))
    expect(await seen.has('k0')).toBe(true)
    await seen.add('new')
    expect(await seen.has('new')).toBe(true)
    expect(await seen.has('k0')).toBe(false)
    expect(await seen.has('k1')).toBe(true)
    expect(stored(`direct-pay-seen-v1:id:${CHAIN}`)).toHaveLength(5000)
    expect(await createSeenStore('id', 'main').has('new')).toBe(false)
    expect(await createSeenStore('other', CHAIN).has('new')).toBe(false)
  })

  it('treats unreadable storage as empty and never throws on add', async () => {
    local.set(`direct-pay-seen-v1:id:${CHAIN}`, '{not json')
    const seen = createSeenStore('id', CHAIN)
    expect(await seen.has('k')).toBe(false)
    setItem = () => { throw new Error('quota') }
    expect(() => seen.add('k')).not.toThrow()
  })
})
