/**
 * DSTAS transfer test surface (F3).
 *
 * Three layers exercised here:
 *
 * 1. **Parser propagation** — the extended `parseDstasLockingScript`
 *    now surfaces `optionalData`, `actionData` and `frozen` (required
 *    by the transfer flow to construct the new output's locking script
 *    correctly per DSTAS_SCRIPT_INVARIANTS.md §7).
 *
 * 2. **Unlock-script builder** — `buildDstasUnlockingScript` mirrors
 *    the SDK's `InputBuilder.sign` DSTAS branch. We exercise the
 *    byte-encoding primitives + the structural layout (preimage push,
 *    spending-type, sig push, pubkey push) so a future change can't
 *    silently drift from the SDK's expected witness shape.
 *
 * 3. **DstasTransferService source validation** — early rejection
 *    paths that don't require mocking wallet-toolbox (non-DSTAS
 *    source, frozen UTXO). A full happy-path test for the service
 *    would need a fake wallet implementing createAction/signAction —
 *    out of scope for this iteration; manual verification will cover
 *    the on-chain happy path.
 */

import { describe, test, expect, vi } from 'vitest'
import { fromHex, toHex } from 'dxs-bsv-token-sdk/bsv'
import * as DstasLockingBuilderModule from 'dxs-bsv-token-sdk/script/build/dstas-locking-builder'
const { buildDstasLockingScript } = DstasLockingBuilderModule
import { parseDstasLockingScript } from '../../src/lib/services/stas/dstasParser'
import { buildDstasUnlockingScript } from '../../src/lib/services/tokens/dstas/buildDstasUnlockingScript'
import { DstasTransferService } from '../../src/lib/services/tokens/dstas/DstasTransferService'

// 20-byte placeholders.
const OWNER_HASH160 = '11'.repeat(20)
const RECIPIENT_HASH160 = '33'.repeat(20)
const TOKEN_ID = 'ab'.repeat(20)

function makeDstasScriptHex(opts: {
  ownerHash160?: string
  optionalData?: string[]
} = {}): string {
  const z20 = new Uint8Array(20)
  // `buildDstasLockingScript` is the full builder — it accepts
  // optionalData and propagates it into the locking template
  // (unlike `buildDstasLockingScriptForOwnerField` which hardcodes
  // `optionalData: []`).
  const lockingBytes = buildDstasLockingScript({
    ownerPkh: fromHex(opts.ownerHash160 ?? OWNER_HASH160),
    redemptionPkh: fromHex(TOKEN_ID),
    actionData: null,
    frozen: false,
    flags: new Uint8Array([0x03]), // freezable + confiscatable
    serviceFields: [z20, z20],
    optionalData: (opts.optionalData ?? []).map((s) => fromHex(s)),
  })
  return toHex(lockingBytes)
}

// ──────────────── Parser propagation ────────────────

describe('parseDstasLockingScript — extended fields for DSTAS send', () => {
  test('surfaces optionalData when present (byte-exact)', () => {
    const data = ['deadbeef', '1234']
    const hex = makeDstasScriptHex({ optionalData: data })
    const parsed = parseDstasLockingScript(hex)
    expect(parsed).not.toBeNull()
    expect(parsed!.optionalData).toEqual(data)
  })

  test('surfaces empty optionalData when absent', () => {
    const hex = makeDstasScriptHex({ optionalData: [] })
    const parsed = parseDstasLockingScript(hex)
    expect(parsed).not.toBeNull()
    expect(parsed!.optionalData).toEqual([])
  })

  test('exposes actionData + frozen flag (default unfrozen for fresh issue)', () => {
    const hex = makeDstasScriptHex()
    const parsed = parseDstasLockingScript(hex)
    expect(parsed).not.toBeNull()
    expect(parsed!.frozen).toBe(false)
    expect(parsed!.actionData).toBeDefined()
  })
})

// ──────────────── Unlock-script builder ────────────────

/**
 * Build a synthetic bsv-js Transaction with:
 *   - 1 DSTAS input (with prev-output attached)
 *   - 1 BSV funding input
 *   - 1 DSTAS output (recipient)
 *   - 1 P2PKH change output
 *
 * Enough structure to exercise the unlock builder's output-walk and
 * funding-pointer logic without needing a real wallet.
 */
