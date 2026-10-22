/**
 * Renderer side of the durable color-module store. Structurally the contract
 * §2.1 `ColorModuleStore`, bound to one identity and chain. Storage, atomic
 * writes and validation live in the main process (electron/colorStore.ts);
 * every window shares that single writer over IPC.
 */

import type { WalletNetwork } from '../../networkConfig'

export type ColorModuleStoreLike = {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix: string): Promise<string[]>
}

export type ColorStoreBridge = {
  get(identityKey: string, chain: WalletNetwork, key: string): Promise<string | undefined>
  set(identityKey: string, chain: WalletNetwork, key: string, value: string): Promise<void>
  delete(identityKey: string, chain: WalletNetwork, key: string): Promise<void>
  keys(identityKey: string, chain: WalletNetwork, prefix: string): Promise<string[]>
}

const IDENTITY_RE = /^0[23][0-9a-f]{64}$/
const CHAINS: readonly string[] = ['main', 'test', 'ttn', 'tstn']

/**
 * Binds the main-process store to one namespace. The identity and chain are
 * checked here as well, so a wrong namespace fails when the module is built
 * rather than on its first read.
 */
export function createIpcColorModuleStore(
  identityKey: string,
  chain: WalletNetwork,
  api?: ColorStoreBridge
): ColorModuleStoreLike {
  if (typeof identityKey !== 'string' || !IDENTITY_RE.test(identityKey)) {
    throw new Error('Invalid color store identity')
  }
  if (!CHAINS.includes(chain)) {
    throw new Error('Invalid color store chain')
  }
  const bridge = api ?? (globalThis as { window?: Window }).window?.electronAPI?.colorStore
  if (!bridge) {
    throw new Error('Color store bridge is unavailable')
  }
  return {
    get: key => bridge.get(identityKey, chain, key),
    set: (key, value) => bridge.set(identityKey, chain, key, value),
    delete: key => bridge.delete(identityKey, chain, key),
    keys: prefix => bridge.keys(identityKey, chain, prefix)
  }
}
