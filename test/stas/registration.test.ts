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

  /**
   * Remote-storage guard: when the IPC query channel IS present but
   * findOutputIdByOutpoint returns nothing (no local outputs row — the
   * remote-storage case), register must report registered:false with a reason,
   * NOT the old silent registered:true. Distinct from the no-IPC unit-test path
   * above, which still reports success.
   */
  function withStasQueryChannel(
    handler: (method: string, args: any[]) => any
  ): () => void {
    const g = globalThis as any
    const had = 'window' in g
    const prev = g.window
    g.window = {
      electronAPI: {
        stas: {
          query: async (_id: string, _chain: string, method: string, args: any[]) => {
            try {
              return { success: true, result: handler(method, args) }
            } catch (e) {
              return { success: false, error: (e as Error).message }
            }
          },
        },
      },
    }
    return () => {
      if (had) g.window = prev
      else delete g.window
    }
  }

  test('threads a caller-supplied symbol/name into customInstructions (DSTAS)', async () => {
    // DSTAS carries no on-chain symbol; a colocated minter supplies it so it
    // renders portably. It must land in the internalized output's metadata.
    const ownerHash = 'cd'.repeat(20)
    const { rawTx, txid } = makeDstasTx(ownerHash)
    const { wallet, calls } = mkWallet(rawTx, txid)

    const reg = new StasRegistration(wallet, 'test-identity', 'main')
    await reg.register({
      txid,
      vout: 0,
      tokenSatoshis: 100,
      ownerFieldHash160: ownerHash,
      brc42KeyId: 'recv 3',
      parsed: {
        ownerFieldHash160: ownerHash,
        tokenId: 'ab'.repeat(20),
        freezeEnabled: false,
        confiscationEnabled: false,
        flagsHex: '00',
        serviceFields: [],
      },
      protocol: { id: 'dstas', basketName: 'dstas-tokens' },
      symbol: 'EXDSTAS6',
      name: 'Example DSTAS 6',
    })

    const ci = JSON.parse(calls[0].args.outputs[0].insertionRemittance.customInstructions)
    expect(ci.kind).toBe('dstas')
    expect(ci.symbol).toBe('EXDSTAS6')
    expect(ci.name).toBe('Example DSTAS 6')
    // and it surfaces as a sym: tag for filtering
    expect(calls[0].args.outputs[0].insertionRemittance.tags).toContain('sym:EXDSTAS6')
  })

  test('reports registered:false when the query channel finds no local output row (remote storage)', async () => {
    const ownerHash = 'cd'.repeat(20)
    const { rawTx, txid } = makeDstasTx(ownerHash)
    const { wallet } = mkWallet(rawTx, txid)

    // Channel is available, but findOutputIdByOutpoint returns undefined — as it
    // does under remote storage, where the local `outputs` table is empty.
    const restore = withStasQueryChannel((method) => {
      if (method === 'findStasOutputByOutpoint') return undefined // not already registered
      if (method === 'findOutputIdByOutpoint') return undefined // no local row
      return undefined
    })
    try {
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
          serviceFields: [],
        },
      })
      expect(result.registered).toBe(false)
      expect(result.reason).toMatch(/remote|local outputs row|Assets page/i)
    } finally {
      restore()
    }
  })

  test('reports registered:true and links satellites when a local output row exists', async () => {
    const ownerHash = 'cd'.repeat(20)
    const { rawTx, txid } = makeDstasTx(ownerHash)
    const { wallet } = mkWallet(rawTx, txid)

    const seen: string[] = []
    const restore = withStasQueryChannel((method) => {
      seen.push(method)
      if (method === 'findStasOutputByOutpoint') return undefined
      if (method === 'findOutputIdByOutpoint') return 4242 // local row exists
      return undefined // upsert/insert/setSpendable are void
    })
    try {
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
          serviceFields: [],
        },
      })
      expect(result.registered).toBe(true)
      expect(result.outputId).toBe(4242)
      expect(seen).toContain('upsertStasToken')
      expect(seen).toContain('insertStasOutput')
      expect(seen).toContain('setOutputSpendable')
    } finally {
      restore()
    }
  })
})
