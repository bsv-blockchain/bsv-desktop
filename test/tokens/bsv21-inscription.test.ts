/**
 * BSV-21 inscription round-trip tests.
 *
 * The inscription builder and parser are pure functions that own the wire
 * format the wallet uses to recognise BSV-21 receives. A bug here would be
 * silent — the wallet would broadcast txs the indexer can't index, or fail
 * to recognise inscriptions sent by other senders. Worth pinning down.
 */

import { describe, test, expect } from 'vitest'
import {
  buildBsv21Transfer,
  parseBsv21LockingScript,
} from '../../src/lib/services/tokens/bsv21/inscription'

// A real-looking owner PKH (20 bytes hex). Doesn't matter that it's not a
// valid hash160 of anything — the builder/parser don't verify, they just
// shuffle bytes.
const OWNER_HASH160 = '675d894f5ea1dbc6f1677850d07eef4d35fcdff6'

describe('buildBsv21Transfer / parseBsv21LockingScript round-trip', () => {
  test('minimal payload (id + amt only) survives a round trip', () => {
    const hex = buildBsv21Transfer({
      payload: {
        id: 'abc123_0',
        amt: '1000',
      },
      ownerHash160: OWNER_HASH160,
    })
    const parsed = parseBsv21LockingScript(hex)
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe('abc123_0')
    expect(parsed!.amt).toBe('1000')
    expect(parsed!.dec).toBeUndefined()
    expect(parsed!.sym).toBeUndefined()
    expect(parsed!.icon).toBeUndefined()
    expect(parsed!.ownerHash160).toBe(OWNER_HASH160)
  })

  test('full payload (id + amt + dec + sym + icon) survives a round trip', () => {
    const hex = buildBsv21Transfer({
      payload: {
        id: 'deadbeef_3',
        amt: '123456789',
        dec: 8,
        sym: 'TEST',
        icon: 'icon_outpoint_xyz_0',
      },
      ownerHash160: OWNER_HASH160,
    })
    const parsed = parseBsv21LockingScript(hex)
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe('deadbeef_3')
    expect(parsed!.amt).toBe('123456789')
    expect(parsed!.dec).toBe(8)
    expect(parsed!.sym).toBe('TEST')
    expect(parsed!.icon).toBe('icon_outpoint_xyz_0')
    expect(parsed!.ownerHash160).toBe(OWNER_HASH160)
  })

  test('built script starts with the ord envelope opcodes', () => {
    const hex = buildBsv21Transfer({
      payload: { id: 'abc_0', amt: '1' },
      ownerHash160: OWNER_HASH160,
    })
    // 00 = OP_FALSE, 63 = OP_IF, 03 = push 3 bytes, 6f7264 = "ord"
    expect(hex.startsWith('0063036f7264')).toBe(true)
  })

  test('built script ends with the recipient P2PKH (DUP HASH160 push EQUALVERIFY CHECKSIG)', () => {
    const hex = buildBsv21Transfer({
      payload: { id: 'abc_0', amt: '1' },
      ownerHash160: OWNER_HASH160,
    })
    // 68 = OP_ENDIF (closes ord envelope)
    // 76 a9 14 <pkh> 88 ac = canonical P2PKH
    expect(hex).toContain(`6876a914${OWNER_HASH160}88ac`)
    expect(hex.endsWith(`76a914${OWNER_HASH160}88ac`)).toBe(true)
  })

  test('JSON payload uses fixed field order for reproducible bytes', () => {
    // Two builds with the same inputs produce byte-identical scripts.
    const a = buildBsv21Transfer({
      payload: { id: 'x_0', amt: '42', dec: 6, sym: 'X' },
      ownerHash160: OWNER_HASH160,
    })
    const b = buildBsv21Transfer({
      payload: { id: 'x_0', amt: '42', dec: 6, sym: 'X' },
      ownerHash160: OWNER_HASH160,
    })
    expect(a).toBe(b)
  })

  test('JSON payload encodes dec as a string, not a number', () => {
    // The 1sat-stack go-templates/bsv21 decoder unmarshals the inscription
    // body into map[string]string — a numeric `dec` (`"dec":6`) breaks the
    // unmarshal and the topic-manager silently rejects the output. The
    // canonical form is `"dec":"6"`. This test locks in the fix.
    const hex = buildBsv21Transfer({
      payload: { id: 'x_0', amt: '42', dec: 6 },
      ownerHash160: OWNER_HASH160,
    })
    // Find the JSON payload bytes inside the inscription envelope and
    // assert the substring `"dec":"6"` is present (string form), not
    // `"dec":6` (number form).
    expect(hex).toContain(
      Buffer.from('"dec":"6"', 'utf8').toString('hex'),
    )
    expect(hex).not.toContain(
      Buffer.from('"dec":6,', 'utf8').toString('hex'),
    )
  })

  test('JSON payload encodes content-type tag as OP_1 (0x51), not 0101', () => {
    // 1sat-stack's go-templates/bsv21 + JungleBus auto-pickup both require
    // canonical minimal-push encoding for the ord content-type tag. The
    // non-minimal `01 01` form caused our outputs to be skipped entirely.
    const hex = buildBsv21Transfer({
      payload: { id: 'abc_0', amt: '1' },
      ownerHash160: OWNER_HASH160,
    })
    // The 'ord' push (`036f7264`) is immediately followed by the content-
    // type tag. Canonical form: `036f7264 51 12...` (OP_1, then push of
    // 18-byte "application/bsv-20"). Legacy non-canonical: `036f7264 0101 12...`.
    expect(hex).toContain('036f72645112')
    expect(hex).not.toContain('036f7264010112')
  })

  test('builder embeds the id verbatim — caller must pass underscore form', () => {
    // Per BSV-21 spec, the transfer inscription's `id` field is
    // `<txid>_<vout>` (UNDERSCORE), not the dot form used for outpoints.
    // The builder doesn't normalize — it embeds whatever the caller
    // passes. BSV21TransferService is the canonical normalization point;
    // this test documents the contract.
    const underscoreId = 'deadbeef_0'
    const hex = buildBsv21Transfer({
      payload: { id: underscoreId, amt: '1' },
      ownerHash160: OWNER_HASH160,
    })
    // The id appears in the JSON payload as `"id":"deadbeef_0"`.
    const jsonFragment = Buffer.from(`"id":"${underscoreId}"`, 'utf8').toString('hex')
    expect(hex).toContain(jsonFragment)
    // And the dot form would be wrong — assert it's absent.
    expect(hex).not.toContain(
      Buffer.from('"id":"deadbeef.0"', 'utf8').toString('hex'),
    )
  })
})

