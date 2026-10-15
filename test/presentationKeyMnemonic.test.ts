import { describe, expect, test } from 'vitest'
import { Utils } from '@bsv/sdk'
import { derivePresentationKeyFromMnemonic } from '../src/lib/utils/keyMaterial'

// Public BIP-39 zero-entropy vectors. Expected keys were captured from the
// existing m/0'/0/0 login derivation before changing input normalization.
const vectors = [
  { phrase: [...Array(11).fill('abandon'), 'about'].join(' '), key: 'e81fa7bb95cc6bee975bf675bfebbab4044c1390e6a00ae246e55c07e3cf835e' },
  { phrase: [...Array(23).fill('abandon'), 'art'].join(' '), key: '578946c3026664eb214d11e146d7820e8c101ea7e5af925d59b26cf91cdb7307' }
]

describe('mnemonic presentation-key login and recovery', () => {
  test.each(vectors)('preserves the existing key for a canonical phrase', ({ phrase, key }) => {
    expect(Utils.toHex(derivePresentationKeyFromMnemonic(phrase))).toBe(key)
  })

  test.each(vectors)('accepts pasted whitespace without changing the wallet key', ({ phrase, key }) => {
    const variants = [
      `  ${phrase}  `,
      phrase.replaceAll(' ', '  '),
      phrase.replaceAll(' ', '\n'),
      phrase.replaceAll(' ', '\r\n\t'),
      phrase.replaceAll(' ', '\u00a0')
    ]
    for (const variant of variants) {
      expect(Utils.toHex(derivePresentationKeyFromMnemonic(variant))).toBe(key)
    }
  })

  test('continues rejecting an invalid checksum', () => {
    expect(() => derivePresentationKeyFromMnemonic(Array(12).fill('abandon').join(' '))).toThrow()
  })

  test('continues rejecting an unknown word', () => {
    expect(() => derivePresentationKeyFromMnemonic(vectors[0].phrase.replace('about', 'notaword'))).toThrow()
  })
})
