/**
 * V5 — StasDiscoveryService orchestrator unit tests.
 *
 * Wires a real BRC-42 key deriver (ProtoWallet) into the discovery service
 * with mocked IndexerClient, StasRegistration, and wallet.getServices(). Real
 * DSTAS scripts are built per scenario so the parser is exercised end-to-end;
 * only the network/storage seams are mocked.
 */

import { describe, test, expect } from 'vitest'
import { ProtoWallet, PrivateKey, Transaction, LockingScript } from '@bsv/sdk'
import {
  buildDstasLockingScriptForOwnerField,
  fromHex,
  Address,
} from 'dxs-bsv-token-sdk/bsv'
import { StasKeyDeriver } from '../../src/lib/services/stas/StasKeyDeriver'
import { StasDiscoveryService } from '../../src/lib/services/stas/StasDiscoveryService'
import {
  TokenProtocolRegistry,
  StasProtocolAdapter,
  DstasProtocolAdapter,
} from '../../src/lib/services/tokens'

function mkDeriver(): StasKeyDeriver {
  const wallet = new ProtoWallet(PrivateKey.fromRandom())
  return new StasKeyDeriver(wallet as any, 'test-identity', 'main')
}

/**
 * Test-only registry — the discovery scan dispatches via `registry.find()`
 * after the multi-protocol refactor. Production wires this in WalletService;
 * tests pass a minimal one with parse-only adapters (no transfer service).
 */
function mkRegistry(): TokenProtocolRegistry {
  const r = new TokenProtocolRegistry()
  // StasProtocolAdapter only needs a transfer service for its `.transfer()`
  // method — `parseOutput` doesn't touch it. Cast `null` through `any`.
  r.register(new StasProtocolAdapter(null as any))
  r.register(new DstasProtocolAdapter())
  return r
}

function makeDstasTxFor(ownerFieldHash160Hex: string) {
  const z20 = new Uint8Array(20)
  const sb: any = buildDstasLockingScriptForOwnerField({
    ownerField: fromHex(ownerFieldHash160Hex),
    tokenIdHex: 'ab'.repeat(20),
    freezable: true,
    confiscatable: true,
    authorityServiceField: z20,
    confiscationAuthorityServiceField: z20,
    frozen: false,
  })
  const tx = new Transaction()
  tx.addOutput({ lockingScript: LockingScript.fromHex(sb.toHex()), satoshis: 100 })
  return { rawTx: tx.toBinary(), txid: tx.id('hex') }
}

function ownerAddress(ownerFieldHash160Hex: string): string {
  return new (Address as any)(fromHex(ownerFieldHash160Hex)).Value as string
}

