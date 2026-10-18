/**
 * Face-to-face direct payments (Nearby → Direct (WebRTC)): the payee shows an offer code,
 * the payer answers it, and the payment goes over the connection the two codes open.
 *
 * The flows run between real WebRTC peers (node-datachannel on loopback; the sandbox drops
 * other UDP) with ProtoWallets. The repo has no DOM test environment, so the component's
 * wiring is checked in source, as in paymentsDirect.test.ts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QRCodeSVG } from 'qrcode.react'
import { LockingScript, MerklePath, P2PKH, PrivateKey, ProtoWallet, PublicKey, Random, Transaction, UnlockingScript, Utils } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'
import { DirectPayClient, WebRTPayError } from '@bsv/webrtpay'
import type { IncomingPayment, ReceiveHandlers } from '@bsv/webrtpay'
import { setHttpBridgePaused } from '../src/lib/services/httpBridgeSession'
import { answerDirectRequest, codeFitsQr, createDirectRequest, offerFailure, pendingPaymentFor, QR_MAX_CHARS, readOfferCode } from '../src/lib/pages/Dashboard/Payments/directCodes'
import type { ReceivedDirectPayment } from '../src/lib/pages/Dashboard/Payments/directCodes'
import { deliverDirect, NotSentError } from '../src/lib/pages/Dashboard/Payments/directPayments'
import { prepareMessageBoxPayment } from '../src/lib/pages/Dashboard/Payments/messageBoxPayments'
import type { OutgoingPayment } from '../src/lib/pages/Dashboard/Payments/messageBoxPayments'
import { DIRECT_CODE_HINT, isDirectCode, parsePaymentTarget } from '../src/lib/pages/Dashboard/Payments/paymentProtocol'

const ORIGIN = 'admin.test'
const CHAIN = 'test'

// ---- localStorage (the payee's seen and retry lists) ---------------------------------------

let local: Map<string, string>
beforeEach(() => {
  local = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => { local.set(key, value) },
    removeItem: (key: string) => { local.delete(key) }
  })
})

// ---- wallets -----------------------------------------------------------------------------

/** Atomic BEEF paying `satoshis` to `lockingScript` at output 0, proven by a one-leaf MerklePath. */
function paymentBeef(lockingScript: string, satoshis: number): { tx: number[]; txid: string } {
  const parent = new Transaction()
  parent.addInput({ sourceTXID: '00'.repeat(32), sourceOutputIndex: 0xffffffff, unlockingScript: new UnlockingScript() })
  parent.addOutput({ lockingScript: new P2PKH().lock(PrivateKey.fromRandom().toPublicKey().toHash()), satoshis: satoshis + 1000 })
  parent.merklePath = MerklePath.fromCoinbaseTxidAndHeight(parent.id('hex'), 1)
  const child = new Transaction()
  child.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScript: new UnlockingScript() })
  child.addOutput({ lockingScript: LockingScript.fromHex(lockingScript), satoshis })
  return { tx: child.toAtomicBEEF(), txid: child.id('hex') }
}

const txidOf = (tx: number[]) => Transaction.fromAtomicBEEF(tx).id('hex')

/** A ProtoWallet whose createAction/signAction build a local payment (and answer sendWith). */
async function makePayer() {
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
  const created = () => createAction.mock.calls.filter(([args]) => !args.options?.sendWith)
  return { wallet, identityKey: publicKey, createAction, created }
}

async function makePayee() {
  const internalizeAction = vi.fn(async (_args: any, _originator?: string) => ({ accepted: true }))
  const wallet = Object.assign(new ProtoWallet(PrivateKey.fromRandom()), { internalizeAction }) as unknown as WalletInterface
  const { publicKey } = await wallet.getPublicKey({ identityKey: true })
  return { wallet, identityKey: publicKey, internalizeAction }
}

// ---- real WebRTC peers -------------------------------------------------------------------

let RTCPeerConnection: typeof globalThis.RTCPeerConnection
beforeAll(async () => {
  RTCPeerConnection = (await import('node-datachannel/polyfill')).RTCPeerConnection as unknown as typeof globalThis.RTCPeerConnection
})
afterAll(async () => {
  (await import('node-datachannel')).cleanup()
})

const clients: DirectPayClient[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(clients.splice(0).map(c => c.close()))
})

/** Code exchange needs no signaler: the codes carry the offer and the answer. */
function client(party: { wallet: WalletInterface }, connectMs = 10_000): DirectPayClient {
  const c = new DirectPayClient({
    wallet: party.wallet,
    originator: ORIGIN,
    chain: CHAIN,
    rtc: { RTCPeerConnection, iceServers: [], extraConfig: { bindAddress: '127.0.0.1' } },
    timeouts: { connectMs, ackMs: 10_000 }
  })
  clients.push(c)
  return c
}

