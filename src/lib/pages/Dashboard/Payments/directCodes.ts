/**
 * Face-to-face direct payments (Nearby → Direct (WebRTC)): two wallets connect by exchanging
 * two codes, with no server in between (spec §3.1).
 *
 * The payee shows an offer code: their identity key, their network and an optional amount.
 * The payer reads it, confirms, and shows an answer code. The payee scans the answer within
 * about 15 seconds; the wallets connect and prove who they are. Only then does the payer
 * prepare, save, broadcast and send the payment (deliverDirect), so a payee who never scans
 * the answer costs the payer nothing. The payee offers because its code can wait for minutes,
 * while the answer cannot.
 */
import type { WalletInterface } from '@bsv/sdk'
import { decodeCode, WebRTPayError } from '@bsv/webrtpay'
import type { DirectPayClient, OfferCode, OfferHandle, PaymentAck, ReceiveHandlers } from '@bsv/webrtpay'
import { beginUserWalletOperation } from '../../../services/httpBridgeSession'
import { deliverDirect, NotSentError, receiveDirectPayment } from './directPayments'
import type { DirectReceipt } from './directPayments'
import type { OutgoingPayment } from './messageBoxPayments'
import { networkLabel, validAmount } from './paymentProtocol'

/**
 * The longest code a level M QR code holds (version 40, byte mode). qrcode.react throws while
 * rendering anything longer, so such a code (an SDP the compact form cannot carry) is offered
 * for copying only.
 */
export const QR_MAX_CHARS = 2331
export const codeFitsQr = (code: string) => code.length <= QR_MAX_CHARS

const UNREADABLE = 'This code could not be read. Scan it again, or copy the whole code.'

/**
 * Reads the recipient's offer code on a wallet that is on `chain` and has the identity key
 * `identity`. Throws an `Error` for the user when the code cannot be paid from this wallet:
 * not an offer code, expired, for another network (or none), or the wallet's own.
 */
export function readOfferCode(text: string, o: { chain: string; identity: string }): OfferCode {
  let code: ReturnType<typeof decodeCode>
  try {
    code = decodeCode(text, { expectedChain: o.chain })
  } catch {
    throw new Error(whyUnpayable(text, o.chain))
  }
  if (code.kind !== 'offer') throw new Error('This is an answer code. Scan the code the recipient shows you first.')
  if (code.identityKey === o.identity) throw new Error('This is your own request. Scan the code the recipient shows you.')
  return code
}

/** Why an offer code was refused: decoded again without the network and expiry checks. */
function whyUnpayable(text: string, chain: string): string {
  if (text.trim().startsWith('bsvpay1:')) return 'This is an animated QR request. Switch Nearby to Animated QR to pay it.'
  let code: ReturnType<typeof decodeCode>
  try {
    code = decodeCode(text, { now: 0 })
  } catch {
    return UNREADABLE
  }
  if (code.kind !== 'offer') return UNREADABLE
  if (code.expiresAt !== undefined && Date.now() >= code.expiresAt) return 'This request has expired. Ask them for a new one.'
  if (code.chain === undefined) return 'This request does not say which network it is for, so it cannot be paid safely.'
  return `This request is for ${networkLabel(code.chain)}, but your wallet is on ${networkLabel(chain)}. Switch networks in Settings first.`
}

/**
 * The saved payment to deliver when the payer answers `recipient`'s code, instead of making a
 * new one (spec §3.1 recovery): the oldest not yet delivered, of the requested `amount` when
 * the code names one. Payments for message box payment requests are left to the message
 * box, which also answers the request.
 */
export function pendingPaymentFor(rows: OutgoingPayment[], recipient: string, amount?: number): OutgoingPayment | undefined {
  return rows.find(row => !row.delivered && !row.request && row.recipient === recipient && (amount === undefined || row.amount === amount))
}

/**
 * The Payments page's saved payments: the payer's side saves and delivers through it. `add`
 * and `markDelivered` write through outbox.ts, from the rows stored at that moment, so a
 * delivery that ends after other payments were saved keeps them.
 */
export interface DirectOutbox {
  rows: OutgoingPayment[]
  /** Saves a newly prepared payment (before it is broadcast). */
  add: (row: OutgoingPayment) => void
  markDelivered: (txid: string) => void
}

/** A payment taken in over a code-exchange session. */
export interface ReceivedDirectPayment {
  amount: number
  /** The amount the offer asked for, when the payment is for another amount. */
  requested?: number
  /** The payer's identity key, as proven in the connection's handshake. */
  sender: string
  /** `received`: kept on this device until the wallet can take it (see receiveDirectPayment). */
  status: 'accepted' | 'received'
  /** Delivered again (the payer lost the ack): announced when it first arrived. */
  repeat: boolean
  /** The wallet took it just now, so its balance changed. */
  added: boolean
}

/**
 * Creates the payee's offer code for `amount` (any amount when absent). Payments on its
 * session go into the wallet through receiveDirectPayment, then `onReceived` is called, also
 * for a repeat (the screen still has to finish its session).
 * A payment for another amount than requested is taken too, and reported with the
 * requested amount (Ruling 29): it pays this wallet, and its payer has already broadcast
 * it, so refusing it would only strand the funds. `onError` hears of failed sessions and
 * refused payments.
 */
