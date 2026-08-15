import { describe, it, expect } from 'vitest'
import {
  randomDek,
  aesGcmEncrypt,
  aesGcmDecrypt,
  defaultKdf,
  wrapDekWithPassphrase,
  unwrapDekWithPassphrase,
  wrapKey,
  unwrapKey,
  AAD,
} from '../electron/vaultCrypto'

describe('vaultCrypto', () => {
  it('round-trips AES-GCM with AAD', () => {
    const key = randomDek()
    const plain = Buffer.from('hello vault', 'utf8')
    const { nonce, ciphertext } = aesGcmEncrypt(key, plain, AAD)
    expect(ciphertext).not.toContain('hello')
    const out = aesGcmDecrypt(key, nonce, ciphertext, AAD)
    expect(out.toString('utf8')).toBe('hello vault')
  })

  it('fails decrypt with wrong key', () => {
    const { nonce, ciphertext } = aesGcmEncrypt(randomDek(), Buffer.from('x'), AAD)
    expect(() => aesGcmDecrypt(randomDek(), nonce, ciphertext, AAD)).toThrow()
  })

  it('wraps and unwraps DEK with passphrase', () => {
    const dek = randomDek()
    const kdf = defaultKdf()
    const blob = wrapDekWithPassphrase('correct horse battery', dek, kdf)
    const out = unwrapDekWithPassphrase('correct horse battery', blob, kdf)
    expect(out.equals(dek)).toBe(true)
  })

  it('rejects wrong passphrase', () => {
    const dek = randomDek()
    const kdf = defaultKdf()
    const blob = wrapDekWithPassphrase('right-passphrase', dek, kdf)
    expect(() => unwrapDekWithPassphrase('wrong-passphrase', blob, kdf)).toThrow()
  })

  it('wrapKey round-trip', () => {
    const wrapping = randomDek()
    const dek = randomDek()
    const blob = wrapKey(wrapping, dek)
    expect(unwrapKey(wrapping, blob).equals(dek)).toBe(true)
  })
})
