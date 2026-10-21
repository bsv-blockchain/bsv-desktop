/**
 * Direct (peer-to-peer) payments: the send and receive flows over @bsv/webrtpay.
 *
 * Sending connects to the recipient's wallet and authenticates it before anything is
 * spent, then prepares, saves, broadcasts and delivers the payment exactly like the
 * message box path (same outbox row, same PaymentToken).
 *
 * Receiving takes the payment into the wallet at once. Only a payment the wallet cannot
 * take right now (locked, its storage or network unavailable, or a network or profile switch
 * under way) is kept on this device for a retry and acknowledged as received; anything the wallet refuses is rejected, so
 * a peer cannot fill this device's storage with payments that will never verify.
 *
 * A kept payment was acknowledged, so its payer will not send it again, and only this device
 * has what is needed to add it (its derivation and transaction). It is therefore never
 * deleted until the wallet has it: a retry the wallet refuses outright, or that still cannot
 * verify it after several tries over more than a day, flags it as needing attention, and the
 * user can copy its recovery details, after which the user (and only the user) may dismiss it
 * (Ruling 36). The kept list also survives wallet removal (see WalletService). A kept list this
 * version cannot read is never written over, and entries it does not recognise are passed
 * through as they are: either may hold the only copy of a payment.
 */
import { Transaction, Utils } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'
import { acceptDirectPayment, MAX_DIRECT_TRANSACTION_BYTES, paymentKey, validatePaymentToken, verifyDirectPayment, WebRTPayError } from '@bsv/webrtpay'
import type { AuthenticatedPeer, DirectPayClient, IncomingPayment, PaymentAck, SeenStore } from '@bsv/webrtpay'
import { prepareMessageBoxPayment } from './messageBoxPayments'
import type { OutgoingPayment } from './messageBoxPayments'
import { broadcastPayment } from './broadcast'
import { identityKey, validAmount } from './paymentProtocol'

/** Payment keys remembered per wallet and network, newest kept. */
const SEEN_LIMIT = 5000
/**
 * Payments waiting for the wallet; a new one is refused while this many wait. Payments that need
 * attention do not count (see {@link keptTowardLimit}).
 */
const RETRY_LIMIT = 50
/** Characters of stored retry JSON (transactions are kept as base64). */
const RETRY_BUDGET = 1_000_000
/**
 * A kept payment the wallet still cannot verify needs attention only after this many failed
 * retries AND this long after it arrived, so a lagging or unreachable chain tracker has time
 * to catch up. Failures known to be temporary (wallet locked, storage or network down) do
 * not count as tries.
 */
const NEEDS_ATTENTION_ATTEMPTS = 5
const NEEDS_ATTENTION_AGE_MS = 24 * 60 * 60 * 1000

/** Every kept-payment list starts with this; such keys outlive logout and wallet removal. */
export const KEPT_DIRECT_PAYMENTS_PREFIX = 'direct-pay-retry-v1:'
const KEPT_CHANGED_EVENT = 'direct-pay-kept-changed'

const seenStorageKey = (identity: string, chain: string) => `direct-pay-seen-v1:${identity}:${chain}`
const retryStorageKey = (identity: string, chain: string) => `${KEPT_DIRECT_PAYMENTS_PREFIX}${identity}:${chain}`

/** Reasons sent to the payer: fixed text, so nothing about this wallet's internals leaks. */
const NOT_ACCEPTED = 'The wallet could not verify or record this payment'
const CANNOT_KEEP = 'The wallet cannot take payments right now; try again later'
/** Why a payment was kept without offering it to the wallet (kept on this device only). */
const WALLET_CHANGING = 'It arrived while the wallet was changing networks or profiles.'

// ---- sending -----------------------------------------------------------------------------

/**
 * A direct payment that stopped before anything was broadcast. The message says so, for the
 * user ("Nothing was spent", or that a saved payment is unchanged); `detail` holds the
 * wallet's own words when the wallet is what stopped it.
 */
export class NotSentError extends Error {
  constructor(message: string, readonly detail = '', readonly failure?: DialFailure) {
    super(message)
    this.name = 'NotSentError'
  }
}

/**
 * Why dialing the recipient failed, for choosing what to offer the user (see payFlow.ts):
 * `offline` (no reply within the presence window), `not_receiving` (their wallet answered but
 * is not taking direct payments, or is busy), `wrong_network`, `network` (the signal could not
 * be posted: this side is offline or the message box host is down), or `link_failed` (they
 * answered but the link or its identity handshake did not come up, or the dial was cancelled).
 */