export function createDirectRequest(o: {
  client: DirectPayClient
  wallet: WalletInterface
  originator: string
  identity: string
  chain: string
  amount?: number
  onReceived: (r: ReceivedDirectPayment) => void
  onError?: (e: unknown) => void
}): Promise<OfferHandle> {
  const { client, wallet, originator, identity, chain, amount } = o
  const handlers: ReceiveHandlers = {
    onPayment: async p => {
      // Throws while the network is changing: the payer keeps the payment and can retry.
      const release = beginUserWalletOperation()
      let receipt: DirectReceipt
      try {
        receipt = await receiveDirectPayment({ wallet, originator, identity, chain, payment: p })
      } finally {
        release()
      }
      // The payment is taken: nothing below may turn the ack into a rejection.
      try {
        const requested = amount !== undefined && amount !== p.token.amount ? { requested: amount } : {}
        o.onReceived({ amount: p.token.amount, ...requested, sender: p.sender, ...receipt })
      } catch (e) {
        console.warn('[directCodes] Could not announce a received direct payment:', e)
      }
      return receipt.status
    },
    onError: o.onError
  }
  return client.createOfferCode({ chain, amount, handlers })
}

/** The payer's answer to an offer code, and the delivery that follows once the payee connects. */
export interface DirectAnswer {
  /** The recipient's offer, as read from their code. */
  offer: OfferCode
  /** For the recipient to scan, within about 15 seconds. */
  answerCode: string
  /**
   * Settles when the payment is delivered or has failed, with an `Error` for the user. A
   * recipient who never connects costs nothing; after the payment was saved, the error says
   * to retry its delivery. A failure before anything was broadcast is a `NotSentError` that
   * says so; when the wallet could not make the payment, its own words are the `detail`.
   */
  delivered: Promise<{ payment: OutgoingPayment; ack: PaymentAck }>
  /**
   * Stops waiting for the recipient. Once they have connected and delivery has begun it does
   * nothing and returns false: a payment that may already be broadcast is never cut off.
   */
  cancel: () => boolean
}

/**
 * Answers the recipient's offer code. Pays exactly the code's amount when it names one
 * (else the payer's `amount`), or delivers `existing`, a saved payment to the same recipient
 * (and of the requested amount), with its own transaction. Everything is checked before the
 * answer is made. Once the recipient scans the answer and proves the identity in their code,
 * `onConnected` is called and the payment is made and delivered with deliverDirect
 * (`persist` saves it first).
 */
export async function answerDirectRequest(o: {
  client: DirectPayClient
  wallet: WalletInterface
  originator: string
  /** This wallet's identity key. */
  identity: string
  chain: string
  code: string
  amount?: number
  existing?: OutgoingPayment
  persist: (p: OutgoingPayment) => void
  markDelivered: (txid: string) => void
  onConnected?: () => void
}): Promise<DirectAnswer> {
  const offer = readOfferCode(o.code, { chain: o.chain, identity: o.identity })
  const recipient = offer.identityKey
  if (o.existing && o.existing.recipient !== recipient) throw new Error('This saved payment is for another recipient.')
  if (o.existing && offer.amount !== undefined && o.existing.amount !== offer.amount) throw new Error('This saved payment is for another amount than the request.')
  const amount = o.existing ? o.existing.amount : offer.amount ?? o.amount
  if (!validAmount(amount)) throw new Error('Enter a positive amount.')
  const saved = o.existing !== undefined

  const handle = await o.client.answerOfferCode(o.code, { expectedChain: o.chain })
  let started = false
  let cancelled = false
  const delivered = handle.connected.then(
    async peer => {
      if (cancelled) {
        peer.close()
        throw new Error(notConnected(undefined, saved))
      }
      started = true
      try {
        o.onConnected?.()
      } catch (e) {
        console.warn('[directCodes] onConnected failed:', e)
      }
      let release: () => void
      try {
        release = beginUserWalletOperation()
      } catch (e) {
        peer.close()
        throw saved ? e : notMade(e)
      }
      let persisted = false
      try {
        return await deliverDirect({ client: o.client, wallet: o.wallet, originator: o.originator, recipient, amount, existing: o.existing, persist: p => { o.persist(p); persisted = true }, markDelivered: o.markDelivered, peer })
      } catch (e) {
        // A new payment is saved before it is broadcast, so one never saved was never broadcast.
        throw saved || persisted ? e : notMade(e)
      } finally {
        release()
      }
    },
    error => {
      throw new Error(notConnected(error, saved))
    }
  )
  return {
    offer,
    answerCode: handle.answerCode,
    delivered,
    cancel: () => {
      if (started) return false
      cancelled = true
      handle.cancel()
      return true
    }
  }
}

/**
 * A new payment that failed after the payee connected but before anything was saved or
 * broadcast. deliverDirect's own refusals say so already; any other failure is the wallet's
 * (insufficient funds, say), and its words go under a message that says nothing was spent.
 */
function notMade(error: unknown): NotSentError {
  if (error instanceof NotSentError) return error
  return new NotSentError('Your wallet could not make the payment, so nothing was spent. Ask them for a new code and try again.', error instanceof Error ? error.message : String(error))
}

function notConnected(error: unknown, saved: boolean): string {
  const why = error instanceof WebRTPayError && error.code === 'auth_failed'
    ? 'The wallet that answered could not prove it is the one in the request.'
    : 'Their wallet did not connect. They need to scan your answer within about 15 seconds.'
  return saved
    ? `${why} Your saved payment is unchanged. Ask them for a new code and try again.`
    : `${why} Nothing was spent. Ask them for a new code and try again.`
}
