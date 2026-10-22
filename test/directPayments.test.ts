import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LockingScript, MerklePath, OP, P2PKH, PrivateKey, ProtoWallet, PublicKey, Random, Transaction, UnlockingScript, Utils } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'
import { createMemoryHub, DirectPayClient, MAX_DIRECT_TRANSACTION_BYTES, paymentKey, WebRTPayError } from '@bsv/webrtpay'
import { sdk as WalletToolboxSdk } from '@bsv/wallet-toolbox-client'
import type { AuthenticatedPeer, IncomingPayment, InboundLimits, MemoryHub } from '@bsv/webrtpay'
import { createSeenStore, deliverDirect, dialFailure, DIRECT_DESCRIPTION, dismissKeptDirectPayment, keepDirectPayment, keptDirectPaymentsOnDevice, keptTowardLimit, listKeptDirectPayments, NotSentError, receiveDirectPayment, retryReceivedDirectPayments, RetryStopped, subscribeKeptDirectPayments } from '../src/lib/pages/Dashboard/Payments/directPayments'
import type { KeptDirectPaymentInfo } from '../src/lib/pages/Dashboard/Payments/directPayments'
import { prepareMessageBoxPayment } from '../src/lib/pages/Dashboard/Payments/messageBoxPayments'
import { MAX_LIVE_TRANSACTION_BYTES } from '../src/lib/utils/directPaySettings'
import type { OutgoingPayment } from '../src/lib/pages/Dashboard/Payments/messageBoxPayments'
import { addToOutbox, outboxStorageKey } from '../src/lib/pages/Dashboard/Payments/outbox'

const ORIGIN = 'admin.test'
const CHAIN = 'test'

// ---- localStorage (renderer) -------------------------------------------------------------

let local: Map<string, string>
let setItem: (key: string, value: string) => void