export type DialFailure = 'offline' | 'not_receiving' | 'link_failed' | 'network' | 'wrong_network'

/** The {@link DialFailure} for an error from `DirectPayClient.connect`. */
export function dialFailure(error: unknown): DialFailure {
  if (!(error instanceof WebRTPayError)) return 'link_failed'
  switch (error.code) {
    case 'peer_unreachable': return 'offline'
    case 'unavailable': return 'network'
    case 'rejected':
      if (error.reason === 'wrong_network') return 'wrong_network'
      if (error.reason === 'not_receiving' || error.reason === 'busy') return 'not_receiving'
      return 'link_failed'
    default: return 'link_failed'
  }
}

/**
 * Pays `recipient` directly. Connects first (unless `peer` is already connected to the
 * recipient), so an unreachable recipient costs nothing. Then uses `existing` or prepares a
 * new payment (saved through `persist` with `via: 'direct'` before it is broadcast),
 * broadcasts it, sends it and waits for the ack. `accepted` and `received` mark the row
 * delivered; `rejected` throws with the recipient's reason. The peer is always closed.
 * With `existing`, `amount` is ignored: the saved transaction is delivered as it is.
 *
 * Before the broadcast the payment is checked as the recipient will check it, and the
 * connection must still be open (a payee hangs up when no payment arrives within its
 * first-message window). A new payment is checked before it is saved, so a refusal releases
 * it and nothing is spent. These refusals, and a failed connect, throw {@link NotSentError}.
 */
