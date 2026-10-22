/**
 * The message protocol between the wallet window (the main renderer) and the live payments
 * worker, a hidden sandboxed window that runs @bsv/webrtpay's DirectPayClient and so all of
 * WebRTC (ICE, DTLS, SCTP). The wallet window holds the keys; the worker holds none. See
 * docs/webrtc-direct-payments-design.md ("Live payments worker").
 *
 * The worker can only ask the wallet window for:
 * - five wallet calls under webrtpay's own protocols ({@link checkWalletCall});
 * - to carry signal envelopes through the signaler the wallet window chose (relay or message
 *   box), which stays in the wallet window with its own credentials;
 * - ICE servers (the relay's short-lived TURN servers);
 * - to take a payment, which the wallet window checks ({@link checkIncomingPayment}) and
 *   internalizes itself.
 * Everything it sends is treated as hostile: shapes and sizes are checked before use.
 *
 * Pure: no Electron, DOM or wallet, so both sides and the tests import it.
 */
import { isSignalEnvelope } from '@bsv/webrtpay'
import type { SignalEnvelope } from '@bsv/webrtpay'

/** The four protocol IDs webrtpay uses; only the two below may be asked for by the worker. */
export const SIGNALING_PROTOCOL: readonly [2, string] = [2, 'webrtpay signaling']
export const CHANNEL_PROTOCOL: readonly [2, string] = [2, 'webrtpay channel']

/** A compressed secp256k1 public key, as webrtpay identity keys are. */
const IDENTITY_KEY = /^0[23][0-9a-f]{64}$/
/** Longest key ID asked for: a signal's sid (64 characters at most) or a 32-byte nonce in base64. */
const MAX_KEY_ID_CHARS = 64
/** Most bytes a signal plaintext can have: a 16384-character SDP and the JSON around it. */
export const MAX_SIGNAL_PLAINTEXT_BYTES = 20_000
/** Most bytes a signal ciphertext can have: 24576 base64 characters. */
export const MAX_SIGNAL_CIPHERTEXT_BYTES = 18_432
/** Most bytes of a channel-binding transcript to sign or verify. */
export const MAX_BINDING_BYTES = 4096
/** Longest DER signature. */
const MAX_SIGNATURE_BYTES = 80
/** Longest error message carried across. */
const MAX_ERROR_CHARS = 500
/** Longest note on a payment (webrtpay's own cap). */
const MAX_NOTE_CHARS = 500

// ---- messages ------------------------------------------------------------------------------

/** A request that expects a reply with the same `id`. */
export interface Request {
  t: 'req'
  id: number
  op: string
  [field: string]: unknown
}

/** The reply to a {@link Request}. */
export type Reply =
  | { t: 'res'; id: number; ok: true; value?: unknown }
  | { t: 'res'; id: number; ok: false; error: SerializedError }

/** A one-way message. */
export interface Event {
  t: 'ev'
  op: string
  [field: string]: unknown
}

export type Message = Request | Reply | Event

/** An error as it crosses: a WebRTPayError keeps its code and reason. */
export interface SerializedError {
  name: string
  message: string
  code?: string
  reason?: string
}

/** How the wallet window asks the worker to make a client (functions and the wallet stay behind). */
export interface ClientSpec {
  chain?: string
  /** Whether a signaler carries this client's envelopes (bridged, see the header). */
  signaler: boolean
  iceServers: RTCIceServer[]
  /** Whether the wallet window has an `iceServersProvider` to ask before each gather. */
  iceProvider: boolean
  timeouts?: { connectMs?: number; ackMs?: number; presenceMs?: number; dialMs?: number }
  maxMessageBytes?: number
  limits?: { maxMessageBytes?: number }
}

// ---- checks for what the worker sends ------------------------------------------------------

export class Refused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Refused'
  }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
export const isIdentityKey = (x: unknown): x is string => typeof x === 'string' && IDENTITY_KEY.test(x)
const isKeyId = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_KEY_ID_CHARS
const isProtocol = (x: unknown, p: readonly [2, string]) => Array.isArray(x) && x.length === 2 && x[0] === p[0] && x[1] === p[1]