function outbox() {
  const rows: OutgoingPayment[] = []
  return {
    rows,
    persist: vi.fn((row: OutgoingPayment) => { rows.push(row) }),
    markDelivered: vi.fn((_txid: string) => {})
  }
}

type Payee = Awaited<ReturnType<typeof makePayee>>

/** The payee's side of the Nearby screen: an offer whose payments go through receiveDirectPayment. */
async function request(payee: Payee, o: { amount?: number; chain?: string } = {}) {
  const received: ReceivedDirectPayment[] = []
  const errors: unknown[] = []
  const offer = await createDirectRequest({
    client: client(payee),
    wallet: payee.wallet,
    originator: ORIGIN,
    identity: payee.identityKey,
    chain: o.chain ?? CHAIN,
    amount: o.amount,
    onReceived: r => { received.push(r) },
    onError: e => { errors.push(e) }
  })
  return { offer, received, errors }
}

// ---- codes -------------------------------------------------------------------------------

describe('recognising direct payment codes', () => {
  it('knows a webrtpay1: code, with or without surrounding whitespace', () => {
    expect(isDirectCode('webrtpay1:AQEC')).toBe(true)
    expect(isDirectCode('  webrtpay1:AQEC\n')).toBe(true)
    expect(isDirectCode('bsvpay1:abc')).toBe(false)
    expect(isDirectCode('peerpay:02abc')).toBe(false)
  })

  it('tells the Send tab to use Nearby → Direct for a webrtpay1: code', () => {
    expect(DIRECT_CODE_HINT).toMatch(/Nearby/)
    expect(DIRECT_CODE_HINT).toMatch(/Direct \(WebRTC\)/)
    expect(() => parsePaymentTarget('webrtpay1:AQECAwQ', CHAIN)).toThrow(DIRECT_CODE_HINT)
    expect(() => parsePaymentTarget(' webrtpay1:AQECAwQ ', 'main')).toThrow(DIRECT_CODE_HINT)
  })
})

describe('reading a recipient’s offer code', () => {
  it('returns who is asking, on which network, and for how much', async () => {
    const payee = await makePayee()
    const { offer } = await request(payee, { amount: 1200 })
    const read = readOfferCode(offer.code, { chain: CHAIN, identity: (await makePayer()).identityKey })
    expect(read).toMatchObject({ kind: 'offer', identityKey: payee.identityKey, chain: CHAIN, amount: 1200 })
  })

  it('refuses a code for another network and names both networks', async () => {
    const payee = await makePayee()
    const { offer } = await request(payee, { chain: 'main' })
    expect(() => readOfferCode(offer.code, { chain: CHAIN, identity: 'x' })).toThrow('This request is for Mainnet, but your wallet is on Testnet. Switch networks in Settings first.')
  })

  // Final review M20/M25: not "TeraScaling Testnet", and no advice to switch to a network this wallet lacks.
  it('names a network this wallet does not support by the code\'s id, without advice to switch', async () => {
    const payee = await makePayee()
    const offer = await client(payee).createOfferCode({ chain: 'regtest', handlers: { onPayment: async () => 'accepted' } })
    expect(() => readOfferCode(offer.code, { chain: CHAIN, identity: 'x' })).toThrow(/^This request is for a network this wallet does not support \(regtest\)\.$/)
  })

  it('refuses an expired code', async () => {
    const payee = await makePayee()
    const expiring = await client(payee).createOfferCode({ chain: CHAIN, expiresInMs: 60_000, handlers: { onPayment: async () => 'accepted' } })
    expect(readOfferCode(expiring.code, { chain: CHAIN, identity: 'x' }).identityKey).toBe(payee.identityKey)
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 120_000)
    expect(() => readOfferCode(expiring.code, { chain: CHAIN, identity: 'x' })).toThrow(/expired.*new one/)
  })

  it('refuses an answer code, the wallet’s own code, and text that is not a code', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const { offer } = await request(payee)
    const answer = await client(payer).answerOfferCode(offer.code)
    expect(() => readOfferCode(answer.answerCode, { chain: CHAIN, identity: payer.identityKey })).toThrow(/answer code/)
    expect(() => readOfferCode(offer.code, { chain: CHAIN, identity: payee.identityKey })).toThrow(/your own request/)
    expect(() => readOfferCode('webrtpay1:!!', { chain: CHAIN, identity: 'x' })).toThrow(/could not be read/)
    expect(() => readOfferCode('webrtpay1:AQEC', { chain: CHAIN, identity: 'x' })).toThrow(/could not be read/)
    expect(() => readOfferCode('bsvpay1:abc', { chain: CHAIN, identity: 'x' })).toThrow(/animated QR request.*Animated QR/)
  })
})

