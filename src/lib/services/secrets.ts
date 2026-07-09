/**
 * Renderer-side synchronous facade over the main-process vault.
 * Holds an in-memory cache hydrated after vault unlock so existing
 * synchronous call sites keep working; writes update the cache immediately
 * and persist asynchronously over IPC (only while the vault is unlocked).
 */
const SNAP = 'snap'
const KEY = 'primaryKeyHex'
const MN = 'mnemonic12'
const NAMES = [SNAP, KEY, MN] as const

const cache = new Map<string, string>()
let hydrated = false

export type VaultStatus = {
  locked: boolean
  hasVault: boolean
  methods: Array<'se' | 'passphrase'>
  biometricsAvailable: boolean
  needsMigration: boolean
}

function vaultApi() {
  return window.electronAPI.vault
}

export async function vaultStatus(): Promise<VaultStatus> {
  return vaultApi().status()
}

export async function unlockWithPassphrase(passphrase: string) {
  return vaultApi().unlockWithPassphrase(passphrase)
}

export async function unlockWithBiometrics() {
  return vaultApi().unlockWithBiometrics()
}

export async function enrollVault(options: {
  passphrase: string
  enableBiometrics: boolean
  initialSecrets?: Record<string, string>
}) {
  // Prefer explicit initialSecrets; otherwise send whatever is already cached
  // (e.g. snapshot buffered before enroll on first run).
  const initial = options.initialSecrets ?? cacheSnapshot()
  return vaultApi().enroll({ ...options, initialSecrets: initial })
}

export async function destroyVault(): Promise<void> {
  await vaultApi().destroy()
  cache.clear()
  hydrated = false
}

/**
 * Logout path: clear wallet secrets from the vault and lock it, but keep the
 * vault enrollment (passphrase wrap + biometrics). Next entry is unlock, not enroll.
 */
export async function endSession(): Promise<void> {
  await vaultApi().endSession()
  cache.clear()
  hydrated = false
  window.dispatchEvent(new CustomEvent('vault-locked'))
}

export async function lockVault(): Promise<void> {
  await vaultApi().lock()
  cache.clear()
  hydrated = false
  window.dispatchEvent(new CustomEvent('vault-locked'))
}

/** Snapshot of in-memory cache for enroll/migration. */
export function cacheSnapshot(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of NAMES) {
    if (cache.has(name)) out[name] = cache.get(name)!
  }
  return out
}

/**
 * Load secrets into the sync cache after the vault is unlocked (or when there
 * is no vault yet / migration still needs enroll).
 */
export async function hydrate(): Promise<void> {
  if (hydrated) return
  const stored = await window.electronAPI.secrets.getAll()
  for (const name of NAMES) {
    if (stored[name] != null) {
      cache.set(name, stored[name])
      continue
    }
    // One-time migration of legacy plaintext localStorage values into the cache.
    // They are persisted into the vault only after enroll.
    const legacy = localStorage.getItem(name)
    if (legacy != null) {
      cache.set(name, legacy)
      localStorage.removeItem(name)
    }
  }
  hydrated = true
}

/** Re-hydrate after unlock/enroll (resets cache from main). */
export async function rehydrate(): Promise<void> {
  hydrated = false
  cache.clear()
  await hydrate()
}

function get(name: string): string | null {
  return cache.has(name) ? cache.get(name)! : null
}

function set(name: string, value: string): void {
  cache.set(name, value)
  void window.electronAPI.secrets
    .set(name, value)
    .catch((err) => {
      const msg = String(err?.message || err)
      if (msg.includes('VAULT_NEEDS_ENROLL')) {
        window.dispatchEvent(new CustomEvent('vault-needs-enroll'))
        return
      }
      console.error(`[secrets] persist ${name} failed:`, err)
    })
}

function clear(name: string): void {
  cache.delete(name)
  void window.electronAPI.secrets
    .delete(name)
    .catch((err) => {
      const msg = String(err?.message || err)
      if (msg.includes('VAULT_LOCKED') || msg.includes('VAULT_NEEDS_ENROLL')) return
      console.error(`[secrets] delete ${name} failed:`, err)
    })
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

/** Clear in-memory cache (e.g. after vault destroy / logout). */
export function clearCache(): void {
  cache.clear()
  hydrated = false
}

/** Test-only: reset module state. */
export function _reset(): void {
  clearCache()
}