/** `x` as bytes (a number array, or a typed array the structured clone kept), at most `max` of them. */
export function bytesOf(x: unknown, max: number): number[] {
  const list = ArrayBuffer.isView(x) ? Array.from(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)) : x
  if (!Array.isArray(list) || list.length > max) throw new Refused(`expected at most ${max} bytes`)
  for (const b of list) if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > 255) throw new Refused('expected bytes')
  return list as number[]
}

/** The wallet calls a worker may ask for, by method, with the arguments rebuilt from checked fields. */
export type WalletCall =
  | { method: 'getPublicKey'; args: { identityKey: true } }
  | { method: 'encrypt'; args: { plaintext: number[]; protocolID: [2, string]; keyID: string; counterparty: string } }
  | { method: 'decrypt'; args: { ciphertext: number[]; protocolID: [2, string]; keyID: string; counterparty: string } }
  | { method: 'createSignature'; args: { data: number[]; protocolID: [2, string]; keyID: string; counterparty: string } }
  | { method: 'verifySignature'; args: { data: number[]; signature: number[]; protocolID: [2, string]; keyID: string; counterparty: string } }

/**
 * The wallet call `method(args)` as the worker may make it, rebuilt from its checked fields
 * (nothing unchecked is passed on), or {@link Refused}:
 * - `getPublicKey({ identityKey: true })`, this wallet's identity key;
 * - `encrypt` / `decrypt` under `[2, 'webrtpay signaling']` (signal envelopes);
 * - `createSignature` / `verifySignature` under `[2, 'webrtpay channel']` (the channel binding).
 * Each other than getPublicKey needs an identity-key counterparty and a key ID of at most 64
 * characters, and its data is capped. Anything else (another protocol, `self` or `anyone`,
 * spending, HMACs, certificates) is refused. The caller passes its own originator.
 */
export function checkWalletCall(method: unknown, args: unknown): WalletCall {
  if (!isRecord(args)) throw new Refused('wallet arguments must be an object')
  if (method === 'getPublicKey') {
    if (Object.keys(args).length !== 1 || args.identityKey !== true) throw new Refused('only the identity key may be asked for')
    return { method, args: { identityKey: true } }
  }
  const counterparty = args.counterparty
  const keyID = args.keyID
  if (!isIdentityKey(counterparty)) throw new Refused('the counterparty must be an identity key')
  if (!isKeyId(keyID)) throw new Refused('bad key ID')
  if (method === 'encrypt' || method === 'decrypt') {
    if (!isProtocol(args.protocolID, SIGNALING_PROTOCOL)) throw new Refused('encryption is only for webrtpay signaling')
    const protocolID: [2, string] = [2, SIGNALING_PROTOCOL[1]]
    if (method === 'encrypt') return { method, args: { plaintext: bytesOf(args.plaintext, MAX_SIGNAL_PLAINTEXT_BYTES), protocolID, keyID, counterparty } }
    return { method, args: { ciphertext: bytesOf(args.ciphertext, MAX_SIGNAL_CIPHERTEXT_BYTES), protocolID, keyID, counterparty } }
  }
  if (method === 'createSignature' || method === 'verifySignature') {
    if (!isProtocol(args.protocolID, CHANNEL_PROTOCOL)) throw new Refused('signatures are only for the webrtpay channel binding')
    const protocolID: [2, string] = [2, CHANNEL_PROTOCOL[1]]
    const data = bytesOf(args.data, MAX_BINDING_BYTES)
    if (method === 'createSignature') return { method, args: { data, protocolID, keyID, counterparty } }
    return { method, args: { data, signature: bytesOf(args.signature, MAX_SIGNATURE_BYTES), protocolID, keyID, counterparty } }
  }
  throw new Refused(`the worker may not call ${typeof method === 'string' ? method.slice(0, 40) : 'that'}`)
}

/** What the wallet's reply to `call` may carry back to the worker: only the fields webrtpay reads. */
export function walletReply(call: WalletCall, result: unknown): unknown {
  const r = isRecord(result) ? result : {}
  switch (call.method) {
    case 'getPublicKey': return { publicKey: String(r.publicKey) }
    case 'encrypt': return { ciphertext: Array.from(r.ciphertext as ArrayLike<number>) }
    case 'decrypt': return { plaintext: Array.from(r.plaintext as ArrayLike<number>) }
    case 'createSignature': return { signature: Array.from(r.signature as ArrayLike<number>) }
    case 'verifySignature': return { valid: r.valid === true }
  }
}

