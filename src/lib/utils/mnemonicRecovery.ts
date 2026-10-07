import { Hash, HD, Mnemonic, PrivateKey, Utils } from '@bsv/sdk'

/** BSV Wallet profile zero. Never substitute the mnemonic entropy for this key. */
export const MNEMONIC_PRIMARY_PATH = "m/0'/0'"
export const MNEMONIC_PRIVILEGED_PATH = "m/1'/0'"
export const ENTROPY_BYTES = 16
export const PAYLOAD_BYTES = 32

export function normalizeRecoveryPhrase(phrase: string): string {
  return phrase.normalize('NFKD').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function deriveMnemonicWallet(phrase: string) {
  const mnemonic = normalizeRecoveryPhrase(phrase)
  const parsed = Mnemonic.fromString(mnemonic)
  const root = HD.fromSeed(parsed.toSeed())
  const primary = root.derive(MNEMONIC_PRIMARY_PATH).privKey
  return {
    mnemonic,
    keyHex: primary.toHex().padStart(64, '0'),
    keyBytes: primary.toArray('be', 32),
    privilegedKey: root.derive(MNEMONIC_PRIVILEGED_PATH).privKey,
    identityKey: primary.toPublicKey().toString(),
    entropy: parsed.toEntropy(),
  }
}

export function generateRecoveryPhrase(): string {
  return Mnemonic.fromRandom(128).toString()
}

/** Verifying a backup is read-only. A mismatch must never change saved identity keys. */
export function verifyMnemonicWallet(phrase: string, keyHex: string, identityKey?: string) {
  const material = deriveMnemonicWallet(phrase)
  if (material.keyHex !== keyHex.trim().toLowerCase() || (identityKey && material.identityKey !== identityKey)) {
    throw new Error('The recovery phrase does not match this wallet. Your saved keys have been preserved.')
  }
  return material
}

/** BRC-157 payload used by BSV Wallet: entropy || the first 16 SHA-256 bytes. */
export function frameEntropy(entropy: number[]): number[] {
  if (entropy.length !== ENTROPY_BYTES) {
    throw new Error('Backup shares support twelve-word recovery phrases (16 bytes of entropy).')
  }
  return [...entropy, ...Hash.sha256(entropy).slice(0, ENTROPY_BYTES)]
}

export function padPayload(bytes: number[]): number[] {
  if (bytes.length > PAYLOAD_BYTES) throw new Error('Backup payload exceeds 32 bytes.')
  return [...new Array(PAYLOAD_BYTES - bytes.length).fill(0), ...bytes]
}

export type RecoveredSecret = { kind: 'entropy'; entropy: number[]; mnemonic: string }
  | { kind: 'legacy'; primaryKey: number[]; keyHex: string }

export function classifyPayload(raw: number[]): RecoveredSecret {
  const payload = padPayload(raw)
  const entropy = payload.slice(0, ENTROPY_BYTES)
  const tag = Hash.sha256(entropy).slice(0, ENTROPY_BYTES)
  if (payload.slice(ENTROPY_BYTES).every((byte, i) => byte === tag[i])) {
    return { kind: 'entropy', entropy, mnemonic: Mnemonic.fromEntropy(entropy).toString() }
  }
  return { kind: 'legacy', primaryKey: payload, keyHex: Utils.toHex(payload) }
}

export function generateEntropyShares(phrase: string): string[] {
  const entropy = Mnemonic.fromString(normalizeRecoveryPhrase(phrase)).toEntropy()
  return new PrivateKey(frameEntropy(entropy)).toBackupShares(2, 3)
}

export interface ParsedShare {
  raw: string
  x: string
  y: string
  threshold: number
  integrity: string
}

export function parseShare(raw: string): ParsedShare {
  if (raw.length > 512) throw new Error('This backup share is too long. Paste only the share code.')
  const parts = raw.trim().split('.')
  const [x, y, thresholdText, integrity] = parts
  const threshold = Number(thresholdText)
  const base58 = /^[1-9A-HJ-NP-Za-km-z]+$/
  if (parts.length !== 4 || !base58.test(x ?? '') || !base58.test(y ?? '')
    || !Number.isInteger(threshold) || threshold < 2 || !/^[0-9a-f]+$/i.test(integrity ?? '')) {
    throw new Error('This is not a valid backup share. Paste the complete share, including its dots.')
  }
  return { raw: raw.trim(), x, y, threshold, integrity }
}

export function recoverSecretFromShares(shareStrings: string[]): RecoveredSecret {
  const shares = shareStrings.filter(s => s.trim()).map(parseShare)
  if (!shares.length) throw new Error('Enter at least two backup shares.')
  const first = shares[0]
  const seen = new Set<string>()
  for (const share of shares) {
    if (share.integrity !== first.integrity || share.threshold !== first.threshold) {
      throw new Error('These shares belong to different backups. Use shares from the same set.')
    }
    if (seen.has(share.x)) throw new Error('Each backup share must be different.')
    seen.add(share.x)
  }
  if (shares.length < first.threshold) throw new Error(`This backup needs ${first.threshold} different shares.`)
  return classifyPayload(PrivateKey.fromBackupShares(shares.map(s => s.raw)).toArray())
}
