import { describe, expect, it, vi } from 'vitest'
import { P2PKH, PrivateKey, Transaction, Utils } from '@bsv/sdk'
import { encodeAnswerCode, encodeOfferCode } from '@bsv/webrtpay'
import { identityKey, parsePaymentTarget, peerPayLink, validAmount } from '../src/lib/pages/Dashboard/Payments/paymentProtocol'
import { deliverMessageBoxPayment, prepareMessageBoxPayment } from '../src/lib/pages/Dashboard/Payments/messageBoxPayments'

const key = new PrivateKey(1).toPublicKey().toString()
const address = new PrivateKey(1).toPublicKey().toAddress()
const testAddress = new PrivateKey(1).toPublicKey().toAddress('testnet')
const host = 'https://messagebox.bsvblockchain.tech'
const prefix = Utils.toBase64([1, 2, 3, 4])
const suffix = Utils.toBase64([5, 6, 7, 8])
const wireSession = (fields: Record<string, unknown>) => 'bsvpay1:' + Buffer.from(JSON.stringify(fields)).toString('base64url')
const mobileRequest = { v: 1, c: 4, s: Buffer.from(new Uint8Array(16).fill(1)).toString('base64url'), k: Buffer.from(new Uint8Array(32).fill(2)).toString('base64url'), i: key, a: 1200, n: 'main', p: prefix, x: suffix, o: 'i' }

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

describe('face-to-face codes from other wallets', () => {
  const offer = (fields: Partial<Parameters<typeof encodeOfferCode>[0]> = {}) => encodeOfferCode({ sid: new Uint8Array(16).fill(7), identityKey: key, chain: 'main', amount: 1200, sdp: 'v=0\r\n', ...fields })
  it('pays the identity a WebRTPay offer code names, with its amount, even after the offer expired', () => {
    expect(parsePaymentTarget(offer(), 'main')).toEqual({ kind: 'identity', recipient: key, amount: 1200 })
    expect(parsePaymentTarget(`  ${offer({ amount: undefined, expiresAt: 1000 })}\n`, 'main')).toEqual({ kind: 'identity', recipient: key })
  })
  it('refuses an answer code, an offer for another network or none, and an unreadable code', () => {
    expect(() => parsePaymentTarget(encodeAnswerCode({ sid: new Uint8Array(16).fill(7), sdp: 'v=0\r\n' } as any), 'main')).toThrow('answer code')
    expect(() => parsePaymentTarget(offer({ chain: 'test' }), 'main')).toThrow('This request is for Testnet, but your wallet is on Mainnet')
    expect(() => parsePaymentTarget(offer({ chain: undefined }), 'main')).toThrow('which network')
    expect(() => parsePaymentTarget('webrtpay1:nonsense', 'main')).toThrow('could not be read')
  })
  it('pays the identity a BSV Wallet bsvpay1 request names, and refuses tokens, other networks and bad amounts', () => {
    expect(parsePaymentTarget(wireSession(mobileRequest), 'main')).toEqual({ kind: 'identity', recipient: key, amount: 1200 })
    const { a: _amount, n: _network, ...open } = mobileRequest
    expect(parsePaymentTarget(wireSession(open), 'test')).toEqual({ kind: 'identity', recipient: key })
    expect(() => parsePaymentTarget(wireSession(mobileRequest), 'test')).toThrow('This request is for Mainnet')
    expect(() => parsePaymentTarget(wireSession({ ...mobileRequest, t: {} }), 'main')).toThrow('token request')
    for (const amount of [null, 0, 1.2, -1, '1200']) expect(() => parsePaymentTarget(wireSession({ ...mobileRequest, a: amount }), 'main')).toThrow('invalid amount')
    expect(() => parsePaymentTarget('bsvpay1:%%%', 'main')).toThrow()
  })
  it('makes a payment link without a message box, as BSV Wallet does', () => {
    expect(peerPayLink(key)).toBe(`peerpay:${key}`)
    expect(peerPayLink(key, undefined, 500)).toBe(`peerpay:${key}?sats=500`)
    expect(parsePaymentTarget(peerPayLink(key, undefined, 500), 'main')).toEqual({ kind: 'identity', recipient: key, amount: 500 })
  })
})

describe('payments remain recoverable after interrupted delivery', () => {
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
