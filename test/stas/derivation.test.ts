/**
 * V2 — STAS receive-key derivation determinism.
 *
 * A ProtoWallet over a fixed root key exercises only `getPublicKey`, which is
 * all StasKeyDeriver needs. Pure local logic — no chain interaction.
 */

import { describe, test, expect } from 'vitest'
import { ProtoWallet, PrivateKey } from '@bsv/sdk'
import { StasKeyDeriver } from '../../src/lib/services/stas/StasKeyDeriver'

function deriver() {
  const wallet = new ProtoWallet(PrivateKey.fromRandom())
  return new StasKeyDeriver(wallet as any, 'test-identity', 'main')
}

describe('StasKeyDeriver.deriveReceiveKey', () => {
  test('is deterministic — same index yields the same key', async () => {
    const d = deriver()
    const a = await d.deriveReceiveKey(1)
    const b = await d.deriveReceiveKey(1)
    expect(a.publicKey).toBe(b.publicKey)
    expect(a.ownerFieldHash160).toBe(b.ownerFieldHash160)
    expect(a.keyId).toBe('recv 1')
  })

  test('distinct indices yield distinct keys', async () => {
    const d = deriver()
    const k1 = await d.deriveReceiveKey(1)
    const k2 = await d.deriveReceiveKey(2)
    expect(k1.publicKey).not.toBe(k2.publicKey)
    expect(k1.ownerFieldHash160).not.toBe(k2.ownerFieldHash160)
  })

  test('owner field is a 20-byte hash160', async () => {
    const k = await deriver().deriveReceiveKey(7)
    expect(k.ownerFieldHash160).toMatch(/^[0-9a-f]{40}$/)
  })

  test('different roots derive different keys for the same index', async () => {
    const a = await deriver().deriveReceiveKey(1)
    const b = await deriver().deriveReceiveKey(1)
    expect(a.ownerFieldHash160).not.toBe(b.ownerFieldHash160)
  })
})