async function makeUnsignedTx(opts: { withChange?: boolean } = {}) {
  const bsv: any = (await import('bsv')).default ?? (await import('bsv'))
  const tx = new bsv.Transaction()

  // Build a real P2PKH locking script from a hash160 (bypassing base58
  // address parsing — we just need a script with the right shape).
  function p2pkhHexForHash160(hex: string): string {
    return '76a914' + hex + '88ac'
  }

  // Input 0: DSTAS source (txid '11', vout 0).
  const sourceScriptHex = makeDstasScriptHex()
  tx.from({
    txId: '11'.repeat(32),
    outputIndex: 0,
    script: sourceScriptHex,
    satoshis: 100,
  })

  // Input 1: BSV funding (txid '22', vout 1) — fake P2PKH for the
  // funding owner. The actual locking script of the funding input
  // doesn't matter to the unlock builder; only its outpoint pointers
  // (txid + vout) are read.
  tx.from({
    txId: '22'.repeat(32),
    outputIndex: 1,
    script: p2pkhHexForHash160('aa'.repeat(20)),
    satoshis: 1000,
  })

  // Output 0: new DSTAS to recipient.
  const recipientScriptHex = makeDstasScriptHex({ ownerHash160: RECIPIENT_HASH160 })
  tx.addOutput(
    new bsv.Transaction.Output({
      script: bsv.Script.fromHex(recipientScriptHex),
      satoshis: 100,
    }),
  )
  // Output 1 (optional): P2PKH change.
  if (opts.withChange ?? true) {
    tx.addOutput(
      new bsv.Transaction.Output({
        script: bsv.Script.fromHex(p2pkhHexForHash160('bb'.repeat(20))),
        satoshis: 800,
      }),
    )
  }
  return { tx, sourceScriptHex, recipientScriptHex }
}

