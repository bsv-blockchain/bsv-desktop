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
import { LockingScript, MerklePath, P2PKH, PrivateKey, ProtoWallet, Transaction, UnlockingScript } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'
import { DirectPayClient } from '@bsv/webrtpay'
import { answerDirectRequest, codeFitsQr, createDirectRequest, pendingPaymentFor, QR_MAX_CHARS, readOfferCode } from '../src/lib/pages/Dashboard/Payments/directCodes'
import type { ReceivedDirectPayment } from '../src/lib/pages/Dashboard/Payments/directCodes'
import { deliverDirect } from '../src/lib/pages/Dashboard/Payments/directPayments'
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
    await vi.waitFor(() => expect(received).toEqual([{ amount: 1200, sender: payer.identityKey, status: 'accepted' }]))
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
    await vi.waitFor(() => expect(received).toEqual([{ amount: 800, sender: payer.identityKey, status: 'accepted' }]))
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
    await vi.waitFor(() => expect(received).toEqual([{ amount: 500, requested: 1200, sender: payer.identityKey, status: 'accepted' }]))
    expect(errors).toEqual([])
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
    expect(page).toMatch(/const addOutgoing = useCallback\(\(row: OutgoingPayment\) => updateOutgoing\(rows => \[\.\.\.rows, row\]\), \[updateOutgoing\]\)/)
    expect(page).toMatch(/const markOutgoingDelivered = useCallback\(\(txid: string\) => updateOutgoing\(rows => rows\.map\(row => row\.txid === txid \? \{ \.\.\.row, delivered: true \} : row\)\), \[updateOutgoing\]\)/)
    expect(page).toMatch(/const nearbyOutbox = useMemo<DirectOutbox>\(\(\) => \(\{ rows: outgoing, add: addOutgoing, markDelivered: markOutgoingDelivered \}\)/)
  })

  // A delivery can finish 30–75 s after it began, after other flows (Nearby, Retry directly,
  // a remounted page) saved rows. A write built from a render's `outgoing` would drop them,
  // and with them the only copy of a broadcast payment's token.
  it('builds every outbox write from the rows stored at that moment, never from a render’s copy', () => {
    // One write path, which reads the stored rows first.
    expect(page.match(/localStorage\.setItem\(/g)).toHaveLength(1)
    expect(page).toMatch(/const updateOutgoing = useCallback\(\(change: \(rows: OutgoingPayment\[\]\) => OutgoingPayment\[\]\) => \{ if \(!outboxKey\) throw new Error\('Your wallet identity is still loading\.'\); const rows = change\(readOutgoing\(outboxKey\) \?\? \[\]\); localStorage\.setItem\(outboxKey, JSON\.stringify\(rows\)\); setOutgoing\(rows\) \}, \[outboxKey\]\)/)
    expect(page).toMatch(/^function readOutgoing\(key: string\): OutgoingPayment\[\] \| null \{$/m)
    // The state is set only on load and by that write path.
    expect([...page.matchAll(/setOutgoing\(([^)]*)\)/g)].map(m => m[1])).toEqual(['[]', 'rows', 'rows'])
    // updateOutgoing is called only with an updater of the rows it is given, and only by the two helpers.
    const updates = [...page.matchAll(/updateOutgoing\(/g)].map(m => callText(page, m.index!))
    expect(updates).toEqual([
      'updateOutgoing(rows => [...rows, row])',
      'updateOutgoing(rows => rows.map(row => row.txid === txid ? { ...row, delivered: true } : row))'
    ])
    // Every writer goes through the helpers; none passes rows of its own.
    const adds = [...page.matchAll(/addOutgoing\(/g)].map(m => callText(page, m.index!))
    expect(adds).toEqual(['addOutgoing(row)', 'addOutgoing(payment)'])
    expect([...page.matchAll(/markOutgoingDelivered\(/g)].map(m => callText(page, m.index!))).toEqual(['markOutgoingDelivered(payment.txid)'])
    expect(page.match(/markDelivered: markOutgoingDelivered\b/g)).toHaveLength(3) // Send direct, Retry directly, Nearby
    // No writer captures the render's rows.
    expect(page).not.toMatch(/saveOutgoing|outgoingRef|nextRows/)
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

  it('shows the requested amount beside a payment of another amount (Ruling 29)', () => {
    expect(exchange).toMatch(/\{received\.requested !== undefined && <Alert severity="warning"[^>]*>Received \{received\.amount\.toLocaleString\(\)\} satoshis — you requested \{received\.requested\.toLocaleString\(\)\}\./)
  })

  it('cancels unanswered codes when the screen closes', () => {
    expect(exchange).toMatch(/return \(\) => \{ alive\.current = false; if \(!sessionRef\.current\) offerRef\.current\?\.cancel\(\); answerRef\.current\?\.cancel\(\) \}/)
  })
})
