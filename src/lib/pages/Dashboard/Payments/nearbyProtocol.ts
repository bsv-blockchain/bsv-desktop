/** BSV-only implementation of BSV Wallet's bsvpay1 session and sealed v5 frame. */
import { ChainTracker, P2PKH, PublicKey, Random, SymmetricKey, Transaction, Utils, WalletInterface } from '@bsv/sdk'
import { MAX_MESSAGE_BYTES } from '@bsv/air-gap'
import { identityKey, validAmount } from './paymentProtocol'

export const PAYMENT_PROTOCOL: [2, string] = [2, '3241645161d8']
export const FOUNTAIN_BLOCK_BYTES = 1024
export interface NearbySession {
  identityKey: string
  chain?: string
  sessionId: Uint8Array
  psk: Uint8Array
  derivationPrefix: string
  derivationSuffix: string
  amount?: number
}
export interface NearbyFrame {
  senderIdentityKey: string
  outputIndex: number
  derivationPrefix: string
  derivationSuffix: string
  note?: string
  transaction: Uint8Array
}
const to64 = (bytes: Uint8Array) => Utils.toBase64(Array.from(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const from64 = (text: string) => {
  if (typeof text !== 'string' || !/^[\w-]*$/.test(text)) throw new Error('Invalid nearby code encoding.')
  return new Uint8Array(Utils.toArray(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4), 'base64'))
}
function nonce(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error('Invalid nearby payment derivation.')
  return value
}
export function mintNearbySession(key: string, amount?: number, chain?: string): NearbySession {
  if (amount !== undefined && !validAmount(amount)) throw new Error('Enter a positive amount.')
  return {
    identityKey: identityKey(key), ...(chain ? { chain } : {}), sessionId: new Uint8Array(Random(16)), psk: new Uint8Array(Random(32)),
    derivationPrefix: Utils.toBase64(Random(16)), derivationSuffix: Utils.toBase64(Random(16)),
    ...(amount === undefined ? {} : { amount })
  }
}
export function encodeNearbySession(session: NearbySession): string {
  return 'bsvpay1:' + to64(new TextEncoder().encode(JSON.stringify({ v: 1, c: 0, ...(session.chain ? { n: session.chain } : {}), s: to64(session.sessionId), k: to64(session.psk), i: session.identityKey, ...(session.amount === undefined ? {} : { a: session.amount }), p: session.derivationPrefix, x: session.derivationSuffix })))
}
export function decodeNearbySession(text: string, expectedChain?: string): NearbySession {
  if (!text.startsWith('bsvpay1:') || text.length > 4000) throw new Error('Scan a BSV Wallet nearby request.')
  let value: any
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(from64(text.slice(8)))) } catch { throw new Error('This nearby request is damaged.') }
  if (!value || value.v !== 1) throw new Error('This nearby request uses an unsupported version.')
  if (value.n !== undefined && !['main', 'test', 'ttn', 'tstn'].includes(value.n)) throw new Error('This nearby request has an invalid network.')
  if (expectedChain && value.n && value.n !== expectedChain) throw new Error('This nearby request is on a different network. Switch networks in Settings first.')
  if (value.t !== undefined) throw new Error('This is a token request. Nearby payments supports BSV.')
  if (value.a !== undefined && !validAmount(value.a)) throw new Error('This nearby request has an invalid amount.')
  const sessionId = from64(value.s), psk = from64(value.k)
  if (sessionId.length !== 16 || psk.length !== 32) throw new Error('This nearby request is damaged.')
  return { identityKey: identityKey(value.i), ...(value.n ? { chain: value.n } : {}), sessionId, psk, derivationPrefix: nonce(value.p), derivationSuffix: nonce(value.x), ...(value.a === undefined ? {} : { amount: value.a }) }
}
function putInt(out: number[], value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid payment field.')
  do { out.push((value % 128) | (value >= 128 ? 128 : 0)); value = Math.floor(value / 128) } while (value)
}
function putBytes(out: number[], bytes: Uint8Array) { putInt(out, bytes.length); for (const byte of bytes) out.push(byte) }
function takeInt(bytes: Uint8Array, pos: { n: number }): number {
  let value = 0, scale = 1
  for (let i = 0; i < 8; i++) {
    if (pos.n >= bytes.length) throw new Error('Truncated payment code.')
    const byte = bytes[pos.n++]; value += (byte & 127) * scale
    if (!Number.isSafeInteger(value)) throw new Error('Invalid payment length.')
    if (!(byte & 128)) return value
    scale *= 128
  }
  throw new Error('Invalid payment length.')
}
function takeBytes(bytes: Uint8Array, pos: { n: number }): Uint8Array {
  const size = takeInt(bytes, pos)
  if (size > bytes.length - pos.n) throw new Error('Truncated payment code.')
  const result = bytes.slice(pos.n, pos.n + size); pos.n += size; return result
}
function takeString(bytes: Uint8Array, pos: { n: number }): string { return new TextDecoder('utf-8', { fatal: true }).decode(takeBytes(bytes, pos)) }
export function sealNearbyFrame(frame: NearbyFrame, psk: Uint8Array): Uint8Array {
  if (psk.length !== 32) throw new Error('Invalid pairing key.')
  const out = [5, 1, ...Utils.toArray(identityKey(frame.senderIdentityKey), 'hex')]
  putInt(out, frame.outputIndex)
  for (const text of [frame.derivationPrefix, frame.derivationSuffix, frame.note ?? '']) putBytes(out, new TextEncoder().encode(text))
  putBytes(out, frame.transaction)
  const sealed = new Uint8Array([1, ...new SymmetricKey(Array.from(psk)).encrypt(out) as number[]])
  if (sealed.length > MAX_MESSAGE_BYTES) throw new Error('This payment is too large for nearby QR. Send it through the message box instead.')
  return sealed
}
export function unsealNearbyFrame(sealed: Uint8Array, psk: Uint8Array): NearbyFrame {
  if (psk.length !== 32 || sealed.length < 49 || sealed.length > MAX_MESSAGE_BYTES || sealed[0] !== 1) throw new Error('Invalid nearby payment envelope.')
  let bytes: Uint8Array
  try { bytes = new Uint8Array(new SymmetricKey(Array.from(psk)).decrypt(Array.from(sealed.slice(1))) as number[]) } catch { throw new Error('This payment belongs to another pairing, or its code is damaged.') }
  if (bytes.length < 35 || bytes[0] !== 5 || bytes[1] !== 1) throw new Error('Unsupported nearby payment. BSV frame version 5 is required.')
  const pos = { n: 35 }
  const senderIdentityKey = identityKey(Utils.toHex(Array.from(bytes.slice(2, 35))))
  const outputIndex = takeInt(bytes, pos)
  const derivationPrefix = nonce(takeString(bytes, pos)), derivationSuffix = nonce(takeString(bytes, pos))
  const note = takeString(bytes, pos), transaction = takeBytes(bytes, pos)
  if (pos.n !== bytes.length || note.length > 500 || !transaction.length) throw new Error('Invalid nearby payment fields.')
  return { senderIdentityKey, outputIndex, derivationPrefix, derivationSuffix, ...(note ? { note } : {}), transaction }
}
export interface SavedNearbyPayment { confirmed?: boolean; broadcastPending?: boolean; sessionId?: string; txid: string; sealed: number[]; amount: number; recipient: string; createdAt: number }
export async function buildNearbyPayment(wallet: WalletInterface, session: NearbySession, amount: number, originator: string, persist: (payment: SavedNearbyPayment) => void): Promise<SavedNearbyPayment> {
  if (!validAmount(amount) || session.amount !== undefined && session.amount !== amount) throw new Error('The amount does not match this request.')
  const { publicKey: senderIdentityKey } = await wallet.getPublicKey({ identityKey: true }, originator)
  const { publicKey } = await wallet.getPublicKey({ protocolID: PAYMENT_PROTOCOL, keyID: `${session.derivationPrefix} ${session.derivationSuffix}`, counterparty: session.identityKey, forSelf: false }, originator)
  const lockingScript = new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()).toHex()
  let reference: string | undefined, persisted = false
  try {
    const result = await wallet.createAction({ description: 'Sent nearby BSV', labels: ['localpay', 'outbound', session.identityKey], outputs: [{ lockingScript, satoshis: amount, outputDescription: 'Nearby BSV payment', customInstructions: JSON.stringify({ derivationPrefix: session.derivationPrefix, derivationSuffix: session.derivationSuffix, type: 'BRC29' }) }], options: { randomizeOutputs: false, signAndProcess: false, noSend: true } }, originator)
    reference = result.signableTransaction?.reference
    const signed = result.tx ? result : result.signableTransaction ? await wallet.signAction({ reference, spends: {}, options: { noSend: true } }, originator) : null
    if (!signed?.tx || !signed?.txid) throw new Error('The wallet did not return a payment transaction.')
    const actual = Transaction.fromAtomicBEEF(signed.tx).outputs[0]?.satoshis
    if (actual !== amount) throw new Error('The wallet returned a different payment amount.')
    const sealed = sealNearbyFrame({ senderIdentityKey, outputIndex: 0, derivationPrefix: session.derivationPrefix, derivationSuffix: session.derivationSuffix, transaction: new Uint8Array(signed.tx) }, session.psk)
    const saved = { broadcastPending: true, sessionId: Utils.toBase64(Array.from(session.sessionId)), txid: signed.txid, sealed: Array.from(sealed), amount, recipient: session.identityKey, createdAt: Date.now() }
    persist(saved); persisted = true
    return saved
  } catch (error) {
    if (reference && !persisted) {
      try { const aborted = await wallet.abortAction({ reference }, originator); if (!aborted.aborted) throw new Error('The wallet refused to release the inputs.') } catch (abortError) { throw new Error(`${(error as Error).message} The wallet could not release the reserved inputs: ${(abortError as Error).message}`) }
    }
    throw error
  }
}
export async function broadcastNearbyPayment(wallet: WalletInterface, txid: string, originator: string): Promise<void> {
  const result = await wallet.createAction({ description: 'Broadcast nearby payment', options: { sendWith: [txid] } }, originator)
  const status = result.sendWithResults?.find(result => result.txid === txid)?.status
  if (!status || status === 'failed') throw new Error('Broadcast is pending. Keep this payment code and retry when connected.')
}
export async function verifyNearbyPayment(wallet: WalletInterface, tracker: ChainTracker, frame: NearbyFrame, session: NearbySession, originator: string): Promise<number> {
  if (frame.derivationPrefix !== session.derivationPrefix || frame.derivationSuffix !== session.derivationSuffix) throw new Error('This payment does not match your request.')
  const tx = Transaction.fromAtomicBEEF(frame.transaction)
  const output = tx.outputs[frame.outputIndex]
  const { publicKey } = await wallet.getPublicKey({ protocolID: PAYMENT_PROTOCOL, keyID: `${frame.derivationPrefix} ${frame.derivationSuffix}`, counterparty: frame.senderIdentityKey, forSelf: true }, originator)
  const script = new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()).toHex()
  if (!output || output.lockingScript.toHex() !== script || !validAmount(output.satoshis)) throw new Error('This payment does not pay your wallet.')
  if (session.amount !== undefined && output.satoshis !== session.amount) throw new Error('The received amount differs from your request.')
  if (!await tx.verify(tracker)) throw new Error('The transaction could not be verified. Connect to the network and try again.')
  return output.satoshis
}