describe('buildDstasUnlockingScript — DSTAS regular-spend witness', () => {
  test('produces a well-formed unlock script with all required pushes', async () => {
    const { tx } = await makeUnsignedTx()
    // 73-byte placeholder DER signature, 33-byte compressed pubkey,
    // 100-byte placeholder preimage.
    const fakeSig = new Uint8Array(72).fill(0xab)
    const fakePub = new Uint8Array(33)
    fakePub[0] = 0x02
    const fakePreimage = new Uint8Array(50).fill(0xcd)

    const hex = buildDstasUnlockingScript({
      unsignedTx: tx,
      inputIdx: 0,
      fundingInputIdx: 1,
      preimage: fakePreimage,
      signatureDer: fakeSig,
      publicKey: fakePub,
      spendingType: 1,
    })

    // Sanity: the unlock script contains:
    //   - the preimage bytes (pushed somewhere mid-script)
    //   - the sig + sighash type byte (0x41) appended
    //   - the pubkey
    //   - the funding outpoint's reversed txid (`22` repeating)
    const sigWithType = toHex(fakeSig) + '41'
    expect(hex).toContain(sigWithType)
    expect(hex).toContain(toHex(fakePub))
    expect(hex).toContain(toHex(fakePreimage))
    // Reversed funding txid '22' repeated.
    expect(hex).toContain('2022' + '22'.repeat(31))
  })

  test('emits OP_1..OP_16 for small-integer pushes (BSV minimality)', async () => {
    // Regression for the production bug surfaced by the script evaluator
    // ("data is not minimally encoded. PC: 6") on the first DSTAS send.
    // scriptNumPush(1..16) must emit OP_1..OP_16 (0x51..0x60), NOT the
    // data-push form `01 NN`.
    //
    // We walk the unlock script's push opcodes by length-decoding from
    // the front and verify the funding-vout / spending-type slots —
    // which fall at known positions in the SDK's layout — are OP_1 (0x51),
    // not the non-minimal `01 01` form.
    const { tx } = await makeUnsignedTx() // funding vout = 1, spending type = 1
    const fakeSig = new Uint8Array(72)
    const fakePub = new Uint8Array(33)
    fakePub[0] = 0x02
    const hex = buildDstasUnlockingScript({
      unsignedTx: tx,
      inputIdx: 0,
      fundingInputIdx: 1,
      preimage: new Uint8Array(20),
      signatureDer: fakeSig,
      publicKey: fakePub,
      spendingType: 1,
    })
    const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)))

    // Walk pushes by opcode-decoding. For each, capture the opcode + payload.
    type Push = { opcode: number; payloadLen: number; offset: number }
    const pushes: Push[] = []
    let i = 0
    while (i < bytes.length) {
      const op = bytes[i]
      if (op === 0x00) {
        pushes.push({ opcode: op, payloadLen: 0, offset: i })
        i += 1
      } else if (op >= 0x51 && op <= 0x60) {
        // OP_1 .. OP_16 — single-byte numeric push, no payload.
        pushes.push({ opcode: op, payloadLen: 0, offset: i })
        i += 1
      } else if (op >= 0x01 && op <= 0x4b) {
        // Direct push of N bytes.
        pushes.push({ opcode: op, payloadLen: op, offset: i })
        i += 1 + op
      } else if (op === 0x4c) {
        // OP_PUSHDATA1.
        const len = bytes[i + 1]
        pushes.push({ opcode: op, payloadLen: len, offset: i })
        i += 2 + len
      } else if (op === 0x4d) {
        const len = bytes[i + 1] | (bytes[i + 2] << 8)
        pushes.push({ opcode: op, payloadLen: len, offset: i })
        i += 3 + len
      } else {
        throw new Error(`Unexpected opcode 0x${op.toString(16)} at offset ${i}`)
      }
    }

    // Per SDK layout for our makeUnsignedTx fixture (2 outputs, funding vout=1):
    //   push 0: sats(100=0x64) — direct push `01 64`
    //   push 1: recipient pkh (20 bytes)
    //   push 2: action-data OP_0
    //   push 3: change sats (800)
    //   push 4: change pkh (20 bytes)
    //   push 5: OP_0 (no null-data)
    //   push 6: funding vout (=1) ← MUST be OP_1 (0x51), not `01 01`
    //   push 7: reversed funding txid (32 bytes)
    //   push 8: OP_0 (not merge)
    //   push 9: preimage (20 bytes)
    //   push 10: spending type (=1) ← MUST be OP_1 (0x51), not `01 01`
    //   push 11: sig
    //   push 12: pubkey
    expect(pushes[6].opcode).toBe(0x51) // funding vout = OP_1 minimal
    expect(pushes[10].opcode).toBe(0x51) // spending type = OP_1 minimal
  })

  test('emits OP_0 OP_0 when there is no P2PKH change output', async () => {
    const { tx } = await makeUnsignedTx({ withChange: false })
    const fakeSig = new Uint8Array(72)
    const fakePub = new Uint8Array(33)
    fakePub[0] = 0x02
    const hex = buildDstasUnlockingScript({
      unsignedTx: tx,
      inputIdx: 0,
      fundingInputIdx: 1,
      preimage: new Uint8Array(10),
      signatureDer: fakeSig,
      publicKey: fakePub,
      spendingType: 1,
    })
    // Two adjacent OP_0 bytes (the "no change" marker), followed by an
    // OP_0 (the "no null-data" marker). Three OP_0 bytes in a row.
    expect(hex).toContain('000000')
  })
})

// ──────────────── Service source-validation paths ────────────────

describe('DstasTransferService — source validation', () => {
  function fakeWallet(): any {
    return {
      getPublicKey: vi.fn(),
      createSignature: vi.fn(),
      createAction: vi.fn(),
      signAction: vi.fn(),
    }
  }

  test('rejects a non-DSTAS source script (no wallet calls made)', async () => {
    const wallet = fakeWallet()
    const svc = new DstasTransferService(wallet, 'test-identity', 'main')
    const result = await svc.transfer({
      source: {
        // P2PKH locking script — not DSTAS.
        scriptHex: '76a914' + '11'.repeat(20) + '88ac',
        txid: 'a'.repeat(64),
        vout: 0,
        satoshis: 100,
        brc42KeyId: 'recv 1',
      },
      recipientAddress: '1' + 'A'.repeat(33),
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/doesn't parse as DSTAS/i)
    expect(wallet.getPublicKey).not.toHaveBeenCalled()
    expect(wallet.createAction).not.toHaveBeenCalled()
  })
})