beforeEach(() => {
  local = new Map()
  setItem = (key, value) => { local.set(key, value) }
  vi.stubGlobal('localStorage', {
    get length() { return local.size },
    key: (i: number) => [...local.keys()][i] ?? null,
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

const retry = (payee: Payee, onNeedsAttention: (kept: KeptDirectPaymentInfo) => void = vi.fn(), includeNeedsAttention = true) =>
  retryReceivedDirectPayments({ wallet: payee.wallet, originator: ORIGIN, identity: payee.identityKey, chain: CHAIN, onNeedsAttention, includeNeedsAttention })

/** An error shaped like the wallet-toolbox / SDK WERR_* classes (they set `name`). */
const werr = (name: string, message: string) => Object.assign(new Error(message), { name })
/** What Wallet Toolbox's internalizeAction throws when its post of the payment fails. */
const reviewActions = (...statuses: Array<'serviceError' | 'doubleSpend' | 'invalidTx'>) =>
  new WalletToolboxSdk.WERR_REVIEW_ACTIONS(statuses.map(status => ({ txid: '00'.repeat(32), status })), [{ txid: '00'.repeat(32), status: 'failed' }], '00'.repeat(32))

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

function client(hub: MemoryHub, party: { wallet: WalletInterface; identityKey: string }, limits?: Partial<InboundLimits>, chain = CHAIN): DirectPayClient {
  const c = new DirectPayClient({
    limits,
    wallet: party.wallet,
    originator: ORIGIN,
    signaler: hub.signaler(party.identityKey),
    chain,
    rtc: { RTCPeerConnection, iceServers: [], extraConfig: { bindAddress: '127.0.0.1' } },
    timeouts: { connectMs: 10_000, ackMs: 10_000 }
  })
  clients.push(c)
  return c
}

/** The payee's wallet listening with the desktop receive flow. */
async function receiving(hub: MemoryHub, payee: Payee, limits?: Partial<InboundLimits>, chain = CHAIN): Promise<DirectPayClient> {
  const c = client(hub, payee, limits, chain)
  await c.startReceiving({ onPayment: async p => (await receive(payee, p)).status })
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

describe('dialFailure', () => {
  it('dialFailure maps each webrtpay code', () => {
    expect(dialFailure(new WebRTPayError('peer_unreachable'))).toBe('offline')
    expect(dialFailure(new WebRTPayError('rejected', 'no', { reason: 'not_receiving' }))).toBe('not_receiving')
    expect(dialFailure(new WebRTPayError('rejected', 'no', { reason: 'busy' }))).toBe('not_receiving')
    expect(dialFailure(new WebRTPayError('rejected', 'no', { reason: 'wrong_network' }))).toBe('wrong_network')
    expect(dialFailure(new WebRTPayError('rejected', 'no', { reason: 'something else' }))).toBe('link_failed')
    expect(dialFailure(new WebRTPayError('unavailable'))).toBe('network')
    for (const code of ['timeout', 'closed', 'auth_failed', 'protocol', 'unsupported', 'rate_limited'] as const) expect(dialFailure(new WebRTPayError(code))).toBe('link_failed')
    expect(dialFailure(new Error('boom'))).toBe('link_failed')
  })
})

describe('deliverDirect dial failures', () => {
  const failingClient = (error: unknown) => ({ connect: vi.fn(async () => { throw error }) }) as unknown as DirectPayClient & { connect: ReturnType<typeof vi.fn> }

  it('deliverDirect throws NotSentError with failure offline when connect rejects peer_unreachable', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const box = outbox()
    const c = failingClient(new WebRTPayError('peer_unreachable'))
    const controller = new AbortController()
    const error = await deliverDirect({ client: c, wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 1500, persist: box.persist, markDelivered: box.markDelivered, signal: controller.signal }).catch(e => e)
    expect(error).toBeInstanceOf(NotSentError)
    expect(error.failure).toBe('offline')
    expect(c.connect).toHaveBeenCalledWith(payee.identityKey, { signal: controller.signal })
    expect(payer.createAction).not.toHaveBeenCalled()
    expect(box.persist).not.toHaveBeenCalled()
  })

  it('classifies a refusal, a network failure and a broken link, spending nothing', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const cases: Array<[unknown, string, RegExp]> = [
      [new WebRTPayError('rejected', 'no', { reason: 'not_receiving' }), 'not_receiving', /not taking direct payments right now\. Nothing was spent/],
      [new WebRTPayError('unavailable'), 'network', /^Couldn't reach the payment network — check your connection\. Nothing was spent\.$/],
      [new WebRTPayError('timeout'), 'link_failed', /could not be reached directly\. Nothing was spent/]
    ]
    for (const [cause, failure, message] of cases) {
      const box = outbox()
      const error = await deliverDirect({ client: failingClient(cause), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 1500, persist: box.persist, markDelivered: box.markDelivered }).catch(e => e)
      expect(error).toBeInstanceOf(NotSentError)
      expect(error.failure).toBe(failure)
      expect(error.message).toMatch(message)
      expect(box.persist).not.toHaveBeenCalled()
    }
    expect(payer.createAction).not.toHaveBeenCalled()
  })

  it('makes nothing when the dial was cancelled after it connected', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const controller = new AbortController()
    const close = vi.fn()
    const c = { connect: vi.fn(async () => { controller.abort(); return { peerIdentityKey: payee.identityKey, isOpen: true, close } }) } as unknown as DirectPayClient
    const box = outbox()
    const error = await deliverDirect({ client: c, wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 1500, persist: box.persist, markDelivered: box.markDelivered, signal: controller.signal }).catch(e => e)
    expect(error).toBeInstanceOf(NotSentError)
    expect(error.message).toBe('Cancelled. Nothing was spent.')
    expect(close).toHaveBeenCalled()
    expect(payer.createAction).not.toHaveBeenCalled()
  })
})

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
    const payer = await makePayer(), payee = await makePayee(), earlier = await makePayer()
    // A payee over its overall limits answers `busy`. (A sender over its own limits gets no
    // answer at all, which reads as unreachable.)
    await receiving(hub, payee, { offersPerMinute: 1 })
    ;(await client(hub, earlier).connect(payee.identityKey)).close() // uses up the payee's one offer
    const payerClient = client(hub, payer)
    const box = outbox()
    await expect(deliverDirect({ client: payerClient, wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 1500, persist: box.persist, markDelivered: box.markDelivered }))
      .rejects.toThrow(/not taking direct payments right now\. Nothing was spent/)
    expect(payer.createAction).not.toHaveBeenCalled()
  })

  // Final review D2: the payee's wallet refuses a dial from another network before connecting.
  it('spends nothing when the recipient\'s wallet is on another network, and says so', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    await receiving(hub, payee, undefined, 'main')
    const box = outbox()
    const error = await deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 1500, persist: box.persist, markDelivered: box.markDelivered }).catch(e => e)
    expect(error).toBeInstanceOf(NotSentError)
    expect(error.message).toBe("The recipient's wallet is on a different network. Nothing was spent.")
    expect(payer.createAction).not.toHaveBeenCalled()
    expect(box.persist).not.toHaveBeenCalled()
    expect(payee.internalizeAction).not.toHaveBeenCalled()
  })

  it('leaves a saved payment unbroadcast when the recipient\'s wallet is on another network', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    await receiving(hub, payee, undefined, 'main')
    const box = outbox()
    const existing = await prepareMessageBoxPayment(payer.wallet, payee.identityKey, 2500, ORIGIN, undefined, () => {})
    payer.createAction.mockClear()
    const saved = await deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 2500, existing, persist: box.persist, markDelivered: box.markDelivered }).catch(e => e)
    expect(saved).toBeInstanceOf(NotSentError)
    expect(saved.message).toBe("The recipient's wallet is on a different network. Your saved payment is unchanged; deliver it when you are both on the same network, or through the message box.")
    expect(payer.createAction).not.toHaveBeenCalled() // not even broadcast
  })

  it('says a saved payment is unchanged, not that nothing was spent, when it cannot be redelivered', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    const existing = await prepareMessageBoxPayment(payer.wallet, payee.identityKey, 2500, ORIGIN, undefined, () => {})
    payer.createAction.mockClear()
    const box = outbox()
    const error = await deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 2500, existing, persist: box.persist, markDelivered: box.markDelivered }).catch(e => e)
    expect(error).toBeInstanceOf(NotSentError) // stopped before anything was broadcast
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

  // Final review M21: a later "Retry via message box" must go to the host the payee's link named.
  it('keeps the payment link\'s message box host on the saved row', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    await receiving(hub, payee)
    const box = outbox()
    const { payment } = await deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 900, host: 'https://box.example.com', persist: box.persist, markDelivered: box.markDelivered })
    expect(box.rows).toEqual([expect.objectContaining({ host: 'https://box.example.com', via: 'direct' })])
    expect(payment.host).toBe('https://box.example.com')
  })

  it('says a saved direct payment can be retried when it cannot be broadcast', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    await receiving(hub, payee)
    const existing = await prepareMessageBoxPayment(payer.wallet, payee.identityKey, 2500, ORIGIN, undefined, () => {})
    payer.createAction.mockImplementation(async (args: any) => ({ sendWithResults: args.options.sendWith.map((txid: string) => ({ txid, status: 'failed' })) }))
    const box = outbox()
    const error = await deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 2500, existing, persist: box.persist, markDelivered: box.markDelivered }).catch(e => e)
    expect(error.message).toBe('The payment could not be broadcast yet; retry when you are online. Retrying reuses the same transaction.')
    expect(error).not.toBeInstanceOf(NotSentError)
    expect(box.markDelivered).not.toHaveBeenCalled()
    expect(payee.internalizeAction).not.toHaveBeenCalled()
  })

  // Final review M18, end to end: the save is refused, so the payment is released, not broadcast.
  it('releases the payment and broadcasts nothing when the saved payments on this device cannot be read', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    await receiving(hub, payee)
    const key = outboxStorageKey(payer.identityKey, CHAIN)
    local.set(key, '{not json')
    const error = await deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 700, persist: row => { addToOutbox(key, row) }, markDelivered: vi.fn() }).catch(e => e)
    expect(error.message).toBe('Saved payments on this device could not be read, so this payment was not saved, and nothing was spent. Check Activity before sending again.')
    expect(payer.abortAction).toHaveBeenCalledOnce()
    expect(payer.createAction.mock.calls.some(([args]) => args.options?.sendWith)).toBe(false)
    expect(local.get(key)).toBe('{not json')
    expect(payee.internalizeAction).not.toHaveBeenCalled()
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
    await receiving(hub, other)
    const payerClient = client(hub, payer)
    const connect = vi.spyOn(payerClient, 'connect')
    const box = outbox()

    const wrongPeer = await payerClient.connect(payee.identityKey)
    await expect(deliverDirect({ client: payerClient, wallet: payer.wallet, originator: ORIGIN, recipient: other.identityKey, amount: 700, peer: wrongPeer, persist: box.persist, markDelivered: box.markDelivered }))
      .rejects.toThrow(/not the recipient/)
    await closedSoon(wrongPeer)
    expect(payer.createAction).not.toHaveBeenCalled()

    // Another payee: `payee` keeps this sender's one session until it notices the close, and
    // drops a second offer from it without an answer until then.
    const peer = await payerClient.connect(other.identityKey)
    const { ack } = await deliverDirect({ client: payerClient, wallet: payer.wallet, originator: ORIGIN, recipient: other.identityKey, amount: 700, peer, persist: box.persist, markDelivered: box.markDelivered })
    expect(ack.status).toBe('accepted')
    expect(connect).toHaveBeenCalledTimes(2) // only the test's own dials
    await closedSoon(peer)
  })

  // The payee checks the token, its size and the session only after the payer broadcast: the
  // payer checks them first, so a payment that would be refused is never broadcast.
  it('refuses a saved payment the recipient would reject, before broadcasting it', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    await receiving(hub, payee)
    const saved = await prepareMessageBoxPayment(payer.wallet, payee.identityKey, 2500, ORIGIN, undefined, () => {})
    payer.createAction.mockClear()
    const existing = { ...saved, token: { ...saved.token, customInstructions: { ...saved.token.customInstructions, derivationPrefix: 'not base64!' } } }
    const box = outbox()
    const error = await deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 2500, existing, persist: box.persist, markDelivered: box.markDelivered }).catch(e => e)
    expect(error).toBeInstanceOf(NotSentError)
    expect(error.message).toMatch(/^The recipient's wallet would refuse this payment: .*derivation.* Your saved payment is unchanged/i)
    expect(payer.createAction).not.toHaveBeenCalled() // no broadcast
    expect(box.markDelivered).not.toHaveBeenCalled()
    expect(payee.internalizeAction).not.toHaveBeenCalled()
  })

  it('refuses a saved payment over the 1 MB live limit, before broadcasting it', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    await receiving(hub, payee)
    const saved = await prepareMessageBoxPayment(payer.wallet, payee.identityKey, 2500, ORIGIN, undefined, () => {})
    payer.createAction.mockClear()
    expect(MAX_LIVE_TRANSACTION_BYTES).toBe(1_000_000)
    expect(MAX_LIVE_TRANSACTION_BYTES).toBeLessThan(MAX_DIRECT_TRANSACTION_BYTES)
    const existing = { ...saved, token: { ...saved.token, transaction: new Array(MAX_LIVE_TRANSACTION_BYTES + 1).fill(0) } }
    const box = outbox()
    const error = await deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 2500, existing, persist: box.persist, markDelivered: box.markDelivered }).catch(e => e)
    expect(error).toBeInstanceOf(NotSentError)
    expect(error.message).toBe(`This payment is too large to deliver directly: its transaction is ${(MAX_LIVE_TRANSACTION_BYTES + 1).toLocaleString()} bytes, and at most ${MAX_LIVE_TRANSACTION_BYTES.toLocaleString()} can be delivered. Your saved payment is unchanged; deliver it through the message box.`)
    expect(payer.createAction).not.toHaveBeenCalled()
    expect(payee.internalizeAction).not.toHaveBeenCalled()
  })

  it('does not broadcast a saved payment once the recipient has closed the connection', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    await receiving(hub, payee)
    const existing = await prepareMessageBoxPayment(payer.wallet, payee.identityKey, 2500, ORIGIN, undefined, () => {})
    payer.createAction.mockClear()
    const payerClient = client(hub, payer)
    const peer = await payerClient.connect(payee.identityKey)
    peer.close()
    const box = outbox()
    const error = await deliverDirect({ client: payerClient, wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 2500, existing, peer, persist: box.persist, markDelivered: box.markDelivered }).catch(e => e)
    expect(error).toBeInstanceOf(NotSentError)
    expect(error.message).toBe("The recipient's wallet closed the connection before the payment was sent. Your saved payment is unchanged; retry later or deliver it through the message box.")
    expect(payer.createAction).not.toHaveBeenCalled()
  })

  it('releases a new payment and spends nothing when the recipient hangs up while it is being made', async () => {
    const hub = createMemoryHub()
    const payer = await makePayer(), payee = await makePayee()
    // The payee closes a session that sends nothing within its first-message window; this
    // payer's wallet takes longer than that to make the payment.
    await receiving(hub, payee, { firstMessageTimeoutMs: 300 })
    const make = payer.createAction.getMockImplementation()!
    payer.createAction.mockImplementation(async (args: any) => {
      if (!args.options?.sendWith) await new Promise(resolve => setTimeout(resolve, 1000))
      return make(args)
    })
    const box = outbox()
    const error = await deliverDirect({ client: client(hub, payer), wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 600, persist: box.persist, markDelivered: box.markDelivered }).catch(e => e)
    expect(error).toBeInstanceOf(NotSentError)
    expect(error.message).toBe("The recipient's wallet closed the connection before the payment was sent. Nothing was spent.")
    expect(payer.created()).toBe(1)
    expect(payer.abortAction).toHaveBeenCalledWith({ reference: '0' }, ORIGIN) // its inputs are released
    expect(payer.createAction.mock.calls.some(([args]) => args.options?.sendWith)).toBe(false) // never broadcast
    expect(box.persist).not.toHaveBeenCalled()
    expect(payee.internalizeAction).not.toHaveBeenCalled()
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
  it('internalizes once and acks a repeated delivery as accepted, marked as a repeat, without a second internalize', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const payment = await incoming(payer, payee)
    await expect(receive(payee, payment)).resolves.toEqual({ status: 'accepted', repeat: false, added: true })
    await expect(receive(payee, { ...payment, messageId: 'again' })).resolves.toEqual({ status: 'accepted', repeat: true, added: false })
    expect(payee.internalizeAction).toHaveBeenCalledTimes(1)
    expect(seenKeys(payee.identityKey)).toEqual([keyOf(payment)])
  })

  it('describes the payment with the payer’s note, so Activity shows it', async () => {
    const payer = await makePayer(), payee = await makePayee()
    await receiveDirectPayment({ wallet: payee.wallet, originator: ORIGIN, identity: payee.identityKey, chain: CHAIN, payment: await incoming(payer, payee), note: '  Lunch 🍜  ' })
    await receive(payee, await incoming(payer, payee))
    await receiveDirectPayment({ wallet: payee.wallet, originator: ORIGIN, identity: payee.identityKey, chain: CHAIN, payment: await incoming(payer, payee), note: 'hi' })
    expect(payee.internalizeAction.mock.calls.map(([args]) => args.description)).toEqual(['Lunch 🍜', DIRECT_DESCRIPTION, 'hi   '])
  })

  it('keeps the payer’s note with a payment kept for a retry, and describes it with the note when retried', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValueOnce(new Error('User is not authenticated.'))
    await receiveDirectPayment({ wallet: payee.wallet, originator: ORIGIN, identity: payee.identityKey, chain: CHAIN, payment: await incoming(payer, payee), note: 'Rent for May' })
    expect(retries(payee.identityKey)[0]).toMatchObject({ payment: { note: 'Rent for May' } })
    await expect(retry(payee)).resolves.toBe(1)
    expect(payee.internalizeAction.mock.calls[1][0].description).toBe('Rent for May')
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
    ['a connection was refused', new Error('connect ECONNREFUSED 127.0.0.1:443')],
    ['no broadcaster could take the payment', reviewActions('serviceError')]
  ])('keeps the payment for retry and acks received when %s', async (_, failure) => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(failure)
    const payment = await incoming(payer, payee)
    await expect(receive(payee, payment)).resolves.toEqual({ status: 'received', repeat: false, added: false })
    expect(retries(payee.identityKey)).toEqual([expect.objectContaining({ key: keyOf(payment), error: failure.message })])
  })

  it.each([
    ['an invalid BEEF', werr('WERR_INVALID_PARAMETER', 'The tx parameter must be valid AtomicBEEF')],
    ['a missing argument', werr('WERR_MISSING_PARAMETER', 'The required tx parameter is missing.')],
    ['a bad merkle root', werr('WERR_INVALID_MERKLE_ROOT', 'Invalid merkleRoot 00 for block 00 at height 1.')],
    ['a storage validation error', new Error('Storage method internalizeAction failed: The tx parameter must be valid AtomicBEEF')],
    ['a refusal', new Error('The wallet did not accept the payment')],
    ['an unknown failure', new Error('Something unexpected')],
    ['a double spend', reviewActions('doubleSpend')],
    ['an invalid transaction', reviewActions('invalidTx')],
    ['a double spend reported with a service error', reviewActions('serviceError', 'doubleSpend')]
  ])('rejects and stores nothing for %s', async (_, failure) => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(failure)
    const error = await receive(payee, await incoming(payer, payee)).catch(e => e)
    expect(error).toBeInstanceOf(WebRTPayError)
    expect(error.message).not.toContain(failure.message) // the peer learns nothing about this wallet's internals
    expect(error.cause).toBe(failure)
    expect(local.size).toBe(0)
  })

  it('keeps one retry entry per payment however often it is redelivered, and says it was kept before', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(new Error('User is not authenticated.'))
    const payment = await incoming(payer, payee)
    await expect(receive(payee, payment)).resolves.toEqual({ status: 'received', repeat: false, added: false })
    // A redelivery (the payer lost the ack) is acked again, but marked as seen before.
    await expect(receive(payee, { ...payment, messageId: 'again' })).resolves.toEqual({ status: 'received', repeat: true, added: false })
    expect(retries(payee.identityKey)).toHaveLength(1)
  })

  it('removes the retry entry when a redelivery succeeds, which is a repeat of the kept payment that the wallet adds now', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValueOnce(new Error('User is not authenticated.'))
    const payment = await incoming(payer, payee)
    await expect(receive(payee, payment)).resolves.toEqual({ status: 'received', repeat: false, added: false })
    await expect(receive(payee, payment)).resolves.toEqual({ status: 'accepted', repeat: true, added: true })
    expect(retries(payee.identityKey)).toEqual([])
  })

  it('refuses new payments once 50 are waiting, and never drops one it acknowledged', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(new Error('User is not authenticated.'))
    const kept: string[] = []
    for (let i = 0; i < 50; i++) {
      const payment = await incoming(payer, payee)
      await expect(receive(payee, payment)).resolves.toEqual({ status: 'received', repeat: false, added: false })
      kept.push(keyOf(payment))
    }
    const error = await receive(payee, await incoming(payer, payee)).catch(e => e)
    expect(error).toBeInstanceOf(WebRTPayError)
    expect(retries(payee.identityKey).map(entry => entry.key)).toEqual(kept)
  })

  // Final review follow-up (C12): payments that need attention wait for the user, so they must
  // not use up the room for new ones; the retry budget still bounds the list.
  it('keeps a new payment while 50 that need attention wait, and those that do not are what counts', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(new Error('User is not authenticated.'))
    for (let i = 0; i < 50; i++) await receive(payee, await incoming(payer, payee))
    const listKey = `direct-pay-retry-v1:${payee.identityKey}:${CHAIN}`
    local.set(listKey, JSON.stringify(retries(payee.identityKey).map(entry => ({ ...entry, needsAttention: { since: 1, reason: 'unverifiable' } }))))
    local.set(listKey, JSON.stringify([...retries(payee.identityKey), { key: 'from-a-newer-version' }]))

    const payment = await incoming(payer, payee)
    await expect(receive(payee, payment)).resolves.toEqual({ status: 'received', repeat: false, added: false })
    expect(retries(payee.identityKey)).toHaveLength(52)
    expect(retries(payee.identityKey)[51]).toMatchObject({ key: keyOf(payment) })
  })

  it('counts only payments that do not need attention towards the limit', () => {
    const flagged = { needsAttention: { since: 1, reason: 'refused' as const } }
    expect(keptTowardLimit([])).toBe(0)
    expect(keptTowardLimit([{}, flagged, {}, flagged])).toBe(2)
    expect(keptTowardLimit([flagged])).toBe(0)
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
    await expect(receive(payee, await incoming(payer, payee))).resolves.toEqual({ status: 'accepted', repeat: false, added: true })
  })
})

