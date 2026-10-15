import { describe, expect, it, vi } from 'vitest'
import { AirGapDecoder, AirGapEncoder } from '@bsv/air-gap'
import { P2PKH, PrivateKey, SymmetricKey, Transaction, Utils } from '@bsv/sdk'
import { identityKey, parsePaymentTarget, peerPayLink, validAmount } from '../src/lib/pages/Dashboard/Payments/paymentProtocol'
import { buildNearbyPayment, decodeNearbySession, encodeNearbySession, mintNearbySession, sealNearbyFrame, unsealNearbyFrame, verifyNearbyPayment, resolveNearbyFrame, savedPaymentForSession } from '../src/lib/pages/Dashboard/Payments/nearbyProtocol'
import { deliverMessageBoxPayment, prepareMessageBoxPayment } from '../src/lib/pages/Dashboard/Payments/messageBoxPayments'

const key = new PrivateKey(1).toPublicKey().toString()
const otherKey = new PrivateKey(2).toPublicKey().toString()
const address = new PrivateKey(1).toPublicKey().toAddress()
const testAddress = new PrivateKey(1).toPublicKey().toAddress('testnet')
const host = 'https://messagebox.bsvblockchain.tech'
const prefix = Utils.toBase64([1, 2, 3, 4])
const suffix = Utils.toBase64([5, 6, 7, 8])
const session = { identityKey: key, sessionId: new Uint8Array(16).fill(1), psk: new Uint8Array(32).fill(2), derivationPrefix: prefix, derivationSuffix: suffix, amount: 1200 }
const frame = { senderIdentityKey: otherKey, outputIndex: 0, derivationPrefix: prefix, derivationSuffix: suffix, transaction: new Uint8Array([1, 2, 3, 4, 5]), note: 'Coffee' }
const wireSession = (fields: Record<string, unknown>) => 'bsvpay1:' + Buffer.from(JSON.stringify(fields)).toString('base64url')
const mobileRequest = { v: 1, c: 4, s: Buffer.from(session.sessionId).toString('base64url'), k: Buffer.from(session.psk).toString('base64url'), i: key, a: 1200, p: prefix, x: suffix, o: 'i' }

function atomicPayment(amount = 1200) {
  const tx = new Transaction(1, [], [{ lockingScript: new P2PKH().lock(address), satoshis: amount }], 0)
  return { tx, bytes: tx.toAtomicBEEF() }
}
function walletMock() {
  const { bytes, tx } = atomicPayment()
  return {
    getPublicKey: vi.fn(async () => ({ publicKey: key })),
    createAction: vi.fn(async () => ({ signableTransaction: { reference: 'ref', tx: bytes } })),
    signAction: vi.fn(async () => ({ txid: tx.id('hex'), tx: bytes })),
    abortAction: vi.fn(async () => ({ aborted: true }))
  }
}

describe('universal payment inputs', () => {
  it('round trips a mobile-compatible identity payment link with an exact satoshi amount', () => {
    expect(parsePaymentTarget(peerPayLink(key, host, 1200), 'main')).toEqual({ kind: 'identity', recipient: key, host, amount: 1200 })
    expect(parsePaymentTarget(key.toUpperCase(), 'main')).toEqual({ kind: 'identity', recipient: key })
  })
  it('validates address checksums and prevents cross-network sends on all chains', () => {
    expect(parsePaymentTarget(address, 'main').recipient).toBe(address)
    for (const chain of ['test', 'ttn', 'tstn']) {
      expect(parsePaymentTarget(testAddress, chain).recipient).toBe(testAddress)
      expect(() => parsePaymentTarget(address, chain)).toThrow('Switch networks')
    }
    expect(() => parsePaymentTarget(testAddress, 'main')).toThrow('Switch networks')
    expect(() => parsePaymentTarget(address.slice(0, -1) + '2', 'main')).toThrow('valid wallet identity')
  })
  it('parses bitcoin amounts exactly without rounding fractional satoshis', () => {
    expect(parsePaymentTarget(`bitcoin:${address}?amount=0.00001234`, 'main')).toMatchObject({ amount: 1234 })
    expect(() => parsePaymentTarget(`bitcoin:${address}?amount=0.000000001`, 'main')).toThrow('8 decimal')
    expect(() => parsePaymentTarget(`bitcoin:${address}?amount=0&amount=1`, 'main')).toThrow('duplicate')
    expect(() => parsePaymentTarget(`bitcoin:${address}?req-unknown=yes`, 'main')).toThrow('unsupported')
  })
  it('refuses invalid money, ambiguous links, invalid points and token requests', () => {
    for (const amount of [0, -1, 1.2, Infinity, NaN, Number.MAX_SAFE_INTEGER, '100']) expect(validAmount(amount)).toBe(false)
    expect(() => identityKey('02' + 'f'.repeat(64))).toThrow()
    for (const query of ['sats=0', 'sats=1.5', 'sats=NaN', 'sats=1&sats=2', 'asset=' + 'a'.repeat(64) + '.0', 'url=http://example.com', 'url=https://user:pass@example.com']) expect(() => parsePaymentTarget(`peerpay:${key}?${query}`, 'main')).toThrow()
  })
})

