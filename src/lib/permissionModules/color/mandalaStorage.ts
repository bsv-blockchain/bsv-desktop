/**
 * Renderer side of the Mandala host store (design §9 B7): a `MandalaStorage`
 * for one identity and chain over the main-process store
 * (electron/colorStore.ts, `mandala-store:*`). It holds the host ledger
 * (`createHostLedger`) and the @bsv/mandala journals. The main process is the
 * single writer and keeps every key under `mandala.`; nothing here is reachable
 * over BRC-100, so no app can write what the issuer-v1 handler credits from.
 */

import type { MandalaStorage } from '@bsv/mandala'
import type { WalletNetwork } from '../../networkConfig'
import type { ColorStoreBridge } from './store'

const IDENTITY_RE = /^0[23][0-9a-f]{64}$/
const CHAINS: readonly string[] = ['main', 'test', 'ttn', 'tstn']

/** Binds the main-process Mandala store to one namespace; a wrong namespace fails here. */
export function createIpcMandalaStorage (
  identityKey: string,
  chain: WalletNetwork,
  api?: ColorStoreBridge
): MandalaStorage {
  if (typeof identityKey !== 'string' || !IDENTITY_RE.test(identityKey)) {
    throw new Error('Invalid Mandala store identity')
  }
  if (!CHAINS.includes(chain)) {
    throw new Error('Invalid Mandala store chain')
  }
  const bridge = api ?? (globalThis as { window?: Window }).window?.electronAPI?.mandalaStore
  if (!bridge) {
    throw new Error('Mandala store bridge is unavailable')
  }
  return {
    getItem: async key => (await bridge.get(identityKey, chain, key)) ?? null,
    setItem: async (key, value) => { await bridge.set(identityKey, chain, key, value) },
    removeItem: async key => { await bridge.delete(identityKey, chain, key) },
    keys: async prefix => await bridge.keys(identityKey, chain, prefix)
  }
}