/** A signal envelope from the worker, copied field by field, or {@link Refused}. */
export function checkEnvelope(e: unknown): SignalEnvelope {
  if (!isSignalEnvelope(e)) throw new Refused('malformed signal envelope')
  return { v: 1, sid: e.sid, ciphertext: e.ciphertext }
}

/** A payment the worker says it received, as webrtpay hands it to `onPayment`. */
export interface CheckedPayment {
  payment: {
    messageId: string
    sender: string
    token: { customInstructions: { derivationPrefix: string; derivationSuffix: string }; transaction: number[]; amount: number; outputIndex?: number }
    outputIndex?: number
  }
  ctx: { note?: string; txid: string }
}

/**
 * A payment from the worker, rebuilt from checked fields (its transaction at most
 * `maxTransactionBytes`), or {@link Refused}. The wallet window still verifies it in full
 * before taking it (`acceptDirectPayment`): this only stops a malformed or oversized one
 * from reaching that code.
 */
export function checkIncomingPayment(p: unknown, ctx: unknown, maxTransactionBytes: number): CheckedPayment {
  if (!isRecord(p) || !isRecord(p.token) || !isRecord(p.token.customInstructions)) throw new Refused('malformed payment')
  const { token } = p
  const ci = token.customInstructions as Record<string, unknown>
  const str = (x: unknown, max: number) => {
    if (typeof x !== 'string' || x.length === 0 || x.length > max) throw new Refused('malformed payment')
    return x
  }
  const index = (x: unknown) => {
    if (x === undefined) return undefined
    if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0) throw new Refused('malformed payment')
    return x
  }
  if (!isIdentityKey(p.sender)) throw new Refused('the payment sender must be an identity key')
  if (typeof token.amount !== 'number' || !Number.isSafeInteger(token.amount) || token.amount <= 0) throw new Refused('malformed payment amount')
  const outputIndex = index(token.outputIndex)
  const paymentIndex = index(p.outputIndex)
  const c = isRecord(ctx) ? ctx : {}
  if (c.note !== undefined && (typeof c.note !== 'string' || c.note.length > MAX_NOTE_CHARS)) throw new Refused('malformed note')
  if (typeof c.txid !== 'string' || !/^[0-9a-f]{64}$/.test(c.txid)) throw new Refused('malformed txid')
  return {
    payment: {
      messageId: str(p.messageId, 128),
      sender: p.sender,
      token: {
        customInstructions: { derivationPrefix: str(ci.derivationPrefix, 400), derivationSuffix: str(ci.derivationSuffix, 400) },
        transaction: bytesOf(token.transaction, maxTransactionBytes),
        amount: token.amount,
        ...(outputIndex !== undefined && { outputIndex })
      },
      ...(paymentIndex !== undefined && { outputIndex: paymentIndex })
    },
    ctx: { ...(typeof c.note === 'string' && { note: c.note }), txid: c.txid }
  }
}

// ---- errors --------------------------------------------------------------------------------

/** `e` as it crosses the port: name, message (capped), and a WebRTPayError's code and reason. */
export function serializeError(e: unknown): SerializedError {
  const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'Unknown error')
  const { code, reason } = err as Error & { code?: unknown; reason?: unknown }
  return {
    name: String(err.name).slice(0, 64),
    message: String(err.message).slice(0, MAX_ERROR_CHARS),
    ...(typeof code === 'string' && { code: code.slice(0, 64) }),
    ...(typeof reason === 'string' && { reason: reason.slice(0, 64) })
  }
}

/** True for a well-formed {@link SerializedError}. */
export function isSerializedError(x: unknown): x is SerializedError {
  return isRecord(x) && typeof x.name === 'string' && typeof x.message === 'string' &&
    (x.code === undefined || typeof x.code === 'string') && (x.reason === undefined || typeof x.reason === 'string')
}