describe('showing codes as QR', () => {
  it('knows the longest code a level M QR holds, as qrcode.react renders it', () => {
    const code = (n: number) => 'webrtpay1:' + 'A'.repeat(n - 10)
    expect(codeFitsQr(code(QR_MAX_CHARS))).toBe(true)
    expect(codeFitsQr(code(QR_MAX_CHARS + 1))).toBe(false)
    expect(() => renderToStaticMarkup(createElement(QRCodeSVG, { value: code(QR_MAX_CHARS), level: 'M', size: 260 }))).not.toThrow()
    expect(() => renderToStaticMarkup(createElement(QRCodeSVG, { value: code(QR_MAX_CHARS + 1), level: 'M', size: 260 }))).toThrow(/too long/i)
  })
})

describe('a saved payment for the same recipient', () => {
  const row = (o: Partial<OutgoingPayment>): OutgoingPayment => ({ txid: 'a'.repeat(64), recipient: 'R', amount: 500, createdAt: 1, delivered: false, token: { transaction: [1], amount: 500, outputIndex: 0, customInstructions: { derivationPrefix: 'p', derivationSuffix: 's' } }, ...o })

  it('is the oldest undelivered row to that identity, of the requested amount, that is not a request payment', () => {
    const rows = [
      row({ txid: '1'.repeat(64), recipient: 'S' }),
      row({ txid: '2'.repeat(64), delivered: true }),
      row({ txid: '3'.repeat(64), request: { requestId: 'q', messageId: 'm' } }),
      row({ txid: '4'.repeat(64), amount: 700, via: 'messagebox' }),
      row({ txid: '5'.repeat(64), amount: 900, via: 'direct' })
    ]
    expect(pendingPaymentFor(rows, 'R')?.txid).toBe('4'.repeat(64))
    expect(pendingPaymentFor(rows, 'R', 900)?.txid).toBe('5'.repeat(64))
    expect(pendingPaymentFor(rows, 'R', 500)).toBeUndefined()
    expect(pendingPaymentFor(rows, 'T')).toBeUndefined()
    expect(pendingPaymentFor([], 'R')).toBeUndefined()
  })
})

describe('what the payee sees when their answer does not connect', () => {
  it('asks for their answer again when the scanned code is not it', () => {
    expect(offerFailure(new WebRTPayError('invalid_code', 'This answer code is for another offer'))).toEqual({ message: 'This is not their answer to your request. Scan the code their wallet shows after scanning yours.', again: true })
  })

  it('says the connection closed, not that the scan was late, when the link closed after the answer was taken', () => {
    for (const closed of [new WebRTPayError('closed', 'Data channel closed'), new WebRTPayError('closed', 'Link closed during the handshake')]) {
      expect(offerFailure(closed)).toEqual({ message: 'The connection closed before a payment arrived. Create a new request to try again.', again: false })
    }
  })

  it('points at the 15-second window when their wallet never connected', () => {
    for (const failure of [new WebRTPayError('timeout', 'Handshake not finished within 30000 ms'), new WebRTPayError('auth_failed', 'bad signature'), new Error('anything else')]) {
      expect(offerFailure(failure)).toEqual({ message: 'Their wallet did not connect. Scan their answer within 15 seconds of it appearing. Create a new request to try again.', again: false })
    }
  })
})

// ---- the exchange --------------------------------------------------------------------------