// Final review M10: a payment that arrives while a network or profile switch holds wallet work
// off has already been broadcast by its payer, so it is kept for the retry, not refused.
describe('keepDirectPayment', () => {
  const keep = (payee: Payee, payment: IncomingPayment) =>
    keepDirectPayment({ wallet: payee.wallet, originator: ORIGIN, identity: payee.identityKey, chain: CHAIN, payment })

  it('keeps a payment that pays this wallet for the retry, without offering it to the wallet, once', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const payment = await incoming(payer, payee, 1300)

    await expect(keep(payee, payment)).resolves.toEqual({ status: 'received', repeat: false, added: false })
    await expect(keep(payee, { ...payment, messageId: 'again' })).resolves.toEqual({ status: 'received', repeat: true, added: false })

    expect(payee.internalizeAction).not.toHaveBeenCalled()
    expect(retries(payee.identityKey)).toEqual([expect.objectContaining({ key: keyOf(payment), error: 'It arrived while the wallet was changing networks or profiles.', attempts: 0 })])
    payee.internalizeAction.mockResolvedValue({ accepted: true })
    await expect(retry(payee)).resolves.toBe(1)
  })

  it('refuses, and stores nothing for, a payment that does not pay this wallet', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const payment = await incoming(payer, payee, 1000)
    const error = await keep(payee, { ...payment, token: { ...payment.token, amount: 999 } }).catch(e => e)
    expect(error).toBeInstanceOf(WebRTPayError)
    expect(error.code).toBe('invalid_payment')
    expect(local.size).toBe(0)
  })

  it('acks a payment the wallet already took as a repeat, and keeps nothing', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const payment = await incoming(payer, payee)
    await receive(payee, payment)
    await expect(keep(payee, payment)).resolves.toEqual({ status: 'accepted', repeat: true, added: false })
    expect(retries(payee.identityKey)).toEqual([])
  })
})

