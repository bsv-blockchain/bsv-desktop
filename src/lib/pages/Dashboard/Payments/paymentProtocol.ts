import { PublicKey, Utils } from '@bsv/sdk'
import { CODE_PREFIX, decodeCode } from '@bsv/webrtpay'

export const MAX_PAYMENT_SATS = 2_100_000_000_000_000
export const validAmount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_PAYMENT_SATS

export function identityKey(value: string): string {
  const key = value.trim().toLowerCase()
  if (!/^(02|03)[0-9a-f]{64}$/.test(key)) throw new Error('Enter a valid wallet identity key or BSV address.')
  try { if (PublicKey.fromString(key).toString() !== key) throw new Error() } catch { throw new Error('This identity key is invalid.') }
  return key
}

export function validateHost(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('The message box URL must use HTTPS.')
  if (url.username || url.password || url.hash || url.search) throw new Error('The message box URL cannot contain credentials, a query, or a fragment.')
  return url.toString().replace(/\/+$/, '')
}

const NETWORK_LABELS = new Map([['main', 'Mainnet'], ['test', 'Testnet'], ['ttn', 'TeraTestnet'], ['tstn', 'TeraScaling Testnet']])
/** A network this wallet can be on. Codes from other wallets may name any network. */
export const isKnownNetwork = (chain: string) => NETWORK_LABELS.has(chain)
/** The network's name on the Payments page: its chip and every confirmation use this. Any other network keeps its own id. */
export const networkLabel = (chain: string) => NETWORK_LABELS.get(chain) ?? chain

export type PaymentTarget = { kind: 'identity'; recipient: string; amount?: number; host?: string } | { kind: 'address'; recipient: string; amount?: number }

function satsFromBsv(text: string): number {
  if (!/^\d+(?:\.\d{1,8})?$/.test(text)) throw new Error('The payment amount must have at most 8 decimal places.')
  const [whole, fraction = ''] = text.split('.')
  const sats = Number(whole) * 100_000_000 + Number(fraction.padEnd(8, '0'))
  if (!validAmount(sats)) throw new Error('The payment amount must be a positive number of satoshis.')
  return sats
}

const networkMismatch = (theirs: string, chain: string) => isKnownNetwork(theirs)
  ? `This request is for ${networkLabel(theirs)}, but your wallet is on ${networkLabel(chain)}. Switch networks in Settings first.`
  : `This request is for a network this wallet does not support (${theirs}).`

/**
 * A WebRTPay offer code (`webrtpay1:`), as another wallet shows it to be paid face to face:
 * it names the payee's identity key, network and optional amount, which is all this wallet
 * needs. The payee is paid live by identity key (see payFlow.ts) rather than over the code's
 * own connection, so the offer's expiry does not matter. An answer code names no payee.
 */
function offerCodeTarget(text: string, chain: string): PaymentTarget {
  let code: ReturnType<typeof decodeCode>
  try { code = decodeCode(text, { now: 0 }) } catch { throw new Error('This payment code could not be read. Scan it again.') }
  if (code.kind !== 'offer') throw new Error('This is an answer code. Scan the code the recipient shows you.')
  if (code.chain === undefined) throw new Error('This request does not say which network it is for, so it cannot be paid safely.')
  if (code.chain !== chain) throw new Error(networkMismatch(code.chain, chain))
  if (code.amount !== undefined && !validAmount(code.amount)) throw new Error('This payment code has an invalid amount.')
  return { kind: 'identity', recipient: identityKey(code.identityKey), ...(code.amount === undefined ? {} : { amount: code.amount }) }
}

/**
 * BSV Wallet's face-to-face request (`bsvpay1:`, base64url JSON): `i` the payee's identity key,
 * `a` the optional amount, `n` the optional network, `t` a token request. Like an offer code it
 * is paid live by identity key; its pairing keys are not used.
 */