describe('paying a recipient’s offer code', () => {
  it('pays exactly the amount in the offer, then the payee sees the verified sender and the amount', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const { offer, received } = await request(payee, { amount: 1200 })
    const box = outbox()

    const onConnected = vi.fn(() => { expect(box.persist).not.toHaveBeenCalled() })
    const answer = await answerDirectRequest({ client: client(payer), wallet: payer.wallet, originator: ORIGIN, identity: payer.identityKey, chain: CHAIN, code: offer.code, amount: 999, persist: box.persist, markDelivered: box.markDelivered, onConnected })
    expect(answer.offer).toMatchObject({ identityKey: payee.identityKey, amount: 1200 })
    expect(payer.createAction).not.toHaveBeenCalled() // nothing is made before the payee connects
    expect(onConnected).not.toHaveBeenCalled()

    const peer = await offer.complete(answer.answerCode)
    expect(peer.peerIdentityKey).toBe(payer.identityKey)
    const { payment, ack } = await answer.delivered

    expect(ack).toMatchObject({ status: 'accepted', txid: payment.txid })
    expect(payment).toMatchObject({ recipient: payee.identityKey, amount: 1200, via: 'direct' })
    expect(payer.created()).toHaveLength(1)
    expect(payer.created()[0][0].outputs[0].satoshis).toBe(1200)
    expect(box.rows).toEqual([payment])
    expect(box.markDelivered).toHaveBeenCalledWith(payment.txid)
    expect(onConnected).toHaveBeenCalledTimes(1)
    expect(payee.internalizeAction).toHaveBeenCalledTimes(1)
    expect(payee.internalizeAction.mock.calls[0][0].outputs[0].paymentRemittance.senderIdentityKey).toBe(payer.identityKey)
    await vi.waitFor(() => expect(received).toEqual([{ amount: 1200, sender: payer.identityKey, status: 'accepted', repeat: false, added: true }]))
  })

  it('pays the amount the payer chose when the offer names none', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const { offer, received } = await request(payee)
    const box = outbox()
    const answer = await answerDirectRequest({ client: client(payer), wallet: payer.wallet, originator: ORIGIN, identity: payer.identityKey, chain: CHAIN, code: offer.code, amount: 2100, persist: box.persist, markDelivered: box.markDelivered })
    await offer.complete(answer.answerCode)
    const { payment } = await answer.delivered
    expect(payment.amount).toBe(2100)
    await vi.waitFor(() => expect(received).toHaveLength(1))
  })

  it('delivers a saved payment with its own transaction instead of making a new one', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const existing = { ...(await prepareMessageBoxPayment(payer.wallet, payee.identityKey, 800, ORIGIN, undefined, () => {})), via: 'direct' as const }
    payer.createAction.mockClear()
    const { offer, received } = await request(payee, { amount: 800 })
    const box = outbox()

    const answer = await answerDirectRequest({ client: client(payer), wallet: payer.wallet, originator: ORIGIN, identity: payer.identityKey, chain: CHAIN, code: offer.code, existing, persist: box.persist, markDelivered: box.markDelivered })
    await offer.complete(answer.answerCode)
    const { payment } = await answer.delivered

    expect(payment).toBe(existing)
    expect(payer.created()).toHaveLength(0)
    expect(box.persist).not.toHaveBeenCalled()
    expect(box.markDelivered).toHaveBeenCalledWith(existing.txid)
    expect(txidOf(payee.internalizeAction.mock.calls[0][0].tx)).toBe(existing.txid)
    await vi.waitFor(() => expect(received).toEqual([{ amount: 800, sender: payer.identityKey, status: 'accepted', repeat: false, added: true }]))
  })

  it('refuses an offer for another network before answering it', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const { offer } = await request(payee, { chain: 'main' })
    const payerClient = client(payer)
    const answerOfferCode = vi.spyOn(payerClient, 'answerOfferCode')
    const box = outbox()
    await expect(answerDirectRequest({ client: payerClient, wallet: payer.wallet, originator: ORIGIN, identity: payer.identityKey, chain: CHAIN, code: offer.code, amount: 500, persist: box.persist, markDelivered: box.markDelivered }))
      .rejects.toThrow(/for Mainnet.*Testnet/)
    expect(answerOfferCode).not.toHaveBeenCalled()
    expect(payer.createAction).not.toHaveBeenCalled()
  })

  it('refuses an invalid chosen amount, or a saved payment for someone else or another amount, before answering', async () => {
    const payer = await makePayer(), payee = await makePayee(), other = await makePayee()
    const { offer } = await request(payee)
    const fixed = await request(payee, { amount: 1200 })
    const payerClient = client(payer)
    const answerOfferCode = vi.spyOn(payerClient, 'answerOfferCode')
    const box = outbox()
    const base = { client: payerClient, wallet: payer.wallet, originator: ORIGIN, identity: payer.identityKey, chain: CHAIN, code: offer.code, persist: box.persist, markDelivered: box.markDelivered }
    await expect(answerDirectRequest({ ...base })).rejects.toThrow(/positive amount/)
    await expect(answerDirectRequest({ ...base, amount: 0 })).rejects.toThrow(/positive amount/)
    const elsewhere = await prepareMessageBoxPayment(payer.wallet, other.identityKey, 300, ORIGIN, undefined, () => {})
    await expect(answerDirectRequest({ ...base, existing: elsewhere })).rejects.toThrow(/another recipient/)
    const smaller = await prepareMessageBoxPayment(payer.wallet, payee.identityKey, 300, ORIGIN, undefined, () => {})
    await expect(answerDirectRequest({ ...base, code: fixed.offer.code, existing: smaller })).rejects.toThrow(/another amount than the request/)
    expect(answerOfferCode).not.toHaveBeenCalled()
  })

  // The payee connected, so the screen must say what happened to the money: a wallet failure
  // while making the payment (here insufficient funds) spent nothing.
  it('says nothing was spent when the wallet cannot make the payment after the payee connected, keeping the wallet\'s words', async () => {
    const payer = await makePayer(), payee = await makePayee()
    payer.createAction.mockRejectedValueOnce(Object.assign(new Error('Insufficient funds in the available inputs to cover the cost of the required outputs and the transaction fee (1245 more satoshis are needed).'), { name: 'WERR_INSUFFICIENT_FUNDS' }))
    const { offer } = await request(payee, { amount: 1200 })
    const box = outbox()
    const answer = await answerDirectRequest({ client: client(payer), wallet: payer.wallet, originator: ORIGIN, identity: payer.identityKey, chain: CHAIN, code: offer.code, persist: box.persist, markDelivered: box.markDelivered })
    // The payer closes the connection as soon as its wallet fails, which can be before its last
    // handshake message reaches the payee (final review D8): the payee's side may then fail with
    // `closed`, and its screen must say the connection closed, not that a scan came too late.
    const [completed, delivered] = await Promise.allSettled([offer.complete(answer.answerCode), answer.delivered])

    expect(delivered.status).toBe('rejected')
    const error = (delivered as PromiseRejectedResult).reason
    expect(error).toBeInstanceOf(NotSentError)
    expect(error.message).toBe('Your wallet could not make the payment, so nothing was spent. Ask them for a new code and try again.')
    expect(error.detail).toMatch(/^Insufficient funds in the available inputs/)
    if (completed.status === 'rejected') {
      expect(completed.reason).toMatchObject({ code: 'closed' })
      expect(offerFailure(completed.reason)).toEqual({ message: 'The connection closed before a payment arrived. Create a new request to try again.', again: false })
    }
    expect(box.persist).not.toHaveBeenCalled()
    expect(payer.createAction.mock.calls.some(([args]) => args.options?.sendWith)).toBe(false)
    expect(payee.internalizeAction).not.toHaveBeenCalled()
  })

  it('spends nothing when the payee never scans the answer', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const { offer } = await request(payee)
    const box = outbox()
    const answer = await answerDirectRequest({ client: client(payer, 1500), wallet: payer.wallet, originator: ORIGIN, identity: payer.identityKey, chain: CHAIN, code: offer.code, amount: 500, persist: box.persist, markDelivered: box.markDelivered })
    await expect(answer.delivered).rejects.toThrow(/did not connect.*Nothing was spent/)
    expect(payer.createAction).not.toHaveBeenCalled()
    expect(box.persist).not.toHaveBeenCalled()
  })

  it('says a saved payment is unchanged when the payee never scans the answer', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const existing = await prepareMessageBoxPayment(payer.wallet, payee.identityKey, 800, ORIGIN, undefined, () => {})
    const { offer } = await request(payee)
    const box = outbox()
    const answer = await answerDirectRequest({ client: client(payer, 1500), wallet: payer.wallet, originator: ORIGIN, identity: payer.identityKey, chain: CHAIN, code: offer.code, existing, persist: box.persist, markDelivered: box.markDelivered })
    const error = await answer.delivered.catch(e => e)
    expect(error.message).toMatch(/saved payment is unchanged/)
    expect(error.message).not.toMatch(/Nothing was spent/)
  })

  it('cancelling before the payee connects spends nothing; once delivery started it cannot be cancelled', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const first = await request(payee)
    const box = outbox()
    const base = { wallet: payer.wallet, originator: ORIGIN, identity: payer.identityKey, chain: CHAIN, amount: 500, persist: box.persist, markDelivered: box.markDelivered }

    const cancelled = await answerDirectRequest({ ...base, client: client(payer), code: first.offer.code })
    expect(cancelled.cancel()).toBe(true)
    await expect(cancelled.delivered).rejects.toThrow(/Nothing was spent/)
    expect(payer.createAction).not.toHaveBeenCalled()

    const second = await request(payee)
    const answer = await answerDirectRequest({ ...base, client: client(payer), code: second.offer.code })
    await second.offer.complete(answer.answerCode)
    await vi.waitFor(() => expect(payer.created()).toHaveLength(1))
    expect(answer.cancel()).toBe(false)
    await expect(answer.delivered).resolves.toMatchObject({ ack: { status: 'accepted' } })
  })
})

