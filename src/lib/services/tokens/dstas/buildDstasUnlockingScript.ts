/**
 * Build the DSTAS unlocking script for a regular spend (spendingType=1).
 *
 * This is the load-bearing piece of F3 — it mirrors
 * `dxs-bsv-token-sdk/src/transaction/build/input-builder.ts:91-178` byte
 * for byte. The SDK builds the script inside `InputBuilder.sign()`; the
 * helper isn't exported, so we reproduce it here. Any drift between our
 * code and the SDK template would manifest as `evaluateTransactionHex`
 * rejection in tests — which is exactly why the SDK's `AGENTS.md`
 * mandates script-level evaluation as the validation backstop.
 *
 * Script content (in order):
 *
 *   for each output:
 *     if null-data:
 *       push <data after OP_RETURN header>
 *     else:
 *       push <satoshis>  (ScriptNum-encoded)
 *       push <ownerField (20-byte hash160)>
 *       if DSTAS output:
 *         push <actionData token>   ← bytes or sentinel opcode
 *   if no P2PKH change output:
 *     push OP_0 OP_0
 *   if no null-data output:
 *     push OP_0
 *   push <fundingOutpoint.vout>     (ScriptNum)
 *   push <reversedFundingTxId>      (32 bytes)
 *   push OP_0                       (not-merge marker)
 *   push <sighashPreimage>
 *   push <spendingType>             (DSTAS only — 1 byte for spendingType=1)
 *   push <signature + sighashType byte>
 *   push <pubKey>                   (33-byte compressed)
 *
 * The DSTAS-output owner field comes from `LockingScriptReader.Dstas.Owner`
 * (token 0). The P2PKH-change owner field is the hash160 push inside the
 * canonical `76 a9 14 <pkh> 88 ac` shape.
 */

import { fromHex, toHex, ScriptType } from 'dxs-bsv-token-sdk/bsv'
// Same namespace-import escape hatch we use in dstasParser.ts — see the
// long comment there. The leaf-module path is whitelisted in the SDK's
// `exports` field.
import * as LockingScriptReaderModule from 'dxs-bsv-token-sdk/script/read/locking-script-reader'
const { LockingScriptReader } = LockingScriptReaderModule
// We never instantiate bsv-js here — the unlock builder reads
// duck-typed `unsignedTx.outputs[i]` / `unsignedTx.inputs[i]` shapes
// from whatever bsv-js Transaction the caller hands us.

/** SIGHASH_ALL | SIGHASH_FORKID — the SDK's `DefaultSighashType`. */
export const DSTAS_SIGHASH_TYPE = 0x41

export interface DstasUnlockSpec {
  /** Unsigned tx (bsv-js Transaction). */
  unsignedTx: any
  /** Index of the DSTAS input in `unsignedTx.inputs`. */
  inputIdx: number
  /** Index of the BSV funding input — must be exactly one. */
  fundingInputIdx: number
  /** Sighash preimage bytes (already computed via bsv-js). */
  preimage: Uint8Array
  /** ECDSA signature bytes (DER-encoded), without the trailing sighash byte. */
  signatureDer: Uint8Array
  /** Compressed public key bytes (33 bytes). */
  publicKey: Uint8Array
  /** Spending type for DSTAS template — 1 = regular transfer. */
  spendingType: number
}

// ──────────────── byte-encoding primitives ────────────────

/** Concatenate Uint8Arrays. */
function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/**
 * Bitcoin pushdata wrapper. Emits opcode + (length byte | length bytes) +
 * payload. For length 0 emits OP_0 alone.
 */
function pushBytes(payload: Uint8Array): Uint8Array {
  const len = payload.length
  if (len === 0) return new Uint8Array([0x00]) // OP_0
  if (len <= 0x4b) {
    return concatBytes([new Uint8Array([len]), payload])
  }
  if (len <= 0xff) {
    return concatBytes([new Uint8Array([0x4c, len]), payload])
  }
  if (len <= 0xffff) {
    return concatBytes([
      new Uint8Array([0x4d, len & 0xff, (len >> 8) & 0xff]),
      payload,
    ])
  }
  // OP_PUSHDATA4 — never reached for DSTAS witness sizes.
  return concatBytes([
    new Uint8Array([0x4e, len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff]),
    payload,
  ])
}

