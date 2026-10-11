import { describe, expect, test } from 'vitest'
import { Mnemonic, PrivateKey, Utils } from '@bsv/sdk'
import { classifyImportInput, isDesktopV2ByDefault, keySecretFromBytes, looksLikeHexKey } from '../src/lib/utils/importSecret'
import { generateEntropyShares, recoverSecretFromShares } from '../src/lib/utils/mnemonicRecovery'
import { mnemonicFromKeyHex } from '../src/lib/utils/keyMaterial'

const TWELVE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
// BSV Desktop 2 used a 24-word phrase's entropy as the private key, so 0x01..0x20 maps to these words.
const V2_KEY_HEX = Array.from({ length: 32 }, (_, i) => (i + 1).toString(16).padStart(2, '0')).join('')
const TWENTY_FOUR = Mnemonic.fromEntropy(Utils.toArray(V2_KEY_HEX, 'hex')).toString()

describe('private key hex', () => {
  test('opens the key itself, in any case and with surrounding whitespace', () => {
    const secret = classifyImportInput(`  ${V2_KEY_HEX.toUpperCase()}\n`)
    expect(secret).toMatchObject({ kind: 'key', source: 'hex', keyHex: V2_KEY_HEX, identityKey: new PrivateKey(V2_KEY_HEX, 16).toPublicKey().toString() })
    expect(secret.kind === 'key' && Utils.toHex(secret.keyBytes)).toBe(V2_KEY_HEX)
    expect(secret.kind === 'key' && secret.mnemonic).toBeUndefined()
    expect(looksLikeHexKey(` ${V2_KEY_HEX} `)).toBe(true)
  })

  test('rejects the wrong length and keys outside the curve', () => {
    expect(() => classifyImportInput(V2_KEY_HEX.slice(1))).toThrow('64 hex characters; this one has 63')
    expect(() => classifyImportInput(V2_KEY_HEX + '0')).toThrow('this one has 65')
    expect(() => classifyImportInput('00'.repeat(32))).toThrow('not a valid private key')
    expect(() => classifyImportInput('ff'.repeat(32))).toThrow('not a valid private key')
    // The curve order n is the first invalid key; n - 1 is the last valid one, opened as typed.
    expect(() => classifyImportInput('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')).toThrow('not a valid private key')
    expect(classifyImportInput('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140')).toMatchObject({ kind: 'key', keyHex: 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140' })
    expect(classifyImportInput('00'.repeat(31) + '01')).toMatchObject({ kind: 'key', keyHex: '00'.repeat(31) + '01' })
  })
})

describe('recovery phrases', () => {
  test('12 words are a BSV Wallet phrase by default', () => {
    expect(isDesktopV2ByDefault(TWELVE)).toBe(false)
    expect(classifyImportInput(`  ${TWELVE.toUpperCase().replace(/ /g, '   ')} `)).toEqual({ kind: 'phrase', mnemonic: TWELVE })
  })

  test('24 words open the BSV Desktop 2 key by default: the entropy, reversible to the same words', () => {
    expect(isDesktopV2ByDefault(TWENTY_FOUR)).toBe(true)
    const secret = classifyImportInput(TWENTY_FOUR)
    expect(secret).toMatchObject({ kind: 'key', source: 'desktop-v2-phrase', keyHex: V2_KEY_HEX, mnemonic: TWENTY_FOUR })
    expect(mnemonicFromKeyHex(V2_KEY_HEX)).toBe(TWENTY_FOUR)
    // Same wallet as importing the key directly.
    expect(secret.kind === 'key' && secret.identityKey).toBe(classifyImportInput(V2_KEY_HEX).kind === 'key' && (classifyImportInput(V2_KEY_HEX) as any).identityKey)
  })

  test('the choice can be overridden either way', () => {
    expect(classifyImportInput(TWENTY_FOUR, false)).toEqual({ kind: 'phrase', mnemonic: TWENTY_FOUR })
    // BSV Desktop 2's other phrases used the first 32 bytes of the BIP39 seed.
    const expected = Utils.toHex(Mnemonic.fromString(TWELVE).toSeed().slice(0, 32))
    expect(classifyImportInput(TWELVE, true)).toMatchObject({ kind: 'key', source: 'desktop-v2-phrase', keyHex: expected, mnemonic: TWELVE })
  })

  test('a 24-word phrase whose entropy is not a usable key is refused', () => {
    expect(() => classifyImportInput(`${'abandon '.repeat(23)}art`)).toThrow('not a valid private key')
    expect(classifyImportInput(`${'abandon '.repeat(23)}art`, false)).toMatchObject({ kind: 'phrase' })
  })

  test('rejects empty input, unknown words and bad checksums', () => {
    expect(() => classifyImportInput('   ')).toThrow('Enter your recovery phrase or private key')
    expect(() => classifyImportInput('hello world')).toThrow('not a valid recovery phrase')
    expect(() => classifyImportInput(TWELVE.replace(/about$/, 'abandon'))).toThrow('not a valid recovery phrase')
  })
})

describe('older private-key backup shares', () => {
  test('open the key they split, the same wallet as importing it as hex', () => {
    const key = new PrivateKey(V2_KEY_HEX, 16)
    const recovered = recoverSecretFromShares(key.toBackupShares(2, 3).slice(1))
    expect(recovered.kind).toBe('legacy')
    const secret = keySecretFromBytes((recovered as any).primaryKey, 'legacy-shares')
    expect(secret).toMatchObject({ kind: 'key', source: 'legacy-shares', keyHex: V2_KEY_HEX, identityKey: key.toPublicKey().toString() })
    expect(secret.mnemonic).toBeUndefined()
  })

  test('keep leading zero bytes of a small key', () => {
    const small = '00'.repeat(4) + 'ab'.repeat(28)
    const recovered = recoverSecretFromShares(new PrivateKey(small, 16).toBackupShares(2, 3).slice(0, 2))
    expect(keySecretFromBytes((recovered as any).primaryKey, 'legacy-shares').keyHex).toBe(small)
  })

  test('newer shares still restore the phrase, not a key', () => {
    expect(recoverSecretFromShares(generateEntropyShares(TWELVE).slice(0, 2))).toMatchObject({ kind: 'entropy', mnemonic: TWELVE })
  })
})
