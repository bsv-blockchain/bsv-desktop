import { describe, expect, it } from 'vitest'
import { Hash, Mnemonic, PrivateKey } from '@bsv/sdk'
import {
  classifyPayload, deriveMnemonicWallet, frameEntropy, generateEntropyShares,
  generateRecoveryPhrase, padPayload, parseShare, recoverSecretFromShares, verifyMnemonicWallet,
} from '../src/lib/utils/mnemonicRecovery'
import { deriveKeyMaterialFromMnemonic } from '../src/lib/utils/keyMaterial'

const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const identity = '02f32dbd49d7a3539d9de0f007726c523ca4312b7c8eab26b018b86e0d17d460f6'

describe('BSV Wallet mnemonic compatibility', () => {
  it('matches mobile profile zero primary and privileged derivation fixtures', () => {
    const wallet = deriveMnemonicWallet(phrase)
    expect(wallet.keyHex).toBe('bfaf770fb7d26ccb976891c40197bf73c928a8e2da8240ad5c5073f314c4dea1')
    expect(wallet.privilegedKey.toHex()).toBe('3390ec9c9ad562e0ff44202e6de7e0add5350b5dcf8b5e1137c3c2a6cdcd5855')
    expect(wallet.identityKey).toBe(identity)
    expect(wallet.keyBytes).toHaveLength(32)
  })

  it('normalizes pasted case and whitespace without changing identity', () => {
    expect(deriveMnemonicWallet(`  ${phrase.toUpperCase().replaceAll(' ', '\n ')}  `).identityKey).toBe(identity)
  })

  it('rejects invalid phrases and checks that backup material matches the saved identity', () => {
    expect(() => deriveMnemonicWallet('abandon '.repeat(12))).toThrow()
    const wallet = deriveMnemonicWallet(phrase)
    expect(verifyMnemonicWallet(phrase, wallet.keyHex, identity).identityKey).toBe(identity)
    expect(() => verifyMnemonicWallet(phrase, '00'.repeat(32))).toThrow(/does not match/)
    expect(() => verifyMnemonicWallet(phrase, wallet.keyHex, PrivateKey.fromRandom().toPublicKey().toString())).toThrow(/does not match/)
  })

  it('keeps old desktop derivation available rather than silently migrating existing identities', () => {
    const legacy = deriveKeyMaterialFromMnemonic(phrase)
    expect(legacy.keyHex).not.toBe(deriveMnemonicWallet(phrase).keyHex)
    const old24 = Mnemonic.fromEntropy(new Array(32).fill(7)).toString()
    expect(deriveKeyMaterialFromMnemonic(old24).keyHex).toBe('07'.repeat(32))
  })

  it('generates valid twelve-word phrases for mobile-compatible backups', () => {
    const generated = generateRecoveryPhrase()
    expect(generated.split(' ')).toHaveLength(12)
    expect(deriveMnemonicWallet(generated).entropy).toHaveLength(16)
  })
})

describe('BRC-157 entropy shares', () => {
  it('uses the same entropy || sha256 tag framing as BSV Wallet', () => {
    const entropy = Mnemonic.fromString(phrase).toEntropy()
    expect(frameEntropy(entropy)).toEqual([...entropy, ...Hash.sha256(entropy).slice(0, 16)])
    expect(() => frameEntropy(new Array(32).fill(1))).toThrow(/twelve-word/)
    expect(() => padPayload(new Array(33).fill(1))).toThrow(/32 bytes/)
  })

  it('recovers the exact phrase and both profile keys from every pair of three shares', () => {
    const shares = generateEntropyShares(phrase)
    for (const pair of [[0, 1], [0, 2], [1, 2]]) {
      const recovered = recoverSecretFromShares(pair.map(index => shares[index]))
      expect(recovered.kind).toBe('entropy')
      if (recovered.kind !== 'entropy') throw new Error('Unexpected legacy share')
      expect(recovered.mnemonic).toBe(phrase)
      expect(deriveMnemonicWallet(recovered.mnemonic).identityKey).toBe(identity)
    }
  })

  it('imports externally generated mobile-format shares with leading-zero entropy intact', () => {
    const entropy = new Array(16).fill(0)
    const mobileShares = new PrivateKey([...entropy, ...Hash.sha256(entropy).slice(0, 16)]).toBackupShares(2, 3)
    const result = recoverSecretFromShares([mobileShares[0], mobileShares[2]])
    expect(result.kind).toBe('entropy')
    expect(result.kind === 'entropy' && result.entropy).toEqual(entropy)
    expect(classifyPayload(frameEntropy(entropy).slice(16)).kind).toBe('entropy')
  })

  it('rejects duplicate, incomplete, malformed, and mixed-backup shares', () => {
    const first = generateEntropyShares(phrase)
    const other = generateEntropyShares(generateRecoveryPhrase())
    expect(() => recoverSecretFromShares([first[0]])).toThrow(/needs 2/)
    expect(() => recoverSecretFromShares([first[0], first[0]])).toThrow(/different/)
    expect(() => recoverSecretFromShares([first[0], other[1]])).toThrow(/different backups/)
    expect(() => parseShare('not.a.complete.share')).toThrow(/valid backup share/)
    expect(() => parseShare('a.b.2.5.trailing')).toThrow(/valid backup share/)
  })

  it('classifies older primary-key paper explicitly instead of inventing a recovery phrase', () => {
    const legacyKey = new PrivateKey(1)
    const shares = legacyKey.toBackupShares(2, 3)
    const result = recoverSecretFromShares(shares.slice(0, 2))
    expect(result.kind).toBe('legacy')
    expect(result.kind === 'legacy' && result.keyHex).toBe('00'.repeat(31) + '01')
    const corrupted = frameEntropy(new Array(16).fill(7))
    corrupted[31] ^= 255
    expect(classifyPayload(corrupted).kind).toBe('legacy')
  })
})
