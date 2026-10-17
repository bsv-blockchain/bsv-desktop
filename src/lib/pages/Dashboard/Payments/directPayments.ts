/**
 * Direct (peer-to-peer) payments: the send and receive flows over @bsv/webrtpay.
 *
 * Sending connects to the recipient's wallet and authenticates it before anything is
 * spent, then prepares, saves, broadcasts and delivers the payment exactly like the
 * message box path (same outbox row, same PaymentToken).
 *
 * Receiving takes the payment into the wallet at once. Only a payment the wallet cannot
 * take right now (locked, or its storage or network unavailable) is kept on this device
 * for a retry and acknowledged as received; anything the wallet refuses is rejected, so
 * a peer cannot fill this device's storage with payments that will never verify.
 */
import { Transaction, Utils } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'
import { acceptDirectPayment, paymentKey, WebRTPayError } from '@bsv/webrtpay'
import type { AuthenticatedPeer, DirectPayClient, IncomingPayment, PaymentAck, SeenStore } from '@bsv/webrtpay'
import { prepareMessageBoxPayment } from './messageBoxPayments'
import type { OutgoingPayment } from './messageBoxPayments'
import { broadcastNearbyPayment } from './nearbyProtocol'
import { identityKey, validAmount } from './paymentProtocol'

/** Payment keys remembered per wallet and network, newest kept. */
const SEEN_LIMIT = 5000
/** Payments waiting for the wallet; a new one is refused while this many wait. */
const RETRY_LIMIT = 50
/** Characters of stored retry JSON (transactions are kept as base64). */
const RETRY_BUDGET = 1_000_000

const seenStorageKey = (identity: string, chain: string) => `direct-pay-seen-v1:${identity}:${chain}`
const retryStorageKey = (identity: string, chain: string) => `direct-pay-retry-v1:${identity}:${chain}`

/** Reasons sent to the payer: fixed text, so nothing about this wallet's internals leaks. */
const NOT_ACCEPTED = 'The wallet could not verify or record this payment'
const CANNOT_KEEP = 'The wallet cannot take payments right now; try again later'

// ---- sending -----------------------------------------------------------------------------

/**
 * Pays `recipient` directly. Connects first (unless `peer` is already connected to the
 * recipient), so an unreachable recipient costs nothing. Then uses `existing` or prepares a
 * new payment (saved through `persist` with `via: 'direct'` before it is broadcast),
 * broadcasts it, sends it and waits for the ack. `accepted` and `received` mark the row
 * delivered; `rejected` throws with the recipient's reason. The peer is always closed.
 * With `existing`, `amount` is ignored: the saved transaction is delivered as it is.
 */
export async function deliverDirect(o: {
  client: DirectPayClient
  wallet: WalletInterface
  originator: string
  recipient: string
  amount: number
  existing?: OutgoingPayment
  persist: (p: OutgoingPayment) => void
  markDelivered: (txid: string) => void
  peer?: AuthenticatedPeer
}): Promise<{ payment: OutgoingPayment; ack: PaymentAck }> {
  let recipient: string
  try {
    recipient = identityKey(o.recipient)
    if (o.existing && o.existing.recipient !== recipient) throw new Error('This saved payment is for another recipient.')
    if (!o.existing && !validAmount(o.amount)) throw new Error('Enter a positive amount.')
  } catch (error) {
    o.peer?.close()
    throw error
  }
  const peer = o.peer ?? (await connect(o.client, recipient, o.existing !== undefined))
  try {
    if (peer.peerIdentityKey !== recipient) throw new Error('The connected wallet is not the recipient. Nothing was sent.')
    let payment = o.existing
    if (!payment) {
      const prepared = await prepareMessageBoxPayment(o.wallet, recipient, o.amount, o.originator, undefined, row => o.persist({ ...row, via: 'direct' }))
      payment = { ...prepared, via: 'direct' }
    }
    await broadcastNearbyPayment(o.wallet, payment.txid, o.originator)
    let ack: PaymentAck
    try {
      ack = await o.client.sendPayment(peer, payment.token)
    } catch {
      throw new Error("The recipient's wallet did not confirm the payment before the connection ended. Retry delivery directly or through the message box; it reuses the same transaction.")
    }
    if (ack.status === 'rejected') throw new Error(`The recipient rejected this payment: ${ack.reason || 'no reason was given'}`)
    o.markDelivered(payment.txid)
    return { payment, ack }
  } finally {
    peer.close()
  }
}