export async function deliverDirect(o: {
  client: DirectPayClient
  wallet: WalletInterface
  originator: string
  recipient: string
  amount: number
  /** The message box host the payee's payment link named, kept on a new row for a later "Retry via message box". */
  host?: string
  existing?: OutgoingPayment
  persist: (p: OutgoingPayment) => void
  markDelivered: (txid: string) => void
  peer?: AuthenticatedPeer
  /** Cancels the dial; once connected, a cancelled payment is stopped before it is made. */
  signal?: AbortSignal
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
  const peer = o.peer ?? (await connect(o.client, recipient, o.existing !== undefined, o.signal))
  try {
    if (peer.peerIdentityKey !== recipient) throw new NotSentError('The connected wallet is not the recipient. Nothing was sent.')
    if (o.signal?.aborted) throw new NotSentError(o.existing ? 'Cancelled. Your saved payment is unchanged.' : 'Cancelled. Nothing was spent.', '', 'link_failed')
    let payment = o.existing
    if (payment) {
      const refusal = whyNotDeliverable(peer, payment.token)
      if (refusal) throw new NotSentError(`${refusal.reason} Your saved payment is unchanged; ${refusal.retry ? 'retry later or deliver it' : 'deliver it'} through the message box.`)
    } else {
      const prepared = await prepareMessageBoxPayment(o.wallet, recipient, o.amount, o.originator, o.host, row => {
        // A throw here releases the prepared transaction (prepareMessageBoxPayment aborts it).
        const refusal = whyNotDeliverable(peer, row.token)
        if (refusal) throw new NotSentError(`${refusal.reason} Nothing was spent.`)
        o.persist({ ...row, via: 'direct' })
      })
      payment = { ...prepared, via: 'direct' }
    }
    try {
      await broadcastPayment(o.wallet, payment.txid, o.originator)
    } catch (error) {
      const why = messageOf(error)
      throw new Error(`The payment could not be broadcast yet${why.startsWith('Broadcast is pending.') ? '' : ` (${why.replace(/\.$/, '')})`}; retry when you are online. Retrying reuses the same transaction.`)
    }
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
async function connect(client: DirectPayClient, recipient: string, saved: boolean, signal?: AbortSignal): Promise<AuthenticatedPeer> {
  try {
    return await client.connect(recipient, signal ? { signal } : undefined)
  } catch (error) {
    const failure = dialFailure(error)
    // The user sees a short prompt; the console keeps what actually failed, for diagnosis.
    const e = error as Partial<WebRTPayError> & { cause?: unknown }
    console.warn('[DirectPay] Direct connection failed', { recipient, failure, code: e?.code, reason: e?.reason, message: e?.message, cause: e?.cause })
    // The recipient's wallet, or this one, refused a dial between two networks (the client is
    // bound to this wallet's chain): redialing cannot help until both are on one network.
    if (failure === 'wrong_network') {
      throw new NotSentError(saved
        ? "The recipient's wallet is on a different network. Your saved payment is unchanged; deliver it when you are both on the same network, or through the message box."
        : "The recipient's wallet is on a different network. Nothing was spent.", '', failure)
    }
    // The signal could not be posted at all: this side's network or the message box host.
    if (failure === 'network') {
      throw new NotSentError(saved
        ? "Couldn't reach the payment network — check your connection. Your saved payment is unchanged; retry when you are online."
        : "Couldn't reach the payment network — check your connection. Nothing was spent.", '', failure)
    }
    const why = failure === 'not_receiving' ? "The recipient's wallet is not taking direct payments right now." : "The recipient's wallet could not be reached directly."
    throw new NotSentError(saved
      ? `${why} Your saved payment is unchanged; retry later or deliver it through the message box.`
      : `${why} Nothing was spent. Send it through the message box instead.`, '', failure)
  }
}

/**
 * Why `token` must not be broadcast for delivery over `peer`, checked as the recipient will
 * check it once it arrives (by then it would be on the network), or undefined when it may.
 * `retry`: delivering it directly later can work.
 */
function whyNotDeliverable(peer: AuthenticatedPeer, token: OutgoingPayment['token']): { reason: string; retry: boolean } | undefined {
  const bytes = token.transaction.length
  if (bytes > MAX_DIRECT_TRANSACTION_BYTES) {
    return { reason: `This payment is too large to deliver directly: its transaction is ${bytes.toLocaleString()} bytes, and at most ${MAX_DIRECT_TRANSACTION_BYTES.toLocaleString()} can be delivered.`, retry: false }
  }
  try {
    validatePaymentToken(token)
  } catch (error) {
    return { reason: `The recipient's wallet would refuse this payment: ${messageOf(error).replace(/\.$/, '')}.`, retry: false }
  }
  if (!peer.isOpen) return { reason: "The recipient's wallet closed the connection before the payment was sent.", retry: true }
  return undefined
}

// ---- receiving ---------------------------------------------------------------------------

/**
 * Which payments this wallet already took, so a redelivery (the payer lost the ack) is
 * acknowledged without internalizing it again. Stored on this device per wallet and
 * network, capped at the newest 5000 keys.
 */
export function createSeenStore(identity: string, chain: string): SeenStore {
  const storageKey = seenStorageKey(identity, chain)
  // Unreadable counts as empty here, and add() may replace it: a lost record only means a
  // redelivery is offered to the wallet again, which treats it as the output it already has.
  const read = () => (readArray(storageKey) ?? []).filter((key): key is string => typeof key === 'string')
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

/** What became of a payment from a peer. */
export interface DirectReceipt {
  /** The ack for the payer: in the wallet, or kept on this device until the wallet can take it. */
  status: 'accepted' | 'received'
  /**
   * This wallet had already taken or kept this payment: the payer delivered it again after
   * losing the ack. Announce a payment only when this is false, so it is announced once.
   */
  repeat: boolean
  /**
   * The wallet took the payment just now, so its balance changed. Also true for a repeat:
   * a payment kept earlier and taken on its redelivery.
   */
  added: boolean
}

/** Activity's description of a direct payment received without a note. */
export const DIRECT_DESCRIPTION = 'Received direct BSV'

/**
 * The wallet description of a received direct payment: the payer's note when they sent one
 * (as BSV Wallet does), else {@link DIRECT_DESCRIPTION}. A note is at most 500 characters
 * (the package refuses longer ones), so at most 2000 bytes; it is padded to the wallet's
 * 5-byte minimum.
 */
export function directDescription(note: unknown): string {
  const text = typeof note === 'string' ? Array.from(note.trim()).slice(0, 500).join('') : ''
  return text ? text.padEnd(5) : DIRECT_DESCRIPTION
}

/**
 * Takes a payment from an authenticated peer into the wallet (once; see
 * {@link createSeenStore}) and returns the ack status. When the wallet is locked or its
 * storage or network is unavailable, the payment is kept for
 * {@link retryReceivedDirectPayments} and the status is `received`.
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
  /** The payer's note (`onPayment`'s `ctx.note`); it becomes the payment's description in Activity. */
  note?: string
}): Promise<DirectReceipt> {
  let result: { txid: string; status: 'accepted' | 'duplicate' }
  try {
    result = await acceptDirectPayment(o.wallet, o.payment, { originator: o.originator, seen: createSeenStore(o.identity, o.chain), description: directDescription(o.note) })
  } catch (error) {
    if (error instanceof WebRTPayError) throw error
    if (!isTemporary(error)) throw new WebRTPayError('rejected', NOT_ACCEPTED, { cause: error })
    const kept = keepForRetry(retryStorageKey(o.identity, o.chain), o.payment, error, o.note)
    return { status: 'received', repeat: !kept, added: false }
  }
  // A payment kept for a retry earlier was announced when it was kept.
  const wasKept = forget(retryStorageKey(o.identity, o.chain), keyOf(o.payment, result.txid))
  return { status: 'accepted', repeat: result.status === 'duplicate' || wasKept, added: result.status === 'accepted' }
}

/**
 * Keeps a payment for {@link retryReceivedDirectPayments} without offering it to the wallet,
 * which cannot take work right now (a network or profile switch holds it off). By then the
 * payer has broadcast it, so it is kept rather than refused (final review M10). It is checked
 * against this wallet's key first (key derivation, no storage): a payment that does not pay
 * this wallet is refused, and its payer still has it. Returns the ack as
 * {@link receiveDirectPayment} does.
 */
export async function keepDirectPayment(o: {
  wallet: WalletInterface
  originator: string
  identity: string
  chain: string
  payment: IncomingPayment
  /** The payer's note, kept with the payment for its description (see {@link receiveDirectPayment}). */
  note?: string
}): Promise<DirectReceipt> {
  try {
    const { txid } = await verifyDirectPayment(o.wallet, o.payment, { originator: o.originator })
    if (await createSeenStore(o.identity, o.chain).has(keyOf(o.payment, txid))) return { status: 'accepted', repeat: true, added: false }
  } catch (error) {
    if (error instanceof WebRTPayError) throw error
    if (!isTemporary(error)) throw new WebRTPayError('rejected', NOT_ACCEPTED, { cause: error })
  }
  const kept = keepForRetry(retryStorageKey(o.identity, o.chain), o.payment, new Error(WALLET_CHANGING), o.note)
  return { status: 'received', repeat: !kept, added: false }
}

/**
 * Thrown by a retry pass's `run` to end the pass early (the wallet is busy, or too slow); the
 * payment it was about to offer, and every one after it, stays as it is for the next pass.
 */
export class RetryStopped extends Error {
  constructor(message = 'The retry pass stopped early') {
    super(message)
    this.name = 'RetryStopped'
  }
}

/** A kept payment as stored on this device: everything needed to take it into a wallet. */
export interface KeptDirectPayment {
  messageId: string
  /** The payer's identity key. */
  sender: string
  token: {
    customInstructions: { derivationPrefix: string; derivationSuffix: string }
    /** Atomic BEEF, base64. */
    transaction: string
    amount: number
    outputIndex: number
  }
  /** The payer's note, when they sent one. */
  note?: string
}

/** Why the wallet could not add a kept payment after retrying, so the user should look at it. */
export interface NeedsAttention {
  since: number
  /**
   * `refused`: it does not pay this wallet, or the wallet refused one of its fixed arguments
   * (never the transaction or its proof). `unverifiable`: the wallet still could not take it
   * after {@link NEEDS_ATTENTION_ATTEMPTS} tries, more than a day after it arrived.
   */
  reason: 'refused' | 'unverifiable'
}

/** A payment kept on this device, acknowledged as received, that the wallet has not taken yet. */
export interface KeptDirectPaymentInfo {
  /** {@link paymentKey}: one entry per payment output. */
  key: string
  txid: string
  sender: string
  amount: number
  receivedAt: number
  /** Failed retries counted towards needing attention (temporary failures are not counted). */
  attempts: number
  /** The last failure (local text; never sent to the payer). */
  error: string
  /** Set once retrying stopped looking likely to work; the payment is still kept and retried. */
  needsAttention?: NeedsAttention
  payment: KeptDirectPayment
}

/**
 * Offers kept payments to the wallet again. A payment the wallet takes (or already has) leaves
 * the list; nothing else ever does. Each kept payment was acknowledged as received, so its
 * payer will not resend it, and its derivation is on this device only. A failed retry flags
 * it as needing attention when:
 * - the wallet refuses it outright (`invalid_payment`, or a check on an argument built from
 *   the kept payment, such as `outputs` or `paymentRemittance`; never `tx`), or
 * - the wallet still cannot verify it after {@link NEEDS_ATTENTION_ATTEMPTS} failed tries
 *   and more than {@link NEEDS_ATTENTION_AGE_MS} after it arrived. A failure known to be
 *   temporary (wallet locked, storage or network down) is not counted as a try.
 *
 * `onNeedsAttention` hears of each payment once, when it is first flagged. Payments that need
 * attention are offered again only with `includeNeedsAttention`, so a caller can try them less
 * often. Each payment's wallet calls go through `run`, which may take and release a wallet
 * operation around them, and may throw {@link RetryStopped} to end the pass there. Returns how
 * many payments were added to the wallet. Run it single-flight.
 */
export async function retryReceivedDirectPayments(o: {
  wallet: WalletInterface
  originator: string
  identity: string
  chain: string
  includeNeedsAttention?: boolean
  onNeedsAttention?: (kept: KeptDirectPaymentInfo) => void
  run?: <T>(call: () => Promise<T>) => Promise<T>
}): Promise<number> {
  const storageKey = retryStorageKey(o.identity, o.chain)
  const seen = createSeenStore(o.identity, o.chain)
  const run = o.run ?? (<T>(call: () => Promise<T>) => call())
  let accepted = 0
  for (const entry of readRetries(storageKey)?.entries ?? []) {
    if (entry.needsAttention && !o.includeNeedsAttention) continue
    try {
      const result = await run(() => acceptDirectPayment(o.wallet, toIncoming(entry), { originator: o.originator, seen, description: directDescription(entry.payment.note) }))
      if (result.status === 'accepted') accepted++
    } catch (error) {
      if (error instanceof RetryStopped) break
      const verdict = retryVerdict(error)
      if (verdict === 'temporary') continue
      const failed: RetryEntry = { ...entry, error: messageOf(error).slice(0, 500) }
      if (!entry.needsAttention) {
        if (verdict === 'unproven') failed.attempts = entry.attempts + 1
        if (verdict === 'refused' || (failed.attempts >= NEEDS_ATTENTION_ATTEMPTS && Date.now() - entry.receivedAt > NEEDS_ATTENTION_AGE_MS)) {
          failed.needsAttention = { since: Date.now(), reason: verdict === 'refused' ? 'refused' : 'unverifiable' }
        }
      }
      // Kept either way. If this write fails, the try is just not counted (or flagged) yet.
      if (update(storageKey, failed) && failed.needsAttention && !entry.needsAttention) {
        try { o.onNeedsAttention?.(infoOf(failed)) } catch { /* the flag is stored; the list shows it */ }
      }
      continue
    }
    forget(storageKey, entry.key)
  }
  return accepted
}

/** A wallet's kept-payment list as this device holds it. */
export interface KeptDirectPaymentsList {
  /** The kept payments this version can read, oldest first. */
  payments: KeptDirectPaymentInfo[]
  /**
   * The stored list cannot be read. It is left as it is, and until it can be read no payment
   * is kept (one the wallet cannot take at once is refused, so its payer keeps it).
   */
  unreadable: boolean
  /** Stored entries this version does not recognise; they are kept as they are. */
  unknown: number
}

/** The open wallet's kept payments. */
export function listKeptDirectPayments(identity: string, chain: string): KeptDirectPaymentsList {
  const stored = readRetries(retryStorageKey(identity, chain))
  if (!stored) return { payments: [], unreadable: true, unknown: 0 }
  return { payments: stored.entries.map(infoOf), unreadable: false, unknown: stored.unknown }
}

/**
 * How many of `entries` count towards the limit on kept payments: those still being retried. One
 * that needs attention waits for the user (who may dismiss it), so it does not hold off new
 * payments; the size budget still bounds the stored list.
 */
export function keptTowardLimit(entries: { needsAttention?: NeedsAttention }[]): number {
  return entries.filter(entry => !entry.needsAttention).length
}

/**
 * Removes a kept payment because the user dismissed it. Ruling 36 rules out deleting one by
 * giving up, not by the user's choice. Only a payment that needs attention can go (the others
 * are still being retried); the Payments page offers it only after its recovery details were
 * copied, with which it can still be added by hand. Returns false when it is no longer kept (the
 * wallet took it meanwhile). Throws, removing nothing, when the payment does not need attention
 * or the list cannot be read or written.
 */
export function dismissKeptDirectPayment(identity: string, chain: string, key: string): boolean {
  const storageKey = retryStorageKey(identity, chain)
  const stored = readRetries(storageKey)
  if (!stored) throw new Error('The direct payments kept on this device could not be read, so nothing was removed.')
  const entry = stored.entries.find(e => e.key === key)
  if (!entry) return false
  if (!entry.needsAttention) throw new Error('Only a payment that needs attention can be dismissed; this one is still being retried.')
  if (rewrite(storageKey, key, () => undefined) !== true) throw new Error('This payment could not be removed from this device. Try again.')
  return true
}

/** Kept payments counted together: how many, their total, and how many could not be read. */
export interface KeptCount {
  count: number
  total: number
  /** Kept lists (each counted once) and entries this version cannot read. */
  unreadable: number
}

/**
 * The kept payments this device holds, on every network: those of `identity` (the open wallet)
 * and those of every other wallet. Every one of them stays when a wallet is removed.
 */
export function keptDirectPaymentsOnDevice(identity: string): { open: KeptCount; others: KeptCount } {
  const open: KeptCount = { count: 0, total: 0, unreadable: 0 }
  const others: KeptCount = { count: 0, total: 0, unreadable: 0 }
  for (const key of storageKeys()) {
    if (!key.startsWith(KEPT_DIRECT_PAYMENTS_PREFIX)) continue
    const list = key.slice(KEPT_DIRECT_PAYMENTS_PREFIX.length) // `${identity}:${chain}`
    const counted = identity !== '' && list.slice(0, list.lastIndexOf(':')) === identity ? open : others
    const stored = readRetries(key)
    if (!stored) { counted.unreadable++; continue }
    counted.unreadable += stored.unknown
    for (const entry of stored.entries) {
      counted.count++
      if (validAmount(entry.payment.token.amount)) counted.total += entry.payment.token.amount
    }
  }
  return { open, others }
}

/** Calls `fn` after every change to a kept-payment list in this window; returns the unsubscribe. */
export function subscribeKeptDirectPayments(fn: () => void): () => void {
  const listener = () => fn()
  window.addEventListener(KEPT_CHANGED_EVENT, listener)
  return () => window.removeEventListener(KEPT_CHANGED_EVENT, listener)
}

/** Wording of argument and proof checks, which can arrive wrapped in a storage IPC error. */
const VALIDATION = /parameter must be|parameter is missing|merkle ?root/i
/** The wallet is locked, or its storage (over IPC) or network is unavailable. */
const TEMPORARY = /not authenticated|^Storage method \w+ failed:|^Settings not available|^Services not set|^Failed to make storage available|fetch failed|failed to fetch|network ?error|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i
/** A WERR_INVALID_PARAMETER / WERR_MISSING_PARAMETER message (only the message crosses IPC). */
const ARGUMENT = /\bThe (?:required )?([\w. ]{1,60}?) parameter (?:must be|is missing)/
/**
 * internalizeAction arguments other than `tx` that acceptDirectPayment builds from the kept
 * payment (wallet-toolbox validateInternalizeActionArgs, signer and storage internalize), so
 * a failed check on one fails the same way on every retry. Not here on purpose: `tx`, `txid`
 * (storage state and service lookups), `services`, `status` and other state-dependent names.
 */
const FIXED_ARGUMENT = /^(?:args|outputs|output|output remittance|protocol|outputIndex|paymentRemittance|derivationPrefix|derivationSuffix|senderIdentityKey|description|labels?|seekPermission|wallet payment|basket insertion|insertionRemittance(?:\.basket)?)$/

/**
 * Wallet Toolbox (2.14.7 and later) posts an unproven payment from internalizeAction and
 * throws WERR_REVIEW_ACTIONS, crediting nothing, when the post fails. When every result is a
 * service error, no broadcaster could be reached, which says nothing about the payment. A
 * double spend or an invalid transaction does.
 */
function isUnpostedPayment(error: unknown): boolean {
  const e = error as { name?: unknown; notDelayedResults?: unknown } | null
  if (e?.name !== 'WERR_REVIEW_ACTIONS' || !Array.isArray(e.notDelayedResults) || e.notDelayedResults.length === 0) return false
  return e.notDelayedResults.every(result => (result as { status?: unknown } | null)?.status === 'serviceError')
}

/**
 * Receive time: only failures known to be temporary are worth keeping a payment for (audit
 * finding F6). Rejecting anything else is safe there, because the payer still has it.
 */
function isTemporary(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name
  const message = messageOf(error)
  if (typeof name === 'string' && /^WERR_(INVALID|MISSING|BAD)_/.test(name)) return false
  if (VALIDATION.test(message)) return false
  return name === 'WERR_NOT_ACTIVE' || isUnpostedPayment(error) || TEMPORARY.test(message)
}

/**
 * Retry time: the payer no longer has the payment, so unknown means keep. `refused` is a
 * definite answer about the payment itself: it does not pay this wallet, or one of the
 * {@link FIXED_ARGUMENT}s is invalid. Any other argument error may come from state or a
 * service: a chain tracker that has not caught up answers `false`, which the wallet reports
 * as "The tx parameter must be valid AtomicBEEF", and storage reports a transaction it does
 * not know yet under `txid`. Those are `unproven`, like tracker request failures and
 * unknown errors.
 */
function retryVerdict(error: unknown): 'refused' | 'temporary' | 'unproven' {
  if (error instanceof WebRTPayError) return error.code === 'invalid_payment' ? 'refused' : 'unproven'
  const parameter = ARGUMENT.exec(messageOf(error))?.[1]
  if (parameter !== undefined && FIXED_ARGUMENT.test(parameter)) return 'refused'
  return isTemporary(error) ? 'temporary' : 'unproven'
}

/** A payment acknowledged as received that the wallet has not taken yet, as stored. */
interface RetryEntry {
  /** {@link paymentKey}: one entry per payment output. */
  key: string
  payment: KeptDirectPayment
  /** The latest reason the wallet could not take it (kept on this device only). */
  error: string
  receivedAt: number
  /** Failed retries counted towards needing attention; see {@link retryReceivedDirectPayments}. */
  attempts: number
  needsAttention?: NeedsAttention
}

function infoOf(entry: RetryEntry): KeptDirectPaymentInfo {
  const { key, payment, error, receivedAt, attempts, needsAttention } = entry
  return { key, txid: key.split(':')[0], sender: payment.sender, amount: payment.token.amount, receivedAt, attempts, error, ...(needsAttention && { needsAttention }), payment }
}

/**
 * Adds the payment to the retry list, once; returns false when it was already there.
 * Nothing already kept is ever dropped to make room: each entry was acknowledged as
 * received, so the payer will not resend it. A payment that cannot be kept is refused
 * instead; the payer still has it. So is every payment while the stored list cannot be read.
 */
function keepForRetry(storageKey: string, p: IncomingPayment, error: unknown, note?: string): boolean {
  try {
    const entry = toEntry(p, error, note)
    const stored = readRetries(storageKey)
    if (!stored) throw new Error('The kept payments on this device cannot be read.')
    if (stored.entries.some(e => e.key === entry.key)) return false
    if (keptTowardLimit(stored.entries) >= RETRY_LIMIT) throw new Error('Too many payments are waiting for the wallet.')
    const text = JSON.stringify([...stored.items, entry])
    if (text.length > RETRY_BUDGET) throw new Error('No room to keep this payment.')
    localStorage.setItem(storageKey, text)
    announceKept()
    return true
  } catch (cause) {
    throw new WebRTPayError('rejected', CANNOT_KEEP, { cause })
  }
}

/**
 * Removes a payment from the retry list and says whether it was there. If the write fails, or
 * the list cannot be read, the entry stays, and a later retry finds the payment seen.
 */
function forget(storageKey: string, key: string): boolean {
  return rewrite(storageKey, key, () => undefined) !== undefined
}

/**
 * Replaces a kept payment's entry, re-reading the list first so a payment kept meanwhile
 * (the retry awaits the wallet) is not lost. If the entry is gone, or the list cannot be read,
 * nothing is written. Returns whether the entry was written.
 */
function update(storageKey: string, entry: RetryEntry): boolean {
  return rewrite(storageKey, entry.key, () => entry) === true
}

/**
 * Replaces (`change` returns an entry) or removes (it returns undefined) the stored entry for
 * `key`, from the list as stored now. Every other stored item, recognised or not, is written
 * back exactly as it was read. Returns undefined when nothing was there to change (or the list
 * cannot be read: it is never written over), else whether the write succeeded.
 */
function rewrite(storageKey: string, key: string, change: (entry: RetryEntry) => RetryEntry | undefined): boolean | undefined {
  const stored = readRetries(storageKey)
  const index = stored?.items.findIndex(item => toRetryEntry(item)?.key === key) ?? -1
  if (!stored || index < 0) return undefined
  const replacement = change(toRetryEntry(stored.items[index])!)
  const items = stored.items.flatMap((item, i) => (i !== index ? [item] : replacement ? [replacement] : []))
  try {
    if (items.length) localStorage.setItem(storageKey, JSON.stringify(items))
    else localStorage.removeItem(storageKey)
  } catch {
    return false // the stored list stays as it was
  }
  announceKept()
  return true
}

/**
 * A kept list as stored: every item, in order (writes pass the ones this version does not
 * recognise through unchanged), and the recognised entries. Null when the list itself cannot
 * be read (not JSON, not a list, or storage unavailable): it is then never written over.
 */
function readRetries(storageKey: string): { items: unknown[]; entries: RetryEntry[]; unknown: number } | null {
  const items = readArray(storageKey)
  if (!items) return null
  const entries = items.map(toRetryEntry).filter((e): e is RetryEntry => e !== undefined)
  return { items, entries, unknown: items.length - entries.length }
}

/**
 * A stored item as a kept payment, or undefined when it is not one this version can retry or
 * show (every field it needs, of the right type). Entries from before tries were counted lack
 * `attempts`; it reads as 0.
 */
function toRetryEntry(e: any): RetryEntry | undefined {
  const payment = e?.payment
  const token = payment?.token
  const derivation = token?.customInstructions
  const recognised = typeof e?.key === 'string' && typeof payment?.messageId === 'string' && typeof payment.sender === 'string' &&
    typeof token?.transaction === 'string' && Number.isSafeInteger(token.amount) && Number.isSafeInteger(token.outputIndex) && token.outputIndex >= 0 &&
    typeof derivation?.derivationPrefix === 'string' && typeof derivation.derivationSuffix === 'string'
  if (!recognised) return undefined
  const { needsAttention, ...rest } = e
  return {
    ...rest,
    error: typeof e.error === 'string' ? e.error : '',
    attempts: Number.isSafeInteger(e.attempts) && e.attempts > 0 ? e.attempts : 0,
    receivedAt: Number.isFinite(e.receivedAt) ? e.receivedAt : Date.now(),
    ...(isNeedsAttention(needsAttention) && { needsAttention })
  }
}

function isNeedsAttention(x: any): x is NeedsAttention {
  return Number.isFinite(x?.since) && (x.reason === 'refused' || x.reason === 'unverifiable')
}

/** Tells this window's views (the Payments page) that a kept-payment list changed; never throws. */
function announceKept(): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(KEPT_CHANGED_EVENT))
  } catch { /* the list is stored; a view reads it when it next opens */ }
}