describe('retryReceivedDirectPayments', () => {
  const HOUR = 60 * 60 * 1000

  /** Kept payments for `payee`, received while its wallet was locked. */
  async function kept(payer: Payer, payee: Payee, count = 1): Promise<IncomingPayment[]> {
    const payments: IncomingPayment[] = []
    payee.internalizeAction.mockRejectedValue(new Error('User is not authenticated.'))
    for (let i = 0; i < count; i++) {
      payments.push(await incoming(payer, payee))
      await expect(receive(payee, payments[i])).resolves.toEqual({ status: 'received', repeat: false, added: false })
    }
    payee.internalizeAction.mockReset()
    return payments
  }

  /** Rewrites the stored retry entries, e.g. to age them. */
  function patchRetries(payee: Payee, patch: (entry: any) => object) {
    local.set(`direct-pay-retry-v1:${payee.identityKey}:${CHAIN}`, JSON.stringify(retries(payee.identityKey).map(entry => ({ ...entry, ...patch(entry) }))))
  }

  // Final review D4, Ruling 36: each kept payment was acknowledged, so its payer will not
  // resend it, and only this device has its derivation. A retry never deletes one: it flags
  // it as needing attention, reports it once, and keeps it (with everything needed to add it).
  it('adds what the wallet now accepts, keeps transient failures, and flags a payment it refuses as needing attention without deleting it', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const [ok, later, bad] = await kept(payer, payee, 3)
    expect(retries(payee.identityKey)).toHaveLength(3)

    const refusal = 'The wallet payment parameter must be valid paymentRemittance and no insertionRemittance'
    payee.internalizeAction
      .mockResolvedValueOnce({ accepted: true })
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(werr('WERR_INVALID_PARAMETER', refusal))
    const onNeedsAttention = vi.fn()
    await expect(retry(payee, onNeedsAttention)).resolves.toBe(1)
    expect(retries(payee.identityKey)).toEqual([
      expect.objectContaining({ key: keyOf(later), attempts: 0 }), // a temporary failure is not a try
      expect.objectContaining({ key: keyOf(bad), error: refusal, needsAttention: { since: expect.any(Number), reason: 'refused' } })
    ])
    expect(retries(payee.identityKey)[0]).not.toHaveProperty('needsAttention')
    expect(seenKeys(payee.identityKey)).toEqual([keyOf(ok)])
    expect(onNeedsAttention).toHaveBeenCalledTimes(1)
    expect(onNeedsAttention).toHaveBeenCalledWith({
      key: keyOf(bad),
      txid: txidOf(bad.token.transaction),
      sender: payer.identityKey,
      amount: 1000,
      receivedAt: expect.any(Number),
      attempts: 0,
      error: refusal,
      needsAttention: { since: expect.any(Number), reason: 'refused' },
      payment: {
        messageId: bad.messageId,
        sender: payer.identityKey,
        token: { customInstructions: bad.token.customInstructions, transaction: Utils.toBase64(bad.token.transaction), amount: 1000, outputIndex: 0 }
      }
    })
  })

  it.each([
    ['an unknown failure', new Error('Something unexpected')],
    ['a chain tracker HTTP error', new Error('ChainTracks request failed with HTTP 503.')],
    ['a chain tracker error page', new Error('ChainTracks service returned invalid JSON.')],
    ['a lagging chain tracker', werr('WERR_INVALID_PARAMETER', 'The tx parameter must be valid AtomicBEEF')],
    ['an unreachable header service', new Error('Failed to verify merkleroot for height 5.')],
    ['a merkle root mismatch', werr('WERR_INVALID_MERKLE_ROOT', 'Invalid merkleRoot 00 for block 00 at height 1.')],
    ['a transaction busy in storage', new Error('Storage method internalizeAction failed: The tx parameter must be target transaction of internalizeAction is undergoing active changes.')],
    ['a transaction storage does not know yet', new Error(`Storage method internalizeAction failed: The txid parameter must be known to storage. ${'ab'.repeat(32)} is not known.`)],
    ['a transaction lookup HTTP error', werr('WERR_INVALID_PARAMETER', `The txid parameter must be valid transaction. '${'ab'.repeat(32)}' response Service Unavailable`)],
    ['a transaction not found on chain yet', werr('WERR_INVALID_PARAMETER', `The txid ${'ab'.repeat(32)} parameter must be valid transaction on chain test`)],
    ['wallet services not set up yet', werr('WERR_INVALID_PARAMETER', 'The services parameter must be valid in constructor arguments to be retreived here.')],
    ['an unexplained refusal', new Error('The wallet did not accept the payment')]
  ])('keeps a payment it acknowledged when the retry fails with %s', async (_, failure) => {
    const payer = await makePayer(), payee = await makePayee()
    const [payment] = await kept(payer, payee)
    payee.internalizeAction.mockRejectedValue(failure)
    const onNeedsAttention = vi.fn()
    await expect(retry(payee, onNeedsAttention)).resolves.toBe(0)
    await expect(retry(payee, onNeedsAttention)).resolves.toBe(0)
    expect(payee.internalizeAction).toHaveBeenCalledTimes(2)
    expect(onNeedsAttention).not.toHaveBeenCalled()
    expect(retries(payee.identityKey)).toEqual([expect.objectContaining({ key: keyOf(payment), attempts: 2, error: failure.message })])
  })

  it('keeps a payment the wallet answers with accepted false', async () => {
    const payer = await makePayer(), payee = await makePayee()
    await kept(payer, payee)
    payee.internalizeAction.mockResolvedValue({ accepted: false })
    const onNeedsAttention = vi.fn()
    await expect(retry(payee, onNeedsAttention)).resolves.toBe(0)
    expect(onNeedsAttention).not.toHaveBeenCalled()
    expect(retries(payee.identityKey)).toEqual([expect.objectContaining({ attempts: 1, error: 'The wallet did not accept the payment' })])
  })

  it('flags a payment it cannot verify as needing attention only after 5 tries and more than a day, reports it once, and keeps it', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const [payment] = await kept(payer, payee)
    const receivedAt = retries(payee.identityKey)[0].receivedAt
    const failure = new Error('ChainTracks request failed with HTTP 503.')
    payee.internalizeAction.mockRejectedValue(failure)
    const onNeedsAttention = vi.fn()

    patchRetries(payee, () => ({ attempts: 4, receivedAt: Date.now() - 23 * HOUR })) // enough tries, too young
    await retry(payee, onNeedsAttention)
    expect(retries(payee.identityKey)).toEqual([expect.objectContaining({ attempts: 5 })])

    patchRetries(payee, () => ({ attempts: 0, receivedAt: Date.now() - 25 * HOUR })) // old enough, too few tries
    await retry(payee, onNeedsAttention)
    expect(retries(payee.identityKey)).toEqual([expect.objectContaining({ attempts: 1 })])
    expect(retries(payee.identityKey)[0]).not.toHaveProperty('needsAttention')
    expect(onNeedsAttention).not.toHaveBeenCalled()

    const old = receivedAt - 25 * HOUR
    patchRetries(payee, () => ({ attempts: 4, receivedAt: old }))
    await expect(retry(payee, onNeedsAttention)).resolves.toBe(0)
    expect(retries(payee.identityKey)).toEqual([expect.objectContaining({ key: keyOf(payment), attempts: 5, receivedAt: old, needsAttention: { since: expect.any(Number), reason: 'unverifiable' } })])
    expect(onNeedsAttention).toHaveBeenCalledTimes(1)
    expect(onNeedsAttention).toHaveBeenCalledWith(expect.objectContaining({
      needsAttention: { since: expect.any(Number), reason: 'unverifiable' },
      txid: txidOf(payment.token.transaction),
      sender: payer.identityKey,
      amount: 1000,
      receivedAt: old,
      attempts: 5,
      error: failure.message,
      payment: expect.objectContaining({ token: expect.objectContaining({ transaction: Utils.toBase64(payment.token.transaction), customInstructions: payment.token.customInstructions }) })
    }))

    // Still kept, and still offered to the wallet when attention payments are included; reported once.
    await retry(payee, onNeedsAttention)
    expect(payee.internalizeAction).toHaveBeenCalledTimes(4)
    expect(onNeedsAttention).toHaveBeenCalledTimes(1)
    expect(retries(payee.identityKey)).toHaveLength(1)
  })

  it('tries payments that need attention only when asked to, and adds one the wallet takes at last', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const [first, second] = await kept(payer, payee, 2)
    patchRetries(payee, entry => entry.key === keyOf(first) ? { needsAttention: { since: 1, reason: 'unverifiable' } } : {})
    payee.internalizeAction.mockRejectedValue(new TypeError('fetch failed'))

    await retry(payee, vi.fn(), false)
    expect(payee.internalizeAction).toHaveBeenCalledTimes(1) // only the payment that does not need attention
    expect(txidOf(payee.internalizeAction.mock.calls[0][0].tx)).toBe(txidOf(second.token.transaction))

    payee.internalizeAction.mockReset().mockResolvedValue({ accepted: true })
    await expect(retry(payee, vi.fn(), true)).resolves.toBe(2)
    expect(retries(payee.identityKey)).toEqual([])
  })

  it('does not count temporary failures towards giving up', async () => {
    const payer = await makePayer(), payee = await makePayee()
    await kept(payer, payee)
    patchRetries(payee, () => ({ attempts: 4, receivedAt: Date.now() - 48 * HOUR }))
    const onNeedsAttention = vi.fn()
    for (const failure of [new Error('User is not authenticated.'), new TypeError('fetch failed'), new Error('Storage method internalizeAction failed: SQLITE_BUSY: database is locked'), reviewActions('serviceError')]) {
      payee.internalizeAction.mockRejectedValueOnce(failure)
      await expect(retry(payee, onNeedsAttention)).resolves.toBe(0)
    }
    expect(onNeedsAttention).not.toHaveBeenCalled()
    expect(retries(payee.identityKey)).toEqual([expect.objectContaining({ attempts: 4, error: 'User is not authenticated.' })])
  })

  // A payment kept while the wallet was locked was never checked against this wallet's key. It
  // is still kept: deleting acknowledged payments is what Ruling 36 rules out.
  it('flags at once, and keeps, a payment that does not pay this wallet', async () => {
    const payer = await makePayer(), payee = await makePayee()
    await kept(payer, payee)
    patchRetries(payee, entry => ({ payment: { ...entry.payment, token: { ...entry.payment.token, amount: 999 } } }))
    const onNeedsAttention = vi.fn()
    await expect(retry(payee, onNeedsAttention)).resolves.toBe(0)
    expect(payee.internalizeAction).not.toHaveBeenCalled()
    expect(retries(payee.identityKey)).toEqual([expect.objectContaining({ needsAttention: { since: expect.any(Number), reason: 'refused' } })])
    expect(onNeedsAttention).toHaveBeenCalledWith(expect.objectContaining({ needsAttention: expect.objectContaining({ reason: 'refused' }), amount: 999, attempts: 0, error: expect.stringMatching(/does not pay/) }))
  })

  it.each([
    ['a missing argument', werr('WERR_MISSING_PARAMETER', 'The required outputs parameter is missing.')],
    ['a storage-wrapped argument check', new Error('Storage method internalizeAction failed: The outputs parameter must be unique outputIndex values')],
    ['an invalid derivation', werr('WERR_INVALID_PARAMETER', 'The derivationPrefix parameter must be valid base64.')],
    ['an invalid remittance', werr('WERR_INVALID_PARAMETER', 'The output remittance parameter must be only paymentRemittance for wallet payment')]
  ])('flags at once, and keeps, a payment refused for %s', async (_, failure) => {
    const payer = await makePayer(), payee = await makePayee()
    await kept(payer, payee)
    payee.internalizeAction.mockRejectedValue(failure)
    const onNeedsAttention = vi.fn()
    await retry(payee, onNeedsAttention)
    expect(retries(payee.identityKey)).toEqual([expect.objectContaining({ error: failure.message, needsAttention: { since: expect.any(Number), reason: 'refused' } })])
    expect(onNeedsAttention).toHaveBeenCalledWith(expect.objectContaining({ needsAttention: expect.objectContaining({ reason: 'refused' }), error: failure.message }))
  })

  it('keeps the payment flagged when reporting it fails', async () => {
    const payer = await makePayer(), payee = await makePayee()
    await kept(payer, payee)
    payee.internalizeAction.mockRejectedValue(werr('WERR_INVALID_PARAMETER', 'The outputs parameter must be unique outputIndex values'))
    await expect(retry(payee, () => { throw new Error('could not show it') })).resolves.toBe(0)
    expect(retries(payee.identityKey)).toEqual([expect.objectContaining({ needsAttention: expect.objectContaining({ reason: 'refused' }) })])
  })

  it('keeps a payment that arrives while a retry waits for the wallet', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const [first] = await kept(payer, payee)
    let fail!: (error: Error) => void
    payee.internalizeAction
      .mockImplementationOnce(() => new Promise((_, reject) => { fail = reject }))
      .mockRejectedValueOnce(new Error('User is not authenticated.'))
    const retrying = retry(payee)
    await vi.waitFor(() => expect(payee.internalizeAction).toHaveBeenCalledTimes(1))
    const second = await incoming(payer, payee)
    await expect(receive(payee, second)).resolves.toEqual({ status: 'received', repeat: false, added: false })
    fail(new Error('ChainTracks request failed with HTTP 503.'))
    await expect(retrying).resolves.toBe(0)
    expect(retries(payee.identityKey)).toEqual([
      expect.objectContaining({ key: keyOf(first), attempts: 1 }),
      expect.objectContaining({ key: keyOf(second), attempts: 0 })
    ])
  })

  // DirectPayManager takes a wallet operation per call through `run`, and stops a pass when the
  // wallet gets busy or a call stalls (final review M12).
  it('makes each payment\'s wallet calls through run, and ends the pass where run stops it', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const [first, second, third] = await kept(payer, payee, 3)
    payee.internalizeAction.mockResolvedValue({ accepted: true })
    let calls = 0
    const run = vi.fn(async <T,>(call: () => Promise<T>): Promise<T> => {
      if (++calls === 2) throw new RetryStopped()
      return call()
    })

    await expect(retryReceivedDirectPayments({ wallet: payee.wallet, originator: ORIGIN, identity: payee.identityKey, chain: CHAIN, run })).resolves.toBe(1)

    expect(run).toHaveBeenCalledTimes(2)
    expect(payee.internalizeAction).toHaveBeenCalledTimes(1)
    expect(txidOf(payee.internalizeAction.mock.calls[0][0].tx)).toBe(txidOf(first.token.transaction))
    expect(retries(payee.identityKey)).toEqual([
      expect.objectContaining({ key: keyOf(second), attempts: 0 }),
      expect.objectContaining({ key: keyOf(third), attempts: 0 })
    ])
  })

  it('returns 0 when nothing is waiting or the stored list is unreadable, and leaves an unreadable list as it is', async () => {
    const payee = await makePayee()
    await expect(retry(payee)).resolves.toBe(0)
    local.set(`direct-pay-retry-v1:${payee.identityKey}:${CHAIN}`, '{not json')
    await expect(retry(payee)).resolves.toBe(0)
    expect(payee.internalizeAction).not.toHaveBeenCalled()
    expect(local.get(`direct-pay-retry-v1:${payee.identityKey}:${CHAIN}`)).toBe('{not json')
  })
})

