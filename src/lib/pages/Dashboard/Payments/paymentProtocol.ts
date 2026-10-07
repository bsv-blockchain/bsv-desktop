import { PublicKey, Utils } from '@bsv/sdk'

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

export type PaymentTarget = { kind: 'identity'; recipient: string; amount?: number; host?: string } | { kind: 'address'; recipient: string; amount?: number }

function satsFromBsv(text: string): number {
  if (!/^\d+(?:\.\d{1,8})?$/.test(text)) throw new Error('The payment amount must have at most 8 decimal places.')
  const [whole, fraction = ''] = text.split('.')
  const sats = Number(whole) * 100_000_000 + Number(fraction.padEnd(8, '0'))
  if (!validAmount(sats)) throw new Error('The payment amount must be a positive number of satoshis.')
  return sats
}

export function parsePaymentTarget(input: string, chain: string): PaymentTarget {
  const text = input.trim()
  if (!text) throw new Error('Enter a recipient to continue.')
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

export function peerPayLink(key: string, host: string, amount?: number): string {
  const params = new URLSearchParams()
  if (amount !== undefined) { if (!validAmount(amount)) throw new Error('Enter a positive amount.'); params.set('sats', String(amount)) }
  params.set('url', validateHost(host))
  return `peerpay:${identityKey(key)}?${params}`
}
