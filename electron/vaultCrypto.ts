/**
 * Pure crypto helpers for the vault: AES-256-GCM seal/open and scrypt-based
 * passphrase wrapping of the DEK. No Electron dependency — fully unit-testable.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

export const AAD = Buffer.from('bsv-desktop-vault-v2', 'utf8')
export const DEK_LEN = 32
export const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32, maxmem: 64 * 1024 * 1024 }

export function randomDek(): Buffer {
  return randomBytes(DEK_LEN)
}

export function b64(buf: Buffer): string {
  return buf.toString('base64')
}

export function fromB64(s: string): Buffer {
  return Buffer.from(s, 'base64')
}

/** AES-256-GCM encrypt; returns { nonce, ciphertext } as base64 (ciphertext includes auth tag). */
export function aesGcmEncrypt(key: Buffer, plaintext: Buffer, aad: Buffer = AAD): { nonce: string; ciphertext: string } {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad)
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return { nonce: b64(nonce), ciphertext: b64(Buffer.concat([enc, tag])) }
}

/** AES-256-GCM decrypt; ciphertext is ciphertext||tag as produced by aesGcmEncrypt. */
export function aesGcmDecrypt(key: Buffer, nonceB64: string, ciphertextB64: string, aad: Buffer = AAD): Buffer {
  const nonce = fromB64(nonceB64)
  const raw = fromB64(ciphertextB64)
  if (raw.length < 16) throw new Error('ciphertext too short')
  const data = raw.subarray(0, raw.length - 16)
  const tag = raw.subarray(raw.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()])
}

export interface ScryptKdf {
  alg: 'scrypt'
  salt: string
  params: { N: number; r: number; p: number }
}

export function defaultKdf(salt?: Buffer): ScryptKdf {
  return {
    alg: 'scrypt',
    salt: b64(salt ?? randomBytes(16)),
    params: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
  }
}

export function derivePassphraseKey(passphrase: string, kdf: ScryptKdf): Buffer {
  if (kdf.alg !== 'scrypt') throw new Error(`unsupported kdf: ${kdf.alg}`)
  return scryptSync(passphrase, fromB64(kdf.salt), SCRYPT.keyLen, {
    N: kdf.params.N,
    r: kdf.params.r,
    p: kdf.params.p,
    maxmem: SCRYPT.maxmem,
  })
}

/** Wrap DEK with a 32-byte key → base64 blob of JSON { n, c }. */
export function wrapKey(wrappingKey: Buffer, dek: Buffer): string {
  const { nonce, ciphertext } = aesGcmEncrypt(wrappingKey, dek, Buffer.from('bsv-dek-wrap-v1'))
  return b64(Buffer.from(JSON.stringify({ n: nonce, c: ciphertext }), 'utf8'))
}

export function unwrapKey(wrappingKey: Buffer, blobB64: string): Buffer {
  const { n, c } = JSON.parse(fromB64(blobB64).toString('utf8')) as { n: string; c: string }
  return aesGcmDecrypt(wrappingKey, n, c, Buffer.from('bsv-dek-wrap-v1'))
}

export function wrapDekWithPassphrase(passphrase: string, dek: Buffer, kdf: ScryptKdf): string {
  return wrapKey(derivePassphraseKey(passphrase, kdf), dek)
}

export function unwrapDekWithPassphrase(passphrase: string, blobB64: string, kdf: ScryptKdf): Buffer {
  return unwrapKey(derivePassphraseKey(passphrase, kdf), blobB64)
}

/** Constant-time-ish check that two buffers are equal (same length required). */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