// Final review follow-up (C12): a kept list this version cannot read may hold the only copy of
// acknowledged payments, so nothing ever writes over it, and entries it does not recognise are
// passed through as they are.
describe('a kept list this device cannot read', () => {
  const listKey = (payee: Payee) => `direct-pay-retry-v1:${payee.identityKey}:${CHAIN}`
  const locked = () => new Error('User is not authenticated.')

  it.each([
    ['text that is not JSON', '{not json'],
    ['JSON that is not a list', '{"key":"x"}']
  ])('refuses to keep a new payment rather than replace %s, and leaves it as it is', async (_, text) => {
    const payer = await makePayer(), payee = await makePayee()
    local.set(listKey(payee), text)
    payee.internalizeAction.mockRejectedValue(locked())

    const error = await receive(payee, await incoming(payer, payee)).catch(e => e)
    const kept = await keepDirectPayment({ wallet: payee.wallet, originator: ORIGIN, identity: payee.identityKey, chain: CHAIN, payment: await incoming(payer, payee) }).catch(e => e)

    for (const refusal of [error, kept]) {
      expect(refusal).toBeInstanceOf(WebRTPayError)
      expect(refusal.code).toBe('rejected') // the payer still has the payment
      expect(refusal.message).toMatch(/try again later/i)
    }
    expect(local.get(listKey(payee))).toBe(text)
  })

  it('leaves it as it is when the wallet takes a payment, or a retry fails, after it became unreadable', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(locked())
    await receive(payee, await incoming(payer, payee))
    await receive(payee, await incoming(payer, payee))
    const corrupt = () => { local.set(listKey(payee), '[{"key":') }
    payee.internalizeAction.mockReset()
      .mockImplementationOnce(async () => { corrupt(); return { accepted: true } })
      .mockImplementationOnce(async () => { corrupt(); throw werr('WERR_INVALID_PARAMETER', 'The outputs parameter must be unique outputIndex values') })

    await retry(payee)

    expect(payee.internalizeAction).toHaveBeenCalledTimes(2)
    expect(local.get(listKey(payee))).toBe('[{"key":')
    expect(listKeptDirectPayments(payee.identityKey, CHAIN)).toEqual({ payments: [], unreadable: true, unknown: 0 })
  })

  it('passes entries it does not recognise through unchanged, in place, and never counts them as kept payments', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const foreign = [{ key: 'from-a-newer-version', payment: { token: { transaction: 42 } } }, { key: 'no-payment' }, 'text', null]
    local.set(listKey(payee), JSON.stringify(foreign))
    payee.internalizeAction.mockRejectedValue(locked())
    const [first, second] = [await incoming(payer, payee), await incoming(payer, payee)]
    await expect(receive(payee, first)).resolves.toEqual({ status: 'received', repeat: false, added: false })
    await expect(receive(payee, second)).resolves.toEqual({ status: 'received', repeat: false, added: false })
    expect(listKeptDirectPayments(payee.identityKey, CHAIN)).toEqual({ payments: [expect.objectContaining({ key: keyOf(first) }), expect.objectContaining({ key: keyOf(second) })], unreadable: false, unknown: 4 })

    payee.internalizeAction.mockReset()
      .mockRejectedValueOnce(werr('WERR_INVALID_PARAMETER', 'The outputs parameter must be unique outputIndex values')) // flags the first
      .mockResolvedValueOnce({ accepted: true }) // adds the second
    await expect(retry(payee)).resolves.toBe(1)
    expect(retries(payee.identityKey)).toEqual([...foreign, expect.objectContaining({ key: keyOf(first), needsAttention: expect.objectContaining({ reason: 'refused' }) })])

    payee.internalizeAction.mockReset().mockResolvedValue({ accepted: true })
    await expect(retry(payee)).resolves.toBe(1)
    expect(retries(payee.identityKey)).toEqual(foreign) // the list stays while anything is in it
  })

  it('keeps reading entries saved before tries were counted', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(locked())
    const payment = await incoming(payer, payee)
    await receive(payee, payment)
    const [{ attempts: _, ...early }] = retries(payee.identityKey)
    local.set(listKey(payee), JSON.stringify([early]))
    expect(listKeptDirectPayments(payee.identityKey, CHAIN)).toEqual({ payments: [expect.objectContaining({ key: keyOf(payment), attempts: 0 })], unreadable: false, unknown: 0 })
  })
})

