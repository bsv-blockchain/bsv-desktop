/**
 * Renderer-side synchronous facade over the encrypted main-process secret
 * store (electron/secretStore.ts). Holds an in-memory cache hydrated once at
 * startup so existing synchronous call sites keep working; writes update the
 * cache immediately and persist asynchronously over IPC.
 */
const SNAP = 'snap'
const KEY = 'primaryKeyHex'
const MN = 'mnemonic12'
const NAMES = [SNAP, KEY, MN] as const

const cache = new Map<string, string>()
let hydrated = false

export async function hydrate(): Promise<void> {
  if (hydrated) return
  const stored = await window.electronAPI.secrets.getAll()
  for (const name of NAMES) {
    if (stored[name] != null) {
      cache.set(name, stored[name])
      continue
    }
    // One-time migration of legacy plaintext localStorage values.
    const legacy = localStorage.getItem(name)
    if (legacy != null) {
      cache.set(name, legacy)
      try {
        await window.electronAPI.secrets.set(name, legacy)
        localStorage.removeItem(name)
      } catch (err) {
        console.error(`[secrets] migration of ${name} failed:`, err)
      }
    }
  }
  hydrated = true
}

function get(name: string): string | null {
  return cache.has(name) ? cache.get(name)! : null
}

function set(name: string, value: string): void {
  cache.set(name, value)
  void window.electronAPI.secrets
    .set(name, value)
    .catch((err) => console.error(`[secrets] persist ${name} failed:`, err))
}

function clear(name: string): void {
  cache.delete(name)
  void window.electronAPI.secrets
    .delete(name)
    .catch((err) => console.error(`[secrets] delete ${name} failed:`, err))
}

export const getSnapshot = (): string | null => get(SNAP)
export const setSnapshot = (v: string): void => set(SNAP, v)
export const clearSnapshot = (): void => clear(SNAP)

export const getKeyHex = (): string | null => get(KEY)
export const setKeyHex = (v: string): void => set(KEY, v)
export const clearKeyHex = (): void => clear(KEY)

export const getMnemonic = (): string | null => get(MN)
export const setMnemonic = (v: string): void => set(MN, v)
export const clearMnemonic = (): void => clear(MN)

/** Test-only: reset module state. */
export function _reset(): void {
  cache.clear()
  hydrated = false
}