describe('parseBsv21LockingScript rejection cases', () => {
  test('non-string input returns null', () => {
    expect(parseBsv21LockingScript(null as any)).toBeNull()
    expect(parseBsv21LockingScript(undefined as any)).toBeNull()
    expect(parseBsv21LockingScript(42 as any)).toBeNull()
  })

  test('empty / too-short scripts return null', () => {
    expect(parseBsv21LockingScript('')).toBeNull()
    expect(parseBsv21LockingScript('00')).toBeNull()
    expect(parseBsv21LockingScript('00'.repeat(10))).toBeNull()
  })

  test('plain P2PKH (no ord envelope) returns null', () => {
    // 76 a9 14 <pkh> 88 ac
    const p2pkh = `76a914${OWNER_HASH160}88ac`
    expect(parseBsv21LockingScript(p2pkh)).toBeNull()
  })

  test('ord envelope with non-BSV20 content-type returns null', () => {
    // Build manually: OP_FALSE OP_IF push "ord" push 0x01 push "text/plain" OP_0 push "{}" OP_ENDIF + P2PKH
    const hex =
      '00' +
      '63' +
      '03' + '6f7264' + // "ord"
      '01' + '01' +     // field-id marker
      '0a' + '746578742f706c61696e' + // "text/plain" (10 bytes)
      '00' +            // OP_0 separator
      '02' + '7b7d' +   // "{}" (2 bytes)
      '68' +
      `76a914${OWNER_HASH160}88ac`
    expect(parseBsv21LockingScript(hex)).toBeNull()
  })

  test('ord envelope with invalid JSON returns null', () => {
    // application/bsv-20 content type, but body is not JSON
    const ct = Buffer.from('application/bsv-20', 'utf8').toString('hex')
    const body = Buffer.from('not json', 'utf8').toString('hex')
    const hex =
      '00' + '63' +
      '03' + '6f7264' +
      '01' + '01' +
      '12' + ct +
      '00' +
      body.length / 2 < 0x4c
        ? (body.length / 2).toString(16).padStart(2, '0') + body
        : '4c' + (body.length / 2).toString(16).padStart(2, '0') + body
    // (Sloppy — just construct fully)
    const bodyHex = Buffer.from('not json', 'utf8').toString('hex')
    const fullHex =
      '00' + '63' +
      '03' + '6f7264' +
      '01' + '01' +
      '12' + ct +
      '00' +
      (bodyHex.length / 2).toString(16).padStart(2, '0') + bodyHex +
      '68' +
      `76a914${OWNER_HASH160}88ac`
    expect(parseBsv21LockingScript(fullHex)).toBeNull()
  })

  test('ord envelope with JSON missing `p` field returns null', () => {
    const ct = Buffer.from('application/bsv-20', 'utf8').toString('hex')
    const bodyHex = Buffer.from('{"op":"transfer","amt":"1"}', 'utf8').toString('hex')
    const fullHex =
      '00' + '63' +
      '03' + '6f7264' +
      '01' + '01' +
      '12' + ct +
      '00' +
      (bodyHex.length / 2).toString(16).padStart(2, '0') + bodyHex +
      '68' +
      `76a914${OWNER_HASH160}88ac`
    expect(parseBsv21LockingScript(fullHex)).toBeNull()
  })
})

describe('parseBsv21LockingScript deploy+mint vs transfer', () => {
  test('deploy+mint payloads have no id in JSON — parser surfaces empty id', () => {
    // Mints don't carry `id` in the BSV-20 JSON; the outpoint IS the id.
    // The parser's contract: return id='' when missing, callers resolve
    // the canonical id from the outpoint.
    const ct = Buffer.from('application/bsv-20', 'utf8').toString('hex')
    const bodyHex = Buffer.from(
      '{"p":"bsv-20","op":"deploy+mint","amt":"1000","dec":0,"sym":"NEW"}',
      'utf8',
    ).toString('hex')
    const fullHex =
      '00' + '63' +
      '03' + '6f7264' +
      '01' + '01' +
      '12' + ct +
      '00' +
      '4c' + (bodyHex.length / 2).toString(16).padStart(2, '0') + bodyHex +
      '68' +
      `76a914${OWNER_HASH160}88ac`
    const parsed = parseBsv21LockingScript(fullHex)
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe('')
    expect(parsed!.amt).toBe('1000')
    expect(parsed!.dec).toBe(0)
    expect(parsed!.sym).toBe('NEW')
  })
})
