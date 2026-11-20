/**
 * What the sigma consent dialog says for one request: a title, the body, the
 * rows, the footer and the approve button's label.
 *
 * A proof shows a short fingerprint of its context (`Context`) and of the
 * whole request (`Request`); a derived key request shows one of the whole
 * request; a public key request shows neither.
 *
 * Rows marked `fromApp` carry text the requesting application chose. It is
 * passed through `displayAppText` here, and the dialog shows it quoted in a
 * monospace face, so it cannot read as the wallet's own words.
 */

import type { SigmaPromptRequest } from './message'
import { SIGMA_KEY_GRANT_MS } from './module'

export type SigmaConsentRow = { label: string, value: string, fromApp: boolean }

export type SigmaConsentView = {
  kind: 'publicKey' | 'derivedKey' | 'proof'
  title: string
  body: string[]
  rows: SigmaConsentRow[]
  footer: string
  approveLabel: string
}

const DEFAULT_MAX = 120
const REPLACEMENT = '\u{FFFD}'
const ELLIPSIS = '…'
/**
 * Control characters (Cc: C0, DEL, C1), format characters (Cf: bidirectional
 * controls, zero-width characters), line and paragraph separators (Zl, Zp),
 * and the double quotation marks U+201C to U+201F (the wrapper's own and
 * their siblings).
 */
const REPLACED = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{201C}-\u{201F}]/gu
/** The first four marks of a run of five or more combining marks, and the rest. */
const LONG_MARK_RUN = /(\p{M}{4})\p{M}+/gu

/**
 * `value` with every control, format, line or paragraph separator and double
 * quotation mark U+201C to U+201F replaced by U+FFFD, every run of combining
 * marks cut to four, then cut to `max` code points with a trailing `…` when
 * longer. A cut never splits a surrogate pair.
 */
export function displayAppText (value: string, max: number = DEFAULT_MAX): string {
  const codePoints = Array.from(value.replace(REPLACED, REPLACEMENT).replace(LONG_MARK_RUN, '$1'))
  return codePoints.length > max ? codePoints.slice(0, max).join('') + ELLIPSIS : codePoints.join('')
}

const PROOF_NAMES: Record<Exclude<SigmaPromptRequest['operation'], 'key'>, string> = {
  schnorr: 'Knowledge of one key',
  dleq: 'The same key under two bases',
  or: 'One of a group of keys'
}

const COPY: Record<SigmaConsentView['kind'], Omit<SigmaConsentView, 'kind' | 'rows'>> = {
  publicKey: {
    title: 'Public key request',
    body: ['This app is asking for a public key from your wallet. It does not let the app spend anything.'],
    footer: `Your wallet will not ask again for public keys for this app and purpose for ${SIGMA_KEY_GRANT_MS / 60000} minutes.`,
    approveLabel: 'Approve'
  },
  derivedKey: {
    title: 'Derived key request',
    body: ['This app is asking for a value made from one of your keys and a point the app chose. It does not let the app spend anything.'],
    footer: 'Approving covers this one request.',
    approveLabel: 'Approve once'
  },
  proof: {
    title: 'Proof request',
    body: ['This app is asking your wallet to make a proof with one of your keys. A proof can release coins locked to that key. Your wallet cannot see what this proof will be used for.'],
    footer: 'Approving covers this one proof.',
    approveLabel: 'Approve once'
  }
}

const shortHash = (hex: string): string => hex.slice(0, 8) + ELLIPSIS

export function sigmaConsentView (request: SigmaPromptRequest): SigmaConsentView {
  const kind: SigmaConsentView['kind'] = request.operation !== 'key'
    ? 'proof'
    : request.applicationBase ? 'derivedKey' : 'publicKey'
  const copy = COPY[kind]

  const rows: SigmaConsentRow[] = [
    { label: 'Purpose', value: displayAppText(request.logicalProtocolID), fromApp: true },
    { label: 'Key', value: displayAppText(request.keyID), fromApp: true }
  ]
  if (request.securityLevel === 2 && request.counterparty !== 'self') {
    rows.push({ label: 'Counterparty', value: displayAppText(request.counterparty), fromApp: true })
  }
  if (request.operation !== 'key') {
    rows.push({ label: 'Proof', value: PROOF_NAMES[request.operation], fromApp: false })
    rows.push({ label: 'Context', value: shortHash(request.contextSha256 ?? ''), fromApp: false })
    rows.push({ label: 'Request', value: shortHash(request.inputSha256), fromApp: false })
  } else if (kind === 'derivedKey') {
    rows.push({ label: 'Request', value: shortHash(request.inputSha256), fromApp: false })
  }

  return { kind, title: copy.title, body: [...copy.body], rows, footer: copy.footer, approveLabel: copy.approveLabel }
}
