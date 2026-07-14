/**
 * V4 — StasRegistration call-shape unit tests.
 *
 * Builds a real DSTAS locking script with `dxs-bsv-token-sdk`, wraps it in a
 * minimal Transaction + single-leaf MerklePath via `@bsv/sdk`, then runs
 * `register` against a stubbed wallet. We never call internalizeAction's real
 * BEEF verifier; the assertion is on the args shape and the AtomicBEEF prefix.
 */

import { describe, test, expect } from 'vitest'
import { Transaction, MerklePath, LockingScript } from '@bsv/sdk'
import {
  buildDstasLockingScriptForOwnerField,
  fromHex,
} from 'dxs-bsv-token-sdk/bsv'
import { StasRegistration } from '../../src/lib/services/stas/StasRegistration'

function makeDstasTx(ownerFieldHash160: string) {
  const zero20 = new Uint8Array(20)
  const sb: any = buildDstasLockingScriptForOwnerField({
    ownerField: fromHex(ownerFieldHash160),
    tokenIdHex: 'ab'.repeat(20),
    freezable: true,
    confiscatable: true,
    authorityServiceField: zero20,
    confiscationAuthorityServiceField: zero20,
    frozen: false,
  })
  const tx = new Transaction()
  tx.addOutput({ lockingScript: LockingScript.fromHex(sb.toHex()), satoshis: 100 })
  const rawTx = tx.toBinary()
  return { rawTx, txid: tx.id('hex') }
}

interface CapturedCall {
  args: any
  originator: any
}

function mkWallet(rawTx: number[], txid: string, opts: { withProof?: boolean } = {}) {
  const calls: CapturedCall[] = []
  const merklePath = new MerklePath(100, [
    [{ offset: 0, hash: txid, txid: true }],
  ])
  const wallet: any = {
    internalizeAction: async (args: any, originator: any) => {
      calls.push({ args, originator })
      return { accepted: true }
    },
    getServices: () => ({
      getRawTx: async () => ({ rawTx }),
      getMerklePath: async () =>
        opts.withProof === false ? {} : { merklePath },
    }),
  }
  return { wallet, calls }
}

describe('StasRegistration.register', () => {
  test('calls internalizeAction with the basket-insertion shape and AtomicBEEF prefix', async () => {
    const ownerHash = 'cd'.repeat(20)
    const { rawTx, txid } = makeDstasTx(ownerHash)
    const { wallet, calls } = mkWallet(rawTx, txid)

    const reg = new StasRegistration(wallet, 'test-identity', 'main')
    const result = await reg.register({
      txid,
      vout: 0,
      tokenSatoshis: 100,
      ownerFieldHash160: ownerHash,
      brc42KeyId: 'recv 3',
      parsed: {
        ownerFieldHash160: ownerHash,
        tokenId: 'ab'.repeat(20),
        freezeEnabled: true,
        confiscationEnabled: true,
        flagsHex: '03',
        serviceFields: ['00'.repeat(20), '00'.repeat(20)],
      },
    })

    expect(result.registered).toBe(true)
    expect(calls).toHaveLength(1)
    const { args, originator } = calls[0]
    expect(originator).toBe('admin.stas-discovery')
    expect(args.description).toBe('STAS discovery')
    expect(args.seekPermission).toBe(false)
    expect(args.outputs).toHaveLength(1)
    expect(args.outputs[0].outputIndex).toBe(0)
    expect(args.outputs[0].protocol).toBe('basket insertion')
    expect(args.outputs[0].insertionRemittance.basket).toBe('stas-tokens')
    // Multi-protocol PR: tags now reflect the actual protocol id rather
    // than the legacy 'dstas' string the original wallet hardcoded for
    // every STAS-family output. With no `protocol` arg supplied, the
    // default protocol is STAS (id: 'stas'). DSTAS rows in the new
    // dstas-tokens basket carry the 'dstas' tag instead.
    expect(args.outputs[0].insertionRemittance.tags).toContain('stas')

    // AtomicBEEF prefix (BRC-95) is 0x01010101 followed by the txid bytes.
    const txBytes = Array.from(args.tx as number[])
    expect(txBytes.slice(0, 4)).toEqual([1, 1, 1, 1])

    // customInstructions JSON shape
    const ci = JSON.parse(args.outputs[0].insertionRemittance.customInstructions)
    expect(ci.tokenId).toBe('ab'.repeat(20))
    expect(ci.brc42KeyId).toBe('recv 3')
    expect(ci.flagsHex).toBe('03')
  })

  test('mempool target (no proof on target) walks back through inputs to a confirmed ancestor', async () => {
    // Mempool target tx with one input; ancestor has the merkle proof.
    const ownerHash = 'cd'.repeat(20)
    const ancestor = makeDstasTx('ee'.repeat(20))
    const targetTx = new Transaction()
    // Reference the ancestor as the input (one input, no script needed for this
    // unit test — the validator never runs because internalizeAction is stubbed).
    targetTx.addInput({
      sourceTransaction: Transaction.fromBinary(ancestor.rawTx),
      sourceOutputIndex: 0,
      unlockingScript: LockingScript.fromHex(''),
      sequence: 0xffffffff,
    })
    targetTx.addOutput({
      lockingScript: LockingScript.fromHex(
        // Tiny push-only script; the test only cares about wiring.
        '00',
      ),
      satoshis: 100,
    })
    const targetRaw = targetTx.toBinary()
    const targetId = targetTx.id('hex')

    const ancestorMp = new MerklePath(100, [
      [{ offset: 0, hash: ancestor.txid, txid: true }],
    ])
    const calls: CapturedCall[] = []
    const wallet: any = {
      internalizeAction: async (args: any, originator: any) => {
        calls.push({ args, originator })
        return { accepted: true }
      },
      getServices: () => ({
        getRawTx: async (id: string) => {
          if (id === targetId) return { rawTx: targetRaw }
          if (id === ancestor.txid) return { rawTx: ancestor.rawTx }
          throw new Error(`unexpected getRawTx for ${id}`)
        },
        getMerklePath: async (id: string) => {
          // Target tx is mempool → no proof. Ancestor is confirmed.
          if (id === ancestor.txid) return { merklePath: ancestorMp }
          return {}
        },
      }),
    }

    const reg = new StasRegistration(wallet, 'test-identity', 'main')
    const result = await reg.register({
      txid: targetId,
      vout: 0,
      tokenSatoshis: 100,
      ownerFieldHash160: ownerHash,
      brc42KeyId: 'recv 1',
      parsed: {
        ownerFieldHash160: ownerHash,
        tokenId: 'ab'.repeat(20),
        freezeEnabled: false,
        confiscationEnabled: false,
        flagsHex: '00',
        serviceFields: [],
      },
    })

    // The chained BEEF was assembled and internalizeAction was called.
    expect(result.registered).toBe(true)
    expect(calls).toHaveLength(1)
    const txBytes = Array.from(calls[0].args.tx as number[])
    expect(txBytes.slice(0, 4)).toEqual([1, 1, 1, 1]) // AtomicBEEF prefix
  })
})