/**
 * Bitcoin ScriptNum encoding for non-negative integers, matching the
 * SDK's `ScriptBuilder.addNumber` exactly:
 *
 *   0      → OP_0 (single byte 0x00, empty stack push)
 *   1..16  → OP_1..OP_16 (single bytes 0x51..0x60)
 *   17+    → length-prefixed minimal LE magnitude bytes
 *
 * The 1..16 special case is REQUIRED by BSV post-Genesis: the script
 * evaluator enforces minimal push encoding and rejects `01 NN` for
 * NN ∈ {1..16} as "data not minimally encoded". The bug previously
 * surfaced as a DSTAS unlock failure when fundingVout ∈ {1..16} or
 * spendingType=1 was pushed via the data-push form.
 *
 * For values > 0x7f the high bit triggers a sign byte — we append
 * `0x00` to keep the value positive (CScriptNum convention).
 */
function scriptNumPush(n: number | bigint): Uint8Array {
  const value = typeof n === 'bigint' ? n : BigInt(n)
  if (value === 0n) return new Uint8Array([0x00]) // OP_0
  if (value < 0n) throw new Error('scriptNumPush: negative numbers not supported here')
  // OP_1 (0x51) through OP_16 (0x60). Mandatory for minimality.
  if (value <= 16n) return new Uint8Array([0x50 + Number(value)])

  // Minimal little-endian magnitude bytes.
  let v = value
  const bytes: number[] = []
  while (v > 0n) {
    bytes.push(Number(v & 0xffn))
    v >>= 8n
  }
  // If high bit set on the last byte, push an extra 0x00 to keep it positive.
  if (bytes[bytes.length - 1]! & 0x80) bytes.push(0x00)
  return pushBytes(new Uint8Array(bytes))
}

/** Push a single sentinel opcode byte. */
function pushOpcode(op: number): Uint8Array {
  return new Uint8Array([op])
}

const OP_0 = 0x00
const OP_RETURN = 0x6a

// ──────────────── output classification (mirror of input-builder.ts) ────────────────

interface OutputInfo {
  scriptType: 'p2pkh' | 'dstas' | 'nullData' | 'other'
  ownerField?: Uint8Array
  actionDataToken?: { data?: Uint8Array; opCode?: number }
  /** For null-data: the payload bytes AFTER OP_RETURN's pushdata header. */
  nullDataPayload?: Uint8Array
}

function classifyOutput(scriptBytes: Uint8Array): OutputInfo {
  // null-data sniff: OP_RETURN at byte 0, OR OP_FALSE OP_RETURN at bytes 0/1
  if (scriptBytes.length >= 2 && scriptBytes[0] === OP_RETURN) {
    return {
      scriptType: 'nullData',
      // Strip the OP_RETURN byte + its pushdata header. The SDK does
      // `payload = nulldata.subarray(2)` which assumes single-byte
      // pushdata length follows immediately after OP_RETURN; we replicate.
      nullDataPayload: scriptBytes.slice(2),
    }
  }
  if (scriptBytes.length >= 3 && scriptBytes[0] === 0x00 && scriptBytes[1] === OP_RETURN) {
    return { scriptType: 'nullData', nullDataPayload: scriptBytes.slice(3) }
  }

  // P2PKH: 76 a9 14 <20> 88 ac
  if (
    scriptBytes.length === 25 &&
    scriptBytes[0] === 0x76 && scriptBytes[1] === 0xa9 &&
    scriptBytes[2] === 0x14 && scriptBytes[23] === 0x88 &&
    scriptBytes[24] === 0xac
  ) {
    return {
      scriptType: 'p2pkh',
      ownerField: scriptBytes.slice(3, 23),
    }
  }

  // Else try DSTAS via the SDK's reader.
  try {
    const reader: any = LockingScriptReader.read(scriptBytes)
    if (reader && reader.ScriptType === ScriptType.dstas && reader.Dstas?.Owner) {
      const d = reader.Dstas
      return {
        scriptType: 'dstas',
        ownerField: d.Owner,
        actionDataToken: d.ActionDataRaw
          ? { data: d.ActionDataRaw }
          : { opCode: d.ActionDataOpCode },
      }
    }
  } catch {
    /* fall through */
  }
  return { scriptType: 'other' }
}