/** Any connect failure happens before the payment exists (or before a saved one is resent). */
async function connect(client: DirectPayClient, recipient: string, saved: boolean): Promise<AuthenticatedPeer> {
  try {
    return await client.connect(recipient)
  } catch (error) {
    const why = error instanceof WebRTPayError && error.code === 'rejected'
      ? "The recipient's wallet is not taking direct payments right now."
      : "The recipient's wallet could not be reached directly."
    throw new Error(saved
      ? `${why} Your saved payment is unchanged; retry later or deliver it through the message box.`
      : `${why} Nothing was spent. Send it through the message box instead.`)
  }
}

// ---- receiving ---------------------------------------------------------------------------

/**
 * Which payments this wallet already took, so a redelivery (the payer lost the ack) is
 * acknowledged without internalizing it again. Stored on this device per wallet and
 * network, capped at the newest 5000 keys.
 */
export function createSeenStore(identity: string, chain: string): SeenStore {
  const storageKey = seenStorageKey(identity, chain)
  const read = () => readArray(storageKey).filter((key): key is string => typeof key === 'string')
  return {
    has: key => read().includes(key),
    add: key => {
      const keys = [...read().filter(k => k !== key), key].slice(-SEEN_LIMIT)
      // This runs after the wallet took the payment, so it must not fail the payment. A lost
      // record only means a redelivery is internalized again, which the wallet treats as the
      // output it already has.
      try { localStorage.setItem(storageKey, JSON.stringify(keys)) } catch { /* see above */ }
    }
  }
}

/**
 * Takes a payment from an authenticated peer into the wallet (once; see
 * {@link createSeenStore}) and returns the ack status. When the wallet is locked or its
 * storage or network is unavailable, the payment is kept for
 * {@link retryReceivedDirectPayments} and the result is `received`.
 *
 * @throws `WebRTPayError` for the payer, which the client turns into a `rejected` ack:
 * `invalid_payment` when the payment does not pay this wallet; `rejected` when the wallet
 * refuses it (a BEEF, proof or argument check failed, or any failure not known to be
 * temporary) or when it cannot be kept for a retry. Nothing is stored in either case.
 */
export async function receiveDirectPayment(o: {
  wallet: WalletInterface
  originator: string
  identity: string
  chain: string
  payment: IncomingPayment
}): Promise<'accepted' | 'received'> {
  let txid: string
  try {
    ({ txid } = await acceptDirectPayment(o.wallet, o.payment, { originator: o.originator, seen: createSeenStore(o.identity, o.chain) }))
  } catch (error) {
    if (error instanceof WebRTPayError) throw error
    if (!isTemporary(error)) throw new WebRTPayError('rejected', NOT_ACCEPTED, { cause: error })
    keepForRetry(retryStorageKey(o.identity, o.chain), o.payment, error)
    return 'received'
  }
  forget(retryStorageKey(o.identity, o.chain), keyOf(o.payment, txid))
  return 'accepted'
}

/**
 * Offers every kept payment to the wallet again. A payment the wallet takes (or already
 * has) leaves the list, as does one it now refuses; one that still fails for a temporary
 * reason stays. Returns how many payments were added to the wallet.
 */
export async function retryReceivedDirectPayments(o: {
  wallet: WalletInterface
  originator: string
  identity: string
  chain: string
}): Promise<number> {
  const storageKey = retryStorageKey(o.identity, o.chain)
  const seen = createSeenStore(o.identity, o.chain)
  let accepted = 0
  for (const entry of readRetries(storageKey)) {
    try {
      const result = await acceptDirectPayment(o.wallet, toIncoming(entry), { originator: o.originator, seen })
      if (result.status === 'accepted') accepted++
    } catch (error) {
      if (!(error instanceof WebRTPayError) && isTemporary(error)) continue
    }
    forget(storageKey, entry.key)
  }
  return accepted
}