function nearbyRequestTarget(text: string, chain: string): PaymentTarget {
  let value: any
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(Utils.toArray(text.slice(8).replace(/-/g, '+').replace(/_/g, '/'), 'base64')))) } catch { throw new Error('This payment code could not be read. Scan it again.') }
  if (!value || typeof value !== 'object' || value.v !== 1) throw new Error('This payment code uses a version this wallet does not support.')
  if (value.t !== undefined) throw new Error('This is a token request. Payments supports BSV.')
  if (value.n !== undefined && value.n !== chain) throw new Error(networkMismatch(String(value.n), chain))
  if (value.a !== undefined && !validAmount(value.a)) throw new Error('This payment code has an invalid amount.')
  return { kind: 'identity', recipient: identityKey(String(value.i ?? '')), ...(value.a === undefined ? {} : { amount: value.a }) }
}

export function parsePaymentTarget(input: string, chain: string): PaymentTarget {
  const text = input.trim()
  if (!text) throw new Error('Enter a recipient to continue.')
  if (text.startsWith(CODE_PREFIX)) return offerCodeTarget(text, chain)
  if (text.startsWith('bsvpay1:')) return nearbyRequestTarget(text, chain)
  if (/^peerpay:/i.test(text)) {
    const [key, query = ''] = text.slice(8).split('?')
    const params = new URLSearchParams(query)
    if (params.has('asset') || params.has('amount')) throw new Error('This is a token request. Payments supports BSV.')
    const amountText = params.get('sats')
    if (params.getAll('sats').length > 1 || params.getAll('url').length > 1) throw new Error('This payment link contains duplicate fields.')
    const amount = amountText === null ? undefined : /^\d+$/.test(amountText) ? Number(amountText) : NaN
    if (amount !== undefined && !validAmount(amount)) throw new Error('This payment link has an invalid amount.')
    return { kind: 'identity', recipient: identityKey(key), ...(amount === undefined ? {} : { amount }), ...(params.has('url') ? { host: validateHost(params.get('url')!) } : {}) }
  }
  if (/^(02|03)[0-9a-f]{64}$/i.test(text)) return { kind: 'identity', recipient: identityKey(text) }
  let address = text
  let amount: number | undefined
  if (/^(bitcoin|bsv):/i.test(text)) {
    const [path, query = ''] = text.slice(text.indexOf(':') + 1).replace(/^\/\//, '').split('?')
    address = path
    const params = new URLSearchParams(query)
    if ([...params.keys()].some(key => key.startsWith('req-'))) throw new Error('This payment link requires an unsupported feature.')
    if (params.getAll('amount').length > 1) throw new Error('This payment link contains duplicate amounts.')
    if (params.has('amount')) amount = satsFromBsv(params.get('amount')!)
  }
  try {
    const decoded = Utils.fromBase58Check(address)
    if (!Array.isArray(decoded.data) || decoded.data.length !== 20 || !Array.isArray(decoded.prefix) || decoded.prefix.length !== 1 || ![0, 111].includes(decoded.prefix[0])) throw new Error()
    const expected = chain === 'main' ? 0 : 111
    if (decoded.prefix[0] !== expected) throw new Error('network')
  } catch (error) {
    if ((error as Error).message === 'network') throw new Error(`This address is for ${chain === 'main' ? 'a test network' : 'mainnet'}. Switch networks in Settings first.`)
    throw new Error('Enter a valid wallet identity key, peerpay link, or BSV address.')
  }
  return { kind: 'address', recipient: address, ...(amount === undefined ? {} : { amount }) }
}

/**
 * The payment link a Receive QR shows, as BSV Wallet makes it: the identity key, the optional
 * amount, and the message box host when there is one. Without a host the sender pays live, or
 * through their own default message box.
 */
export function peerPayLink(key: string, host?: string, amount?: number): string {
  const params = new URLSearchParams()
  if (amount !== undefined) { if (!validAmount(amount)) throw new Error('Enter a positive amount.'); params.set('sats', String(amount)) }
  if (host) params.set('url', validateHost(host))
  const query = params.toString()
  return `peerpay:${identityKey(key)}${query ? `?${query}` : ''}`
}