describe('receiving with an offer code', () => {
  // Ruling 29: the payer has broadcast it by now, and it pays this wallet. Refusing it would
  // strand the funds until a retry, so it is taken and the difference is shown.
  it('takes a payment for another amount than requested and reports both amounts', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const { offer, received, errors } = await request(payee, { amount: 1200 })
    const payerClient = client(payer) // a payer that ignores the requested amount
    const answer = await payerClient.answerOfferCode(offer.code)
    await offer.complete(answer.answerCode)
    const box = outbox()
    const { ack } = await deliverDirect({ client: payerClient, wallet: payer.wallet, originator: ORIGIN, recipient: payee.identityKey, amount: 500, persist: box.persist, markDelivered: box.markDelivered, peer: await answer.connected })

    expect(ack.status).toBe('accepted')
    expect(payee.internalizeAction).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(received).toEqual([{ amount: 500, requested: 1200, sender: payer.identityKey, status: 'accepted', repeat: false, added: true }]))
    expect(errors).toEqual([])
  })

  it('reports a payment delivered again (the payer lost the ack) as a repeat the wallet did not add again', async () => {
    const payer = await makePayer(), payee = await makePayee()
    const box = outbox()
    const first = await request(payee)
    const answer = await answerDirectRequest({ client: client(payer), wallet: payer.wallet, originator: ORIGIN, identity: payer.identityKey, chain: CHAIN, code: first.offer.code, amount: 700, persist: box.persist, markDelivered: box.markDelivered })
    await first.offer.complete(answer.answerCode)
    const { payment } = await answer.delivered

    const again = await request(payee)
    const redelivery = await answerDirectRequest({ client: client(payer), wallet: payer.wallet, originator: ORIGIN, identity: payer.identityKey, chain: CHAIN, code: again.offer.code, existing: payment, persist: box.persist, markDelivered: box.markDelivered })
    await again.offer.complete(redelivery.answerCode)
    await expect(redelivery.delivered).resolves.toMatchObject({ ack: { status: 'accepted' } })

    await vi.waitFor(() => expect(again.received).toEqual([{ amount: 700, sender: payer.identityKey, status: 'accepted', repeat: true, added: false }]))
    expect(payee.internalizeAction).toHaveBeenCalledTimes(1)
  })

  // Final review M10: the payer has broadcast by now, so a payment that arrives while a network
  // or profile switch holds wallet work off is kept for the retry, not refused.
  it('keeps, rather than refuses, a payment that arrives while a network switch holds wallet work off', async () => {
    const payer = await makePayer(), payee = await makePayee()
    let handlers: ReceiveHandlers | undefined
    const offering = { createOfferCode: vi.fn(async (o: { handlers: ReceiveHandlers }) => { handlers = o.handlers; return { code: 'webrtpay1:x', sid: 's', complete: vi.fn(), cancel: vi.fn() } }) } as unknown as DirectPayClient
    const received: ReceivedDirectPayment[] = []
    await createDirectRequest({ client: offering, wallet: payee.wallet, originator: ORIGIN, identity: payee.identityKey, chain: CHAIN, amount: 1200, onReceived: r => { received.push(r) } })
    const derivationPrefix = Utils.toBase64(Random(16)), derivationSuffix = Utils.toBase64(Random(16))
    const { publicKey } = await payer.wallet.getPublicKey({ protocolID: [2, '3241645161d8'], keyID: `${derivationPrefix} ${derivationSuffix}`, counterparty: payee.identityKey })
    const { tx } = paymentBeef(new P2PKH().lock(PublicKey.fromString(publicKey).toHash()).toHex(), 1200)
    const payment: IncomingPayment = { messageId: 'm1', sender: payer.identityKey, token: { customInstructions: { derivationPrefix, derivationSuffix }, transaction: tx, amount: 1200, outputIndex: 0 } }

    setHttpBridgePaused(true)
    try {
      await expect(handlers!.onPayment(payment, { txid: txidOf(tx) })).resolves.toBe('received')
    } finally {
      setHttpBridgePaused(false)
    }

    expect(payee.internalizeAction).not.toHaveBeenCalled()
    expect(received).toEqual([{ amount: 1200, sender: payer.identityKey, status: 'received', repeat: false, added: false }])
    expect(JSON.parse(local.get(`direct-pay-retry-v1:${payee.identityKey}:${CHAIN}`)!)).toHaveLength(1)
  })

  it('reports no requested amount when the payment matches it, or when none was asked for', async () => {
    const payer = await makePayer(), payee = await makePayee()
    for (const amount of [800, undefined]) {
      const { offer, received } = await request(payee, { amount })
      const box = outbox()
      const answer = await answerDirectRequest({ client: client(payer), wallet: payer.wallet, originator: ORIGIN, identity: payer.identityKey, chain: CHAIN, code: offer.code, amount: 800, persist: box.persist, markDelivered: box.markDelivered })
      await offer.complete(answer.answerCode)
      await answer.delivered
      await vi.waitFor(() => expect(received).toHaveLength(1))
      expect(received[0]).not.toHaveProperty('requested')
    }
  })
})