export interface SavedNearbyRequest { code: string; settled: boolean }
/** Old request keys stay useful after replacing a QR: a payment may already be on its way. */
export function resolveNearbyFrame(sealed: Uint8Array, current: NearbySession, archived: SavedNearbyRequest[], chain: string): { frame: NearbyFrame; session: NearbySession } {
  const candidates = [{ code: encodeNearbySession(current), settled: false }, ...archived]
  for (const candidate of candidates) {
    let session: NearbySession, frame: NearbyFrame
    try { session = decodeNearbySession(candidate.code, chain); frame = unsealNearbyFrame(sealed, session.psk) } catch { continue }
    if (session.identityKey !== current.identityKey) continue
    if (archived.some(entry => {
      if (!entry?.settled) return false
      try { const paid = decodeNearbySession(entry.code, chain); return paid.identityKey === session.identityKey && Utils.toBase64(Array.from(paid.sessionId)) === Utils.toBase64(Array.from(session.sessionId)) } catch { return false }
    })) throw new Error('This nearby request has already been paid.')
    return { frame, session }
  }
  throw new Error('This payment belongs to another pairing, or its code is damaged.')
}
export function savedPaymentForSession(records: SavedNearbyPayment[], session: NearbySession): SavedNearbyPayment | undefined {
  return records.find(row => row.sessionId === Utils.toBase64(Array.from(session.sessionId)) && row.recipient === session.identityKey)
}
