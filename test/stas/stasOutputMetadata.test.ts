/**
 * stasOutputMetadata codec — write shape == read shape.
 *
 * Registration encodes onto the standard output record; the read paths decode
 * from listOutputs. If these ever drift, STAS/DSTAS render wrong or not at all,
 * so the round-trip is pinned here.
 */

import { describe, test, expect } from 'vitest'
import {
  encodeStasOutputMetadata,
  decodeStasOutputMetadata,
  tagValue,
} from '../../src/lib/services/stas/stasOutputMetadata'

describe('stasOutputMetadata', () => {
  test('round-trips a full STAS record', () => {
    const meta = {
      kind: 'stas' as const,
      tokenId: '783eadfd045de5484fc4b81ab875df3d96380251',
      brc42KeyId: 'recv 8',
      ownerFieldHash160: 'cd'.repeat(20),
      symbol: 'CSTAS',
      name: null,
      flagsHex: '00',
      freezeEnabled: false,
      confiscationEnabled: false,
      redemptionPkh: '783eadfd045de5484fc4b81ab875df3d96380251',
      satoshisPerToken: 1,
      serviceFields: ['00'.repeat(20)],
      frozen: false,
      confiscated: false,
    }
    const enc = encodeStasOutputMetadata(meta)
    // tags mirror BSV-21: kind, id:, sym:
    expect(enc.tags).toContain('stas')
    expect(enc.tags).toContain(`id:${meta.tokenId}`)
    expect(enc.tags).toContain('sym:CSTAS')

    const dec = decodeStasOutputMetadata(enc.customInstructions, enc.tags)
    expect(dec).not.toBeNull()
    expect(dec!.kind).toBe('stas')
    expect(dec!.symbol).toBe('CSTAS')
    expect(dec!.tokenId).toBe(meta.tokenId)
    expect(dec!.brc42KeyId).toBe('recv 8')
    expect(dec!.satoshisPerToken).toBe(1)
  })

  test('DSTAS with a packed BRC-29 derivation (received token)', () => {
    const meta = {
      kind: 'dstas' as const,
      tokenId: 'ab'.repeat(20),
      brc42KeyId: 'brc29|cGZ4|c2Z4|03abc...sender',
      symbol: undefined, // DSTAS carries no on-chain symbol
    }
    const enc = encodeStasOutputMetadata(meta)
    expect(enc.tags).toContain('dstas')
    expect(enc.tags.some((t) => t.startsWith('sym:'))).toBe(false) // no symbol → no sym tag
    const dec = decodeStasOutputMetadata(enc.customInstructions, enc.tags)
    expect(dec!.kind).toBe('dstas')
    expect(dec!.brc42KeyId).toBe('brc29|cGZ4|c2Z4|03abc...sender')
  })

  test('decodes a legacy record that predates the `kind` field via the protocol tag', () => {
    // Old shape: customInstructions had no `kind`; only the [protocol.id] tag.
    const legacyCi = JSON.stringify({
      tokenId: 'ab'.repeat(20),
      brc42KeyId: 'recv 3',
      flagsHex: '00',
      serviceFields: [],
    })
    const dec = decodeStasOutputMetadata(legacyCi, ['stas'])
    expect(dec).not.toBeNull()
    expect(dec!.kind).toBe('stas')
    expect(dec!.tokenId).toBe('ab'.repeat(20))
  })

  test('returns null for a non-STAS output (e.g. BSV-21 or plain)', () => {
    expect(decodeStasOutputMetadata(JSON.stringify({ kind: 'bsv-21' }), ['bsv21'])).toBeNull()
    expect(decodeStasOutputMetadata(undefined, [])).toBeNull()
    expect(decodeStasOutputMetadata('not json', ['default'])).toBeNull()
  })

  test('fallbackKind decodes a basket member whose kind and tags are both absent', () => {
    // The exact remote-storage bug: an old record synced to remote arrives with
    // partial customInstructions (no kind) AND no protocol tag (tags dropped in
    // sync). Without the caller's known basket it decoded to null and the token
    // vanished from Assets. The basket is authoritative → it must decode.
    const oldCi = JSON.stringify({ tokenId: 'ab'.repeat(20), brc42KeyId: 'recv 3' })
    expect(decodeStasOutputMetadata(oldCi, [])).toBeNull() // no signal at all
    const dec = decodeStasOutputMetadata(oldCi, [], 'dstas') // caller knows the basket
    expect(dec).not.toBeNull()
    expect(dec!.kind).toBe('dstas')
    expect(dec!.tokenId).toBe('ab'.repeat(20))
  })

  test('fallbackKind never overrides a positively-declared foreign kind', () => {
    // A BSV-21 blob must stay rejected even if a caller passes a STAS fallback.
    expect(decodeStasOutputMetadata(JSON.stringify({ kind: 'bsv-21' }), [], 'stas')).toBeNull()
  })

  test('tagValue reads key:value tags', () => {
    expect(tagValue(['sym:CSTAS', 'id:abc'], 'sym')).toBe('CSTAS')
    expect(tagValue(['sym:CSTAS'], 'id')).toBeUndefined()
  })
})