function storageKeys(): string[] {
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key !== null) keys.push(key)
    }
  } catch { /* storage unavailable: nothing is kept */ }
  return keys
}

/** The list stored under `storageKey` (none stored reads as empty), or null when it cannot be read. */
function readArray(storageKey: string): unknown[] | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** Same output index rule as the package: the token's, else the payment's, else 0. */
const outputIndexOf = (p: IncomingPayment) => p.token.outputIndex ?? p.outputIndex ?? 0

const keyOf = (p: IncomingPayment, txid: string) =>
  paymentKey(txid, outputIndexOf(p), p.token.customInstructions.derivationPrefix, p.token.customInstructions.derivationSuffix)

function toEntry(p: IncomingPayment, error: unknown, note?: string): RetryEntry {
  const { transaction, amount, customInstructions: { derivationPrefix, derivationSuffix } } = p.token
  const outputIndex = outputIndexOf(p)
  return {
    key: keyOf(p, Transaction.fromAtomicBEEF(transaction).id('hex')),
    payment: { messageId: p.messageId, sender: p.sender, token: { customInstructions: { derivationPrefix, derivationSuffix }, transaction: Utils.toBase64(transaction), amount, outputIndex }, ...(note ? { note } : {}) },
    error: messageOf(error).slice(0, 500),
    receivedAt: Date.now(),
    attempts: 0
  }
}

function toIncoming(entry: RetryEntry): IncomingPayment {
  const { messageId, sender, token } = entry.payment
  return { messageId, sender, token: { ...token, transaction: Utils.toArray(token.transaction, 'base64') } }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