// ---- wiring --------------------------------------------------------------------------------

/** The source of the call that starts at `start`, through its closing parenthesis. */
function callText(src: string, start: number): string {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return src.slice(start, i + 1)
  }
  throw new Error(`Unclosed call at ${start}`)
}

describe('Nearby → Direct (WebRTC) wiring', () => {
  const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '../src/lib/pages/Dashboard/Payments', file), 'utf8')
  let page: string, nearby: string, exchange: string
  beforeAll(() => {
    page = read('index.tsx')
    nearby = read('NearbyPayments.tsx')
    exchange = read('DirectCodeExchange.tsx')
  })

  it('routes a scanned or pasted webrtpay1: code to Nearby with the code prefilled', () => {
    const adopt = page.slice(page.indexOf('const adoptCode'))
    expect(adopt).toMatch(/^const adoptCode = useCallback\(\(value: string\) => \{ setError\(''\); setNotice\(''\); if \(value\.startsWith\('bsvpay1:'\) \|\| isDirectCode\(value\)\) \{ setNearbyRequest\(value\); history\.replace\(\{ pathname: location\.pathname, search: '\?tab=nearby' \}\)/)
    expect(page).toMatch(/if \(value\.startsWith\('bsvpay1:'\) \|\| isDirectCode\(value\)\) \{ identitySearch\.handleInputChange\(null, '', 'clear'\); adoptCode\(value\); return \}/)
    expect(page).toMatch(/initialRequest=\{nearbyRequest && !isDirectCode\(nearbyRequest\) \? nearbyRequest : undefined\} initialDirectCode=\{isDirectCode\(nearbyRequest\) \? nearbyRequest : undefined\} outbox=\{nearbyOutbox\}/)
  })

  it('lets Nearby save and mark payments through the page’s outbox, reading the latest rows', () => {
    expect(page).toMatch(/const addOutgoing = useCallback\(\(row: OutgoingPayment\) => writeOutbox\(key => addToOutbox\(key, row\)\), \[writeOutbox\]\)/)
    expect(page).toMatch(/const markOutgoingDelivered = useCallback\(\(txid: string\) => writeOutbox\(key => markOutboxDelivered\(key, txid\)\), \[writeOutbox\]\)/)
    expect(page).toMatch(/const nearbyOutbox = useMemo<DirectOutbox>\(\(\) => \(\{ rows: outgoing, add: addOutgoing, markDelivered: markOutgoingDelivered \}\)/)
  })

  // A delivery can finish 30–75 s after it began, after other flows (Nearby, Retry directly,
  // a remounted page) saved rows. A write built from a render's `outgoing` would drop them,
  // and with them the only copy of a broadcast payment's token. outbox.test.ts tests the
  // helper itself; this checks that the page writes only through it.
  it('builds every outbox write from the rows stored at that moment, never from a render’s copy', () => {
    // The page never touches storage itself: it reads and writes through outbox.ts.
    expect(page).not.toMatch(/localStorage/)
    // It writes with outbox.ts's own helpers, never an updater of its own (C9 review).
    expect(page).toMatch(/import \{ addToOutbox, markOutboxDelivered, outboxStorageKey, readOutbox, subscribeOutbox \} from '\.\/outbox'/)
    expect(page).not.toMatch(/updateOutbox|updateOutgoing/)
    expect(page).not.toMatch(/rows => \[\.\.\.rows, row\]|row\.txid === txid \?/)
    expect(page).toMatch(/const writeOutbox = useCallback\(\(write: \(key: string\) => OutgoingPayment\[\]\) => \{ if \(!outboxKey\) throw new Error\('Your wallet identity is still loading\.'\); setOutgoing\(write\(outboxKey\)\) \}, \[outboxKey\]\)/)
    // The state shows the stored rows: on load, after its own writes, and after writes made elsewhere in the window.
    expect([...page.matchAll(/setOutgoing\(/g)].map(m => callText(page, m.index!))).toEqual([
      'setOutgoing([])',
      'setOutgoing(rows)',
      'setOutgoing(readOutbox(key) ?? [])',
      'setOutgoing(write(outboxKey))'
    ])
    expect(page).toMatch(/return subscribeOutbox\(key => \{ if \(key === outboxKey\) setOutgoing\(readOutbox\(key\) \?\? \[\]\) \}\) \}, \[outboxKey\]\)/)
    // writeOutbox is called only by the two helpers, each with one outbox.ts write.
    expect([...page.matchAll(/writeOutbox\(/g)].map(m => callText(page, m.index!))).toEqual([
      'writeOutbox(key => addToOutbox(key, row))',
      'writeOutbox(key => markOutboxDelivered(key, txid))'
    ])
    // Every writer goes through the helpers; none passes rows of its own.
    const adds = [...page.matchAll(/addOutgoing\(/g)].map(m => callText(page, m.index!))
    expect(adds).toEqual(['addOutgoing(row)', 'addOutgoing(payment)'])
    expect([...page.matchAll(/markOutgoingDelivered\(/g)].map(m => callText(page, m.index!))).toEqual(['markOutgoingDelivered(payment.txid)'])
    expect(page.match(/markDelivered: markOutgoingDelivered\b/g)).toHaveLength(3) // Send direct, Retry directly, Nearby
    // No writer captures the render's rows.
    expect(page).not.toMatch(/saveOutgoing|outgoingRef|nextRows|readOutgoing/)
    expect(page).not.toMatch(/\[\.\.\.outgoing\b/)
    expect(page).not.toMatch(/\boutgoing\.map\(/)
    expect(page).not.toMatch(/rows = outgoing\b/)
    expect(page).toMatch(/const deliver = async \(payment: OutgoingPayment\) => \{/)
  })

  it('switches Nearby between Animated QR and Direct (WebRTC), opening Direct for a direct code', () => {
    expect(nearby).toMatch(/useState<'airgap' \| 'direct'>\(initialDirectCode \? 'direct' : 'airgap'\)/)
    expect(nearby).toMatch(/<ToggleButton value="airgap">Animated QR<\/ToggleButton><ToggleButton value="direct">Direct \(WebRTC\)<\/ToggleButton>/)
    expect(nearby).toMatch(/<DirectCodeExchange identity=\{identity\} initialCode=\{initialDirectCode\} outbox=\{outbox\} onSuccess=\{onSuccess\} \/>/)
  })

  it('shows codes as level M QR codes of 260 with copy, and only when they fit', () => {
    expect(exchange.match(/<QRCodeSVG value=\{code\} size=\{260\}[^>]*level="M"/g)).toHaveLength(1)
    expect(exchange).toMatch(/codeFitsQr\(code\) \?/)
    expect(exchange).toMatch(/navigator\.clipboard\.writeText\(code\)/)
  })

  it('creates the offer with receive handlers, and tells the payee how long the answer lasts', () => {
    expect(exchange).toMatch(/createDirectRequest\(\{ client, wallet, originator: adminOriginator, identity, chain, amount: requestAmount \?\? undefined,/)
    expect(exchange).toMatch(/Scan their answer within 15 seconds of it appearing\./)
    expect(exchange).toMatch(/\.complete\(value\)/)
  })

  it('answers with the payer’s saved payment for that recipient when there is one', () => {
    expect(exchange).toMatch(/pendingPaymentFor\(outbox\.rows, offerCode\.identityKey, offerCode\.amount\)/)
    // Plain text: AmountDisplay can render a button, which must not sit inside this one.
    expect(exchange).toMatch(/>Deliver saved payment of \{saved\.amount\.toLocaleString\(\)\} satoshis<\/Button>/)
    expect(exchange).toMatch(/answerDirectRequest\(\{ client, wallet, originator: adminOriginator, identity, chain, code: review\.code, amount: review\.amount, existing: review\.saved,\s+persist: row => \{ outbox\.add\(row\); prepared = true \}, markDelivered: outbox\.markDelivered,/)
    expect(exchange).toMatch(/const amount = saved \? saved\.amount : chosenAmount/)
    expect(exchange).toMatch(/const chosenAmount = offerCode\?\.amount \?\? payAmount/)
  })

  // The page words the notice (directReceipts.test.ts): with the amount, whether the wallet took
  // it, and what was requested (final review D6), also once this screen has closed.
  it('announces a payment on the page like one by identity key, and reports a balance change once, not again for a redelivery', () => {
    const received = exchange.slice(exchange.indexOf('onReceived: payment => {'), exchange.indexOf('onError: e =>'))
    expect(received).toMatch(/if \(payment\.added\) window\.dispatchEvent\(new CustomEvent\('balance-changed'\)\)/)
    expect(received).toMatch(/if \(!payment\.repeat\) window\.dispatchEvent\(new CustomEvent\('direct-payment-received', \{ detail: \{ amount: payment\.amount, sender: payment\.sender, status: payment\.status, requested: payment\.requested \} \}\)\)/)
    // The screen still finishes its session either way.
    expect(received).toMatch(/if \(alive\.current\) \{ setReceived\(payment\); setPhase\('received'\); setError\(''\) \}/)
    expect(received).not.toMatch(/onSuccess/)
  })

  it('shows the wallet\'s own words under a failure that spent nothing', () => {
    expect(exchange).toMatch(/setErrorDetail\(failure instanceof NotSentError && failure\.detail \? \{ error: text, detail: failure\.detail \} : null\)/)
    expect(exchange).toMatch(/\{errorDetail\?\.error === error && <Typography variant="body2" sx=\{\{ mt: \.5 \}\}>\{errorDetail\.detail\}<\/Typography>\}/)
  })

  it('shows the payment that arrived with DirectReceiptView, which directReceipts.test.ts renders', () => {
    expect(exchange).toMatch(/phase === 'received' && received \? <DirectReceiptView received=\{received\} onAgain=\{newRequest\} \/>/)
    expect(exchange).not.toMatch(/Payment received/)
  })

  // Final review M22: an answer that finishes after the screen closed must not reject unobserved.
  it('observes the delivery of an answer made after the screen closed, and cancels it', () => {
    expect(exchange).toMatch(/if \(!alive\.current\) \{ const stopped = next\.cancel\(\); next\.delivered\.catch\(failure => \{ if \(!stopped\) console\.warn\('\[DirectCodeExchange\] A direct payment answered after leaving the screen did not complete:', failure\) \}\); return \}/)
  })

  it('says why direct payments are unavailable instead of "not ready" for ever', () => {
    expect(exchange).toMatch(/const unavailable = codeExchangeProblem\(directPay\)/)
    expect(exchange).toMatch(/\{unavailable && <Alert severity=\{directPay\.error \? 'error' : 'info'\}>\{unavailable\}<\/Alert>\}/)
  })

  it('cancels unanswered codes when the screen closes', () => {
    expect(exchange).toMatch(/return \(\) => \{ alive\.current = false; if \(!sessionRef\.current\) offerRef\.current\?\.cancel\(\); answerRef\.current\?\.cancel\(\) \}/)
  })
})