describe('BSV Wallet nearby interoperability', () => {
  it('reads a mobile bsvpay1 request and refuses null money, wrong networks and token requests', () => {
    expect(decodeNearbySession(wireSession(mobileRequest))).toMatchObject({ identityKey: key, amount: 1200, derivationPrefix: prefix })
    expect(decodeNearbySession(encodeNearbySession(session))).toEqual(session)
    expect(decodeNearbySession(encodeNearbySession(mintNearbySession(key)))).not.toHaveProperty('amount')
    for (const amount of [null, 0, 1.2, -1, '1200']) expect(() => decodeNearbySession(wireSession({ ...mobileRequest, a: amount }))).toThrow('invalid amount')
    expect(() => decodeNearbySession(wireSession({ ...mobileRequest, t: {} }))).toThrow('token request')
    expect(() => decodeNearbySession(wireSession({ ...mobileRequest, n: 'main' }), 'test')).toThrow('different network')
  })
  it('matches the exact mobile v5 BSV frame layout and AES-GCM seal', () => {
    // This independent fixture follows the mobile codec field order, not the desktop encoder.
    const mobileBytes = [5, 1, ...Utils.toArray(otherKey, 'hex'), 0, prefix.length, ...Buffer.from(prefix), suffix.length, ...Buffer.from(suffix), 6, ...Buffer.from('Coffee'), 5, 1, 2, 3, 4, 5]
    const sealed = sealNearbyFrame(frame, session.psk)
    expect(new SymmetricKey(Array.from(session.psk)).decrypt(Array.from(sealed.slice(1)))).toEqual(mobileBytes)
    expect(unsealNearbyFrame(sealed, session.psk)).toEqual(frame)
  })
  it('authenticates the pairing key and rejects tampering, wrong versions and trailing bytes', () => {
    const sealed = sealNearbyFrame(frame, session.psk)
    expect(() => unsealNearbyFrame(sealed, new Uint8Array(32).fill(3))).toThrow('another pairing')
    const tampered = sealed.slice(); tampered[tampered.length - 1] ^= 1
    expect(() => unsealNearbyFrame(tampered, session.psk)).toThrow('damaged')
    const plain = new SymmetricKey(Array.from(session.psk)).decrypt(Array.from(sealed.slice(1))) as number[]
    const reseal = (bytes: number[]) => new Uint8Array([1, ...new SymmetricKey(Array.from(session.psk)).encrypt(bytes) as number[]])
    expect(() => unsealNearbyFrame(reseal([4, ...plain.slice(1)]), session.psk)).toThrow('Unsupported')
    expect(() => unsealNearbyFrame(reseal([...plain, 0]), session.psk)).toThrow('Invalid nearby')
  })
  it('recovers a multi-part sealed payment after dropped and out-of-order fountain frames', () => {
    const large = { ...frame, transaction: new Uint8Array(14_000).map((_, i) => i % 251) }
    const sealed = sealNearbyFrame(large, session.psk)
    const encoder = new AirGapEncoder(sealed, { blockBytes: 1024, sessionId: new Uint8Array(8).fill(9) })
    const decoder = new AirGapDecoder()
    for (let i = encoder.blockCount; i < 250 && !decoder.message(); i += 2) decoder.accept(encoder.partAt(i))
    expect(decoder.message()).toEqual(sealed)
    expect(unsealNearbyFrame(decoder.message()!, session.psk)).toEqual(large)
  })
  it('recovers a payment for a replaced request and refuses settled request replays', () => {
    const previous = mintNearbySession(key, 1200, 'main')
    const current = mintNearbySession(key, undefined, 'main')
    const pending = { ...frame, derivationPrefix: previous.derivationPrefix, derivationSuffix: previous.derivationSuffix }
    const sealed = sealNearbyFrame(pending, previous.psk)
    const history = [{ code: encodeNearbySession(previous), settled: false }]
    expect(resolveNearbyFrame(sealed, current, history, 'main')).toEqual({ frame: pending, session: previous })
    expect(() => resolveNearbyFrame(sealed, current, [{ ...history[0], settled: true }], 'main')).toThrow('already been paid')
    expect(() => resolveNearbyFrame(sealed, current, history, 'test')).toThrow('another pairing')
  })
  it('does not credit a mismatched session, wrong output, wrong amount, or unverified transaction', async () => {
    const { tx, bytes } = atomicPayment()
    const wallet = walletMock(), tracker = { isValidRootForHeight: vi.fn(), currentHeight: vi.fn() }
    const validFrame = { ...frame, transaction: new Uint8Array(bytes) }
    const parse = vi.spyOn(Transaction, 'fromAtomicBEEF').mockReturnValue(tx)
    const verify = vi.spyOn(tx, 'verify').mockResolvedValue(true)
    try {
      await expect(verifyNearbyPayment(wallet as any, tracker as any, validFrame, session, 'wallet')).resolves.toBe(1200)
      await expect(verifyNearbyPayment(wallet as any, tracker as any, { ...validFrame, derivationSuffix: prefix }, session, 'wallet')).rejects.toThrow('does not match')
      await expect(verifyNearbyPayment(wallet as any, tracker as any, { ...validFrame, outputIndex: 1 }, session, 'wallet')).rejects.toThrow('does not pay')
      await expect(verifyNearbyPayment(wallet as any, tracker as any, validFrame, { ...session, amount: 1201 }, 'wallet')).rejects.toThrow('differs')
      verify.mockResolvedValue(false)
      await expect(verifyNearbyPayment(wallet as any, tracker as any, validFrame, session, 'wallet')).rejects.toThrow('could not be verified')
    } finally { parse.mockRestore(); verify.mockRestore() }
  })
})