describe('StasDiscoveryService.scan', () => {
  test('scans the derived gap range and returns empty counts when the indexer finds nothing', async () => {
    const deriver = mkDeriver()
    const indexer: any = {
      // WOC serves DSTAS by owner hash160; these cases exercise the STAS path.
      getDstasUtxosForOwners: async () => [],
      getUtxosForAddresses: async (addrs: string[]) =>
        addrs.map((a) => ({ address: a, utxos: [] })),
    }
    const registration: any = { register: async () => ({ registered: false, txid: 'x', vout: 0 }) }
    const wallet: any = { getServices: () => ({ getRawTx: async () => ({ rawTx: [0] }) }) }
    const svc = new StasDiscoveryService({ deriver, indexer, registration, wallet, registry: mkRegistry(), gapLimit: 5 })

    const result = await svc.scan()
    expect(result.scannedAddresses).toBeGreaterThanOrEqual(5)
    expect(result.candidates).toBe(0)
    expect(result.registered).toBe(0)
    expect(result.ownedAndDstas).toBe(0)
  })

  test('recognises a wallet-owned DSTAS UTXO and forwards it to registration', async () => {
    const deriver = mkDeriver()
    const k3 = await deriver.deriveReceiveKey(3)
    const { rawTx, txid } = makeDstasTxFor(k3.ownerFieldHash160)
    const targetAddress = ownerAddress(k3.ownerFieldHash160)

    const indexer: any = {
      // WOC serves DSTAS by owner hash160; these cases exercise the STAS path.
      getDstasUtxosForOwners: async () => [],
      getUtxosForAddresses: async (addrs: string[]) =>
        addrs.map((a) => ({
          address: a,
          utxos:
            a === targetAddress
              ? [{ txid, vout: 0, value: 100, height: 950000 }]
              : [],
        })),
    }
    const registerCalls: any[] = []
    const registration: any = {
      register: async (args: any) => {
        registerCalls.push(args)
        return { registered: true, txid: args.txid, vout: args.vout }
      },
    }
    const wallet: any = {
      getServices: () => ({
        getRawTx: async (id: string) =>
          id === txid ? { rawTx } : { error: { message: 'not found' } },
      }),
    }
    const svc = new StasDiscoveryService({ deriver, indexer, registration, wallet, registry: mkRegistry(), gapLimit: 5 })

    const result = await svc.scan()
    expect(result.dstas).toBe(1)
    expect(result.ownedAndDstas).toBe(1)
    expect(result.registered).toBe(1)
    expect(result.deferred).toBe(0)
    expect(registerCalls).toHaveLength(1)
    expect(registerCalls[0].brc42KeyId).toBe('recv 3')
    expect(registerCalls[0].ownerFieldHash160).toBe(k3.ownerFieldHash160)
    expect(result.registeredOutpoints[0].txid).toBe(txid)
  })

  test('mempool (height 0) UTXOs still go through registration (Task 4c: chained BEEF handles it)', async () => {
    // Previously the discovery loop deferred height === 0. Now Bitails surfaces
    // mempool STAS and buildChainedAtomicBeef walks input ancestry to a confirmed
    // bump — registration is called regardless of height.
    const deriver = mkDeriver()
    const k1 = await deriver.deriveReceiveKey(1)
    const { rawTx, txid } = makeDstasTxFor(k1.ownerFieldHash160)
    const targetAddress = ownerAddress(k1.ownerFieldHash160)

    const indexer: any = {
      // WOC serves DSTAS by owner hash160; these cases exercise the STAS path.
      getDstasUtxosForOwners: async () => [],
      getUtxosForAddresses: async (addrs: string[]) =>
        addrs.map((a) => ({
          address: a,
          utxos:
            a === targetAddress
              ? [{ txid, vout: 0, value: 100, height: 0 }]
              : [],
        })),
    }
    const registerCalls: any[] = []
    const registration: any = {
      register: async (args: any) => {
        registerCalls.push(args)
        return { registered: true, txid: args.txid, vout: args.vout }
      },
    }
    const wallet: any = {
      getServices: () => ({
        getRawTx: async () => ({ rawTx }),
      }),
    }
    const svc = new StasDiscoveryService({ deriver, indexer, registration, wallet, registry: mkRegistry(), gapLimit: 5 })

    const result = await svc.scan()
    expect(result.dstas).toBe(1)
    expect(result.ownedAndDstas).toBe(1)
    expect(result.deferred).toBe(0)
    expect(result.registered).toBe(1)
    expect(registerCalls).toHaveLength(1)
  })

  test('bootstrap mode: hwm=0 caps the scan at the small bootstrap window', async () => {
    const deriver = mkDeriver()
    let addressesSeen = 0
    const indexer: any = {
      // WOC serves DSTAS by owner hash160; these cases exercise the STAS path.
      getDstasUtxosForOwners: async () => [],
      getUtxosForAddresses: async (addrs: string[]) => {
        addressesSeen = addrs.length
        return addrs.map((a) => ({ address: a, utxos: [] }))
      },
    }
    const registration: any = { register: async () => ({ registered: false }) }
    const wallet: any = { getServices: () => ({ getRawTx: async () => ({ rawTx: [0] }) }) }
    // Caller asks for a large gap, but hwm=0 should cap the actual scan range.
    const svc = new StasDiscoveryService({ deriver, indexer, registration, wallet, registry: mkRegistry(), gapLimit: 100 })
    await svc.scan()
    expect(addressesSeen).toBe(5)
  })

  test('ignores a foreign owner field even when the indexer returns it', async () => {
    const deriver = mkDeriver()
    // Build a tx for a foreign key (a different random root).
    const foreignWallet = new ProtoWallet(PrivateKey.fromRandom())
    const foreignDeriver = new StasKeyDeriver(foreignWallet as any, 'other-identity', 'main')
    const foreign = await foreignDeriver.deriveReceiveKey(1)

    const { rawTx, txid } = makeDstasTxFor(foreign.ownerFieldHash160)
    // The indexer returns it at one of OUR addresses anyway (defensive scenario).
    const ourFirstKey = await deriver.deriveReceiveKey(1)
    const ourAddress = ownerAddress(ourFirstKey.ownerFieldHash160)

    const indexer: any = {
      // WOC serves DSTAS by owner hash160; these cases exercise the STAS path.
      getDstasUtxosForOwners: async () => [],
      getUtxosForAddresses: async (addrs: string[]) =>
        addrs.map((a) => ({
          address: a,
          utxos:
            a === ourAddress
              ? [{ txid, vout: 0, value: 100, height: 950000 }]
              : [],
        })),
    }
    const registerCalls: any[] = []
    const registration: any = {
      register: async (args: any) => {
        registerCalls.push(args)
        return { registered: true, txid: args.txid, vout: args.vout }
      },
    }
    const wallet: any = {
      getServices: () => ({
        getRawTx: async () => ({ rawTx }),
      }),
    }
    const svc = new StasDiscoveryService({ deriver, indexer, registration, wallet, registry: mkRegistry(), gapLimit: 5 })

    const result = await svc.scan()
    // Parses as DSTAS, but the owner field is not in our derived set.
    expect(result.dstas).toBe(1)
    expect(result.ownedAndDstas).toBe(0)
    expect(result.registered).toBe(0)
    expect(registerCalls).toHaveLength(0)
  })
})
