import { Utils } from '@bsv/sdk'
import { Mnemonic } from '@bsv/sdk/compat'

export const normalizeMnemonic = (phrase: string): string =>
  phrase.trim().replace(/\s+/g, ' ')

const mnemonicToEntropy = (m: Mnemonic): number[] => {
  const mnemonic = m.toString()
  const { value: wordlist, space } = m.Wordlist
  const words = mnemonic.split(space)

  let bin = ''
  for (const word of words) {
    const index = wordlist.indexOf(word)
    if (index < 0) {
      throw new Error('Invalid mnemonic word')
    }
    bin += ('00000000000' + index.toString(2)).slice(-11)
  }

  if (bin.length % 11 !== 0) {
    throw new Error(
      `Entropy not an even multiple of 11 bits: ${bin.length}`
    )
  }

  const checksumBits = bin.length / 33
  const entropyBits = bin.slice(0, bin.length - checksumBits)
  const entropy: number[] = []

  for (let i = 0; i < entropyBits.length / 8; i++) {
    entropy.push(parseInt(entropyBits.slice(i * 8, (i + 1) * 8), 2))
  }

  return entropy
}

export const deriveKeyMaterialFromMnemonic = (
  phrase: string
): { keyHex: string; keyBytes: number[]; mnemonic: string } => {
  const normalized = normalizeMnemonic(phrase)
  const m = Mnemonic.fromString(normalized)
  const entropy = mnemonicToEntropy(m)

  // Prefer a reversible entropy-based mapping when the mnemonic encodes 32 bytes (24-word phrases),
  // but fall back to the legacy seed-derived mapping for 12-word phrases to preserve compatibility.
  if (entropy.length === 32) {
    const keyHex = Utils.toHex(entropy)
    return { keyHex, keyBytes: entropy, mnemonic: normalized }
  }

  const seed = m.toSeed()
  const keyBytes = seed.slice(0, 32)

  if (keyBytes.length !== 32) {
    throw new Error('Unable to derive key from mnemonic')
  }

  return { keyHex: Utils.toHex(keyBytes), keyBytes, mnemonic: normalized }
}

export const mnemonicFromKeyHex = (keyHex: string): string => {
  const keyBytes = Utils.toArray(keyHex, 'hex')
  return Mnemonic.fromEntropy(keyBytes).toString()
}

export const persistKeyMaterial = (keyHex: string, mnemonic?: string): string => {
  const phrase = mnemonic ? normalizeMnemonic(mnemonic) : mnemonicFromKeyHex(keyHex)
  localStorage.setItem('primaryKeyHex', keyHex)
  localStorage.setItem('mnemonic12', phrase)
  return phrase
}

export const reconcileStoredKeyMaterial = (): { keyHex: string; mnemonic: string } => {
  if (typeof window === 'undefined') {
    return { keyHex: '', mnemonic: '' }
  }

  const storedMnemonic = (localStorage.getItem('mnemonic12') || '').trim()
  const storedHex = (localStorage.getItem('primaryKeyHex') || '').trim()

  if (storedMnemonic) {
    try {
      const { keyHex, mnemonic } = deriveKeyMaterialFromMnemonic(storedMnemonic)
      persistKeyMaterial(keyHex, mnemonic)
      return { keyHex, mnemonic }
    } catch (err) {
      console.error('Failed to derive key from stored mnemonic', err)
      localStorage.removeItem('mnemonic12')
    }
  }

  if (storedHex) {
    try {
      const phrase = persistKeyMaterial(storedHex)
      return { keyHex: storedHex, mnemonic: phrase }
    } catch (err) {
      console.error('Failed to derive mnemonic from stored key', err)
    }
  }

  return { keyHex: '', mnemonic: '' }
}
