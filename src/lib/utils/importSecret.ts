import { BigNumber, Curve, Mnemonic, PrivateKey, Utils } from '@bsv/sdk'
import { deriveKeyMaterialFromMnemonic } from './keyMaterial'
import { normalizeRecoveryPhrase } from './mnemonicRecovery'

/**
 * What an "import an existing wallet" entry restores.
 *
 * - `phrase`: a BSV Wallet recovery phrase (m/0'/n' primary, m/1'/n' privileged, with profiles).
 * - `key`: a single private key opened as a `direct-key` wallet, the way BSV Desktop 2 did.
 *   It comes from 64 hex characters, from older backup shares that split a raw private key
 *   (see `classifyPayload`), or from a phrase made by BSV Desktop 2, whose key was
 *   the phrase's 32 bytes of entropy (24 words) or, for other lengths, the first 32 bytes of
 *   its BIP39 seed (`deriveKeyMaterialFromMnemonic`).
 */
export type ImportSecret =
  | { kind: 'phrase'; mnemonic: string }
  | { kind: 'key'; source: 'hex' | 'desktop-v2-phrase' | 'legacy-shares'; keyHex: string; keyBytes: number[]; identityKey: string; mnemonic?: string }

const HEX_KEY = /^[0-9a-fA-F]{64}$/
const CURVE_ORDER = new Curve().n

export const looksLikeHexKey = (text: string): boolean => HEX_KEY.test(text.trim())

export const countWords = (text: string): number => text.trim() ? text.trim().split(/\s+/).length : 0

/**
 * BSV Desktop 2 only ever made 24-word phrases; BSV Wallet makes 12. So 24 words open the
 * Desktop 2 key unless the person says otherwise.
 */
export const isDesktopV2ByDefault = (text: string): boolean => countWords(text) === 24

function keyFromBytes(keyBytes: number[]): { keyHex: string; identityKey: string } {
  const k = new BigNumber(keyBytes)
  if (keyBytes.length !== 32 || k.isZero() || k.cmp(CURVE_ORDER) >= 0) throw new Error('This is not a valid private key.')
  const key = new PrivateKey(keyBytes)
  return { keyHex: key.toHex().padStart(64, '0'), identityKey: key.toPublicKey().toString() }
}

/** A raw 32-byte key, such as the payload of older private-key backup shares. */
export function keySecretFromBytes(keyBytes: number[], source: 'hex' | 'legacy-shares'): Extract<ImportSecret, { kind: 'key' }> {
  return { kind: 'key', source, keyBytes, ...keyFromBytes(keyBytes) }
}

/** `desktopV2` null follows `isDesktopV2ByDefault`. Throws a message fit to show. */
export function classifyImportInput(text: string, desktopV2: boolean | null = null): ImportSecret {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Enter your recovery phrase or private key.')
  if (HEX_KEY.test(trimmed)) {
    return keySecretFromBytes(Utils.toArray(trimmed.toLowerCase(), 'hex'), 'hex')
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length > 24) {
    throw new Error(`A private key is 64 hex characters; this one has ${trimmed.length}.`)
  }
  const mnemonic = normalizeRecoveryPhrase(trimmed)
  try { Mnemonic.fromString(mnemonic) } catch {
    throw new Error('This is not a valid recovery phrase. Check each word and their order.')
  }
  if (!(desktopV2 ?? isDesktopV2ByDefault(mnemonic))) return { kind: 'phrase', mnemonic }
  const { keyBytes } = deriveKeyMaterialFromMnemonic(mnemonic)
  return { kind: 'key', source: 'desktop-v2-phrase', keyBytes, mnemonic, ...keyFromBytes(keyBytes) }
}