describe('payments remain recoverable after interrupted delivery', () => {
  it('prepares without broadcast, persists before exposure, and records the pairing session', async () => {
    const wallet = walletMock(), persist = vi.fn()
    const payment = await buildNearbyPayment(wallet as any, session, 1200, 'wallet', persist)
    expect(wallet.createAction).toHaveBeenCalledTimes(1)
    expect(wallet.createAction.mock.calls[0][0]).toMatchObject({ options: { noSend: true, signAndProcess: false } })
    expect(persist).toHaveBeenCalledWith(payment)
    expect(payment.sessionId).toBe(Utils.toBase64(Array.from(session.sessionId)))
    expect(payment.broadcastPending).toBe(true)
    expect(savedPaymentForSession([payment], session)).toEqual(payment)
    expect(savedPaymentForSession([payment], { ...session, identityKey: otherKey })).toBeUndefined()
    expect(unsealNearbyFrame(new Uint8Array(payment.sealed), session.psk).transaction).toEqual(new Uint8Array(atomicPayment().bytes))
  })
  it('releases a prepared action when saving fails before any code can be shown', async () => {
    const wallet = walletMock()
    await expect(buildNearbyPayment(wallet as any, session, 1200, 'wallet', () => { throw new Error('disk full') })).rejects.toThrow('disk full')
    expect(wallet.abortAction).toHaveBeenCalledWith({ reference: 'ref' }, 'wallet')
    expect(wallet.createAction).toHaveBeenCalledTimes(1)
  })
  it('reports a refused abort instead of claiming the reserved inputs were released', async () => {
    const wallet = walletMock(); wallet.abortAction.mockResolvedValue({ aborted: false })
    await expect(buildNearbyPayment(wallet as any, session, 1200, 'wallet', () => { throw new Error('disk full') })).rejects.toThrow('could not release')
  })
  it('persists a message-box token before delivery; retry reuses the original transaction', async () => {
    const wallet = walletMock(), persist = vi.fn()
    const payment = await prepareMessageBoxPayment(wallet as any, key, 1200, 'wallet', host, persist)
    expect(persist).toHaveBeenCalledWith(payment)
    const client = { sendMessage: vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce({}) }
    await expect(deliverMessageBoxPayment(client as any, payment)).rejects.toThrow('connection lost')
    await deliverMessageBoxPayment(client as any, payment)
    expect(client.sendMessage.mock.calls[0]).toEqual(client.sendMessage.mock.calls[1])
    expect(wallet.createAction).toHaveBeenCalledTimes(1)
    expect(JSON.parse(client.sendMessage.mock.calls[1][0].body).transaction).toEqual(payment.token.transaction)
  })
})