/** Wording of argument and proof checks, which can arrive wrapped in a storage IPC error. */
const VALIDATION = /parameter must be|parameter is missing|merkle ?root/i
/** The wallet is locked, or its storage (over IPC) or network is unavailable. */
const TEMPORARY = /not authenticated|^Storage method \w+ failed:|^Settings not available|^Services not set|^Failed to make storage available|fetch failed|failed to fetch|network ?error|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i

/** Only failures known to be temporary are worth keeping a payment for (audit finding F6). */
function isTemporary(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name
  const message = messageOf(error)
  if (typeof name === 'string' && /^WERR_(INVALID|MISSING|BAD)_/.test(name)) return false
  if (VALIDATION.test(message)) return false
  return name === 'WERR_NOT_ACTIVE' || TEMPORARY.test(message)
}

/** A payment acknowledged as received that the wallet has not taken yet. */
interface RetryEntry {
  /** {@link paymentKey}: one entry per payment output. */
  key: string
  payment: {
    messageId: string
    sender: string
    token: {
      customInstructions: { derivationPrefix: string; derivationSuffix: string }
      /** Atomic BEEF, base64. */
      transaction: string
      amount: number
      outputIndex: number
    }
  }
  /** Why the wallet could not take it (kept on this device only). */
  error: string
  receivedAt: number
}

/**
 * Adds the payment to the retry list, once. Nothing already kept is ever dropped to make
 * room: each entry was acknowledged as received, so the payer will not resend it. A
 * payment that cannot be kept is refused instead; the payer still has it.
 */
function keepForRetry(storageKey: string, p: IncomingPayment, error: unknown): void {
  try {
    const entry = toEntry(p, error)
    const entries = readRetries(storageKey)
    if (entries.some(e => e.key === entry.key)) return
    if (entries.length >= RETRY_LIMIT) throw new Error('Too many payments are waiting for the wallet.')
    const text = JSON.stringify([...entries, entry])
    if (text.length > RETRY_BUDGET) throw new Error('No room to keep this payment.')
    localStorage.setItem(storageKey, text)
  } catch (cause) {
    throw new WebRTPayError('rejected', CANNOT_KEEP, { cause })
  }
}

/** Removes a payment from the retry list; if that fails it stays and a later retry finds it seen. */
function forget(storageKey: string, key: string): void {
  const entries = readRetries(storageKey)
  const rest = entries.filter(e => e.key !== key)
  if (rest.length === entries.length) return
  try {
    if (rest.length) localStorage.setItem(storageKey, JSON.stringify(rest))
    else localStorage.removeItem(storageKey)
  } catch { /* see above */ }
}

function readRetries(storageKey: string): RetryEntry[] {
  return readArray(storageKey).filter((e: any): e is RetryEntry => typeof e?.key === 'string' && typeof e?.payment?.token?.transaction === 'string')
}

function readArray(storageKey: string): unknown[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

/** Same output index rule as the package: the token's, else the payment's, else 0. */
const outputIndexOf = (p: IncomingPayment) => p.token.outputIndex ?? p.outputIndex ?? 0

const keyOf = (p: IncomingPayment, txid: string) =>
  paymentKey(txid, outputIndexOf(p), p.token.customInstructions.derivationPrefix, p.token.customInstructions.derivationSuffix)

function toEntry(p: IncomingPayment, error: unknown): RetryEntry {
  const { transaction, amount, customInstructions: { derivationPrefix, derivationSuffix } } = p.token
  const outputIndex = outputIndexOf(p)
  return {
    key: keyOf(p, Transaction.fromAtomicBEEF(transaction).id('hex')),
    payment: { messageId: p.messageId, sender: p.sender, token: { customInstructions: { derivationPrefix, derivationSuffix }, transaction: Utils.toBase64(transaction), amount, outputIndex } },
    error: messageOf(error).slice(0, 500),
    receivedAt: Date.now()
  }
}

function toIncoming(entry: RetryEntry): IncomingPayment {
  const { messageId, sender, token } = entry.payment
  return { messageId, sender, token: { ...token, transaction: Utils.toArray(token.transaction, 'base64') } }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
