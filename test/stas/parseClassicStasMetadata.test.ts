/**
 * parseClassicStasMetadata — symbol extraction.
 *
 * Regression guard for the off-by-one that made every classic-STAS token show
 * as the generic "STAS". stas-js emits the OP_RETURN tail as
 *   6a <20-byte tokenId> <flags byte> <symbol> <data>
 * The parser previously assumed it started at the flags byte, so it read the
 * flags byte as the symbol and lost the real ticker. The vector below is the
 * real tail of mainnet tx ae28c031… (a "CSTAS" mint).
 */

import { describe, test, expect } from 'vitest'
import { parseClassicStasMetadata } from '../../src/lib/services/stas/parseClassicStasMetadata'

// A minimal classic-STAS script: the mandatory 76a914<pkh>88ac69 prefix, an
// opaque engine body with no stray 6a, then the real CSTAS OP_RETURN tail.
const OWNER = 'cd'.repeat(20)
const ENGINE = 'ab'.repeat(1200) // opaque filler, no 0x6a bytes
// 6a 14 <20B tokenId> 01 00 05 "CSTAS" 04 "demo"
const OP_RETURN_TAIL =
  '6a' +
  '14' + '783eadfd045de5484fc4b81ab875df3d96380251' +
  '01' + '00' +
  '05' + '4353544153' +
  '04' + '64656d6f'
const CSTAS_SCRIPT = `76a914${OWNER}88ac69${ENGINE}${OP_RETURN_TAIL}`

describe('parseClassicStasMetadata', () => {
  test('extracts the real ticker past the 20-byte tokenId lead', () => {
    const meta = parseClassicStasMetadata(CSTAS_SCRIPT)
    expect(meta).not.toBeNull()
    expect(meta!.symbol).toBe('CSTAS')
    expect(meta!.ownerFieldHash160).toBe(OWNER)
    expect(meta!.flagsHex).toBe('00')
  })

  test('DSTAS-style tail (tokenId + flags, no symbol) yields null symbol', () => {
    // 6a 14 <tokenId> 01 00  — no symbol push after the flags.
    const tail = '6a' + '14' + 'ab'.repeat(20) + '01' + '00'
    const script = `76a914${OWNER}88ac69${ENGINE}${tail}`
    const meta = parseClassicStasMetadata(script)
    expect(meta).not.toBeNull()
    expect(meta!.symbol).toBeNull()
  })

  test('rejects scripts without the classic-STAS prefix', () => {
    expect(parseClassicStasMetadata('deadbeef')).toBeNull()
    expect(parseClassicStasMetadata('76a914' + OWNER + '88ac00' + ENGINE)).toBeNull()
  })
})