// Final review follow-up (C12): Ruling 36 rules out deleting a kept payment by giving up, not
// the user removing one after copying its recovery details (the page offers it only then).
describe('dismissKeptDirectPayment', () => {
  const listKey = (payee: Payee) => `direct-pay-retry-v1:${payee.identityKey}:${CHAIN}`
  const dismiss = (payee: Payee, key: string) => dismissKeptDirectPayment(payee.identityKey, CHAIN, key)

  /** Two kept payments for `payee`, the first of them flagged as needing attention. */
  async function flaggedAndWaiting(payer: Payer, payee: Payee): Promise<[IncomingPayment, IncomingPayment]> {
    payee.internalizeAction.mockRejectedValue(new Error('User is not authenticated.'))
    const payments: [IncomingPayment, IncomingPayment] = [await incoming(payer, payee), await incoming(payer, payee)]
    for (const payment of payments) await receive(payee, payment)
    local.set(listKey(payee), JSON.stringify(retries(payee.identityKey).map(entry => entry.key === keyOf(payments[0]) ? { ...entry, needsAttention: { since: 1, reason: 'refused' } } : entry)))
    return payments
  }

  it('removes a payment that needs attention, and leaves the rest as they are', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const [flagged, waiting] = await flaggedAndWaiting(payer, payee)
    local.set(listKey(payee), JSON.stringify(['foreign', ...retries(payee.identityKey)]))
    expect(dismiss(payee, keyOf(flagged))).toBe(true)
    expect(retries(payee.identityKey)).toEqual(['foreign', expect.objectContaining({ key: keyOf(waiting) })])
    expect(dismiss(payee, keyOf(flagged))).toBe(false) // already gone
  })

  it('refuses a payment that is still being retried', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const [, waiting] = await flaggedAndWaiting(payer, payee)
    const before = local.get(listKey(payee))
    expect(() => dismiss(payee, keyOf(waiting))).toThrow('Only a payment that needs attention can be dismissed')
    expect(local.get(listKey(payee))).toBe(before)
  })

  it('removes nothing from a list it cannot read, or cannot write', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const [flagged] = await flaggedAndWaiting(payer, payee)
    const before = local.get(listKey(payee))!
    setItem = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') }
    expect(() => dismiss(payee, keyOf(flagged))).toThrow('could not be removed')
    expect(local.get(listKey(payee))).toBe(before)

    local.set(listKey(payee), before.slice(0, -1))
    expect(() => dismiss(payee, keyOf(flagged))).toThrow('could not be read, so nothing was removed')
    expect(local.get(listKey(payee))).toBe(before.slice(0, -1))
  })
})