// ──────────────── main builder ────────────────

export function buildDstasUnlockingScript(spec: DstasUnlockSpec): string {
  const { unsignedTx, fundingInputIdx, preimage, signatureDer, publicKey, spendingType } = spec

  // Re-encode the signature with the sighash type byte appended — same
  // shape `InputBuilder.sign` produces (`derWithSigHashType`).
  const sigWithType = new Uint8Array(signatureDer.length + 1)
  sigWithType.set(signatureDer)
  sigWithType[signatureDer.length] = DSTAS_SIGHASH_TYPE

  const chunks: Uint8Array[] = []
  let hasNote = false
  let hasChangeOutput = false

  // ── per-output encoding ──
  for (let i = 0; i < unsignedTx.outputs.length; i++) {
    const out = unsignedTx.outputs[i]
    const scriptBytes: Uint8Array = new Uint8Array(out.script.toBuffer())
    const info = classifyOutput(scriptBytes)

    if (info.scriptType === 'nullData') {
      // Push the payload bytes after OP_RETURN's pushdata header.
      chunks.push(pushBytes(info.nullDataPayload!))
      hasNote = true
      continue
    }

    if (!info.ownerField) {
      throw new Error(`output ${i}: cannot recover owner field (script type ${info.scriptType})`)
    }

    // Satoshis (ScriptNum-encoded) + ownerField (raw pushdata of the
    // 20-byte hash160).
    chunks.push(scriptNumPush(BigInt(out.satoshis)))
    chunks.push(pushBytes(info.ownerField))

    if (info.scriptType === 'dstas') {
      const t = info.actionDataToken!
      if (t.data) {
        chunks.push(pushBytes(t.data))
      } else if (typeof t.opCode === 'number') {
        chunks.push(pushOpcode(t.opCode))
      } else {
        throw new Error(`output ${i}: DSTAS output missing action-data token`)
      }
    }

    if (info.scriptType === 'p2pkh') {
      hasChangeOutput = true
    }
  }

  if (!hasChangeOutput) {
    chunks.push(pushOpcode(OP_0))
    chunks.push(pushOpcode(OP_0))
  }
  if (!hasNote) {
    chunks.push(pushOpcode(OP_0))
  }

  // ── funding outpoint pointers ──
  const fundingInput = unsignedTx.inputs[fundingInputIdx]
  if (!fundingInput) throw new Error(`funding input idx ${fundingInputIdx} out of range`)
  const fundingVout: number = fundingInput.outputIndex
  // bsv-js stores prevTxId as a Buffer in BIG-endian byte order; the
  // SDK pushes the LITTLE-endian (reversed) hash bytes here. Confirm by
  // examining types: tx.inputs[i].prevTxId is Buffer; bsv-js exposes
  // both endianness via toString('hex') (big) and the raw buffer.
  const prevTxIdBuf: Buffer =
    typeof fundingInput.prevTxId === 'string'
      ? Buffer.from(fundingInput.prevTxId, 'hex')
      : Buffer.from(fundingInput.prevTxId)
  const reversedFundingTxId = new Uint8Array(prevTxIdBuf).reverse()

  chunks.push(scriptNumPush(BigInt(fundingVout)))
  chunks.push(pushBytes(reversedFundingTxId))

  // ── merge marker (not-merge for transfer) ──
  chunks.push(pushOpcode(OP_0))

  // ── sighash preimage ──
  chunks.push(pushBytes(preimage))

  // ── DSTAS spending-type byte ──
  chunks.push(scriptNumPush(BigInt(spendingType)))

  // ── signature + pubkey ──
  chunks.push(pushBytes(sigWithType))
  chunks.push(pushBytes(publicKey))

  return toHex(concatBytes(chunks))
}

// Kept in the import surface for future use (e.g., constructing a
// sourceLockingScript from hex inputs in tests).
void fromHex
