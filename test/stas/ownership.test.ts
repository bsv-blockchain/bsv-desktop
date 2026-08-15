/**
 * V3 — STAS ownership recognition (Task 3 acceptance criterion).
 *
 * Builds real DSTAS locking scripts with dxs-bsv-token-sdk and checks that
 * StasOwnershipService recognises a wallet-derived owner field, rejects a
 * foreign one, and rejects a non-DSTAS script. Pure local logic — no chain.
 *
 * No high-water mark is persisted in this environment, so getHighWaterMark()
 * returns 0 and the scan covers `recv 1..gapLimit` (100) — the test key at
 * index 3 is well within range.
 */

import { describe, test, expect } from 'vitest'
import { ProtoWallet, PrivateKey } from '@bsv/sdk'
import { buildDstasLockingScriptForOwnerField, fromHex } from 'dxs-bsv-token-sdk/bsv'
import { StasKeyDeriver } from '../../src/lib/services/stas/StasKeyDeriver'
import { StasOwnershipService } from '../../src/lib/services/stas/StasOwnershipService'
import { parseDstasLockingScript } from '../../src/lib/services/stas/dstasParser'

/** Build a freeze+confiscation-enabled DSTAS locking script for an owner field. */
function buildDstas(ownerFieldHash160Hex: string): string {
  const zero20 = new Uint8Array(20)
  const sb: any = buildDstasLockingScriptForOwnerField({
    ownerField: fromHex(ownerFieldHash160Hex),
    tokenIdHex: 'ab'.repeat(20),
    freezable: true,
    confiscatable: true,
    authorityServiceField: zero20,
    confiscationAuthorityServiceField: zero20,
    frozen: false,
  })
  return sb.toHex()
}

function freshWallet() {
  const wallet = new ProtoWallet(PrivateKey.fromRandom())
  const deriver = new StasKeyDeriver(wallet as any, 'test-identity', 'main')
  return { deriver, ownership: new StasOwnershipService(deriver) }
}

describe('StasOwnershipService.isOwnedByWallet', () => {
  test('builder/parser agree on the owner field round-trip', async () => {
    const { deriver } = freshWallet()
    const k = await deriver.deriveReceiveKey(3)
    const parsed = parseDstasLockingScript(buildDstas(k.ownerFieldHash160))
    expect(parsed).not.toBeNull()
    expect(parsed!.ownerFieldHash160).toBe(k.ownerFieldHash160)
  })

  test('recognises a wallet-derived owner field', async () => {
    const { deriver, ownership } = freshWallet()
    const k3 = await deriver.deriveReceiveKey(3)
    const result = await ownership.isOwnedByWallet(buildDstas(k3.ownerFieldHash160))
    expect(result).toEqual({ owned: true, keyIndex: 3 })
  })

  test('rejects a foreign owner field', async () => {
    const { ownership } = freshWallet()
    const result = await ownership.isOwnedByWallet(buildDstas('cd'.repeat(20)))
    expect(result).toEqual({ owned: false })
  })

  test('rejects a non-DSTAS (P2PKH) script', async () => {
    const { ownership } = freshWallet()
    const p2pkh = '76a914' + '00'.repeat(20) + '88ac'
    expect(await ownership.isOwnedByWallet(p2pkh)).toEqual({ owned: false })
  })
})