describe('kept payments for display', () => {
  it('lists the open wallet\'s kept payments with what is needed to show and recover them', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payee.internalizeAction.mockRejectedValue(new TypeError('fetch failed'))
    const payment = await incoming(payer, payee, 1234)
    await receive(payee, payment)

    expect(listKeptDirectPayments(payee.identityKey, CHAIN)).toEqual({
      payments: [{
        key: keyOf(payment),
        txid: txidOf(payment.token.transaction),
        sender: payer.identityKey,
        amount: 1234,
        receivedAt: expect.any(Number),
        attempts: 0,
        error: 'fetch failed',
        payment: { messageId: payment.messageId, sender: payer.identityKey, token: { customInstructions: payment.token.customInstructions, transaction: Utils.toBase64(payment.token.transaction), amount: 1234, outputIndex: 0 } }
      }],
      unreadable: false,
      unknown: 0
    })
    const none = { payments: [], unreadable: false, unknown: 0 }
    expect(listKeptDirectPayments(payee.identityKey, 'main')).toEqual(none)
    expect(listKeptDirectPayments('other', CHAIN)).toEqual(none)
  })

  // Final review follow-up (C12): the remove dialog promises the open wallet's kept payments come
  // back with it; other wallets' are counted apart, and what cannot be read is never counted as none.
  it('counts and totals the kept payments on this device: the open wallet\'s on every network, and every other wallet\'s', async () => {
    const payer = await makePayer(), a = await makePayee(), b = await makePayee()
    for (const payee of [a, b]) payee.internalizeAction.mockRejectedValue(new TypeError('fetch failed'))
    await receive(a, await incoming(payer, a, 1000))
    await receive(a, await incoming(payer, a, 500))
    await receiveDirectPayment({ wallet: a.wallet, originator: ORIGIN, identity: a.identityKey, chain: 'main', payment: await incoming(payer, a, 20) })
    await receive(b, await incoming(payer, b, 250))
    await receiveDirectPayment({ wallet: b.wallet, originator: ORIGIN, identity: b.identityKey, chain: 'main', payment: await incoming(payer, b, 4) })
    local.set('direct-pay-seen-v1:x:test', '["k"]')

    expect(keptDirectPaymentsOnDevice(a.identityKey)).toEqual({ open: { count: 3, total: 1520, unreadable: 0 }, others: { count: 2, total: 254, unreadable: 0 } })
    expect(keptDirectPaymentsOnDevice(b.identityKey)).toEqual({ open: { count: 2, total: 254, unreadable: 0 }, others: { count: 3, total: 1520, unreadable: 0 } })

    local.set(`direct-pay-retry-v1:${a.identityKey}:main`, '{not json')
    local.set(`direct-pay-retry-v1:${b.identityKey}:main`, JSON.stringify([{ key: 'from-a-newer-version' }, ...stored(`direct-pay-retry-v1:${b.identityKey}:main`), 3]))
    expect(keptDirectPaymentsOnDevice(a.identityKey)).toEqual({ open: { count: 2, total: 1500, unreadable: 1 }, others: { count: 2, total: 254, unreadable: 2 } })
  })

  it('tells listeners in this window when the kept list changes', async () => {
    const listener = vi.fn()
    const events = new EventTarget()
    vi.stubGlobal('window', { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) })
    const unsubscribe = subscribeKeptDirectPayments(listener)
    try {
      const payer = await makePayer(), payee = await makePayee()
      payee.internalizeAction.mockRejectedValueOnce(new TypeError('fetch failed'))
      await receive(payee, await incoming(payer, payee))
      expect(listener).toHaveBeenCalledTimes(1)
      await retry(payee)
      expect(listener).toHaveBeenCalledTimes(2) // added, so it left the list
    } finally {
      unsubscribe()
      vi.stubGlobal('window', undefined)
    }
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
