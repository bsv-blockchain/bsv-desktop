import { describe, it, expect, beforeEach, vi } from 'vitest'

const backing = new Map<string, string>()
const mockGetAll = vi.fn(async () => Object.fromEntries(backing))
const mockSet = vi.fn(async (name: string, value: string) => { backing.set(name, value) })
const mockDelete = vi.fn(async (name: string) => { backing.delete(name) })
const mockVaultStatus = vi.fn(async () => ({
  locked: false,
  hasVault: true,
  methods: ['passphrase'] as Array<'se' | 'passphrase'>,
  biometricsAvailable: false,
  needsMigration: false,
}))

const localStore = new Map<string, string>()
;(globalThis as any).window = {
  electronAPI: {
    secrets: { getAll: mockGetAll, set: mockSet, delete: mockDelete },
    vault: {
      status: mockVaultStatus,
      unlockWithPassphrase: vi.fn(),
      unlockWithBiometrics: vi.fn(),
      enroll: vi.fn(),
      lock: vi.fn(),
      destroy: vi.fn(async () => { backing.clear() }),
    },
    bootConfig: { get: vi.fn(), set: vi.fn() },
  },
}
;(globalThis as any).localStorage = {
  getItem: (k: string) => (localStore.has(k) ? localStore.get(k)! : null),
  setItem: (k: string, v: string) => { localStore.set(k, v) },
  removeItem: (k: string) => { localStore.delete(k) },
}

let secrets: typeof import('../src/lib/services/secrets')

describe('renderer secrets facade', () => {
  beforeEach(async () => {
    backing.clear(); localStore.clear()
    mockGetAll.mockClear(); mockSet.mockClear(); mockDelete.mockClear()
    vi.resetModules()
    secrets = await import('../src/lib/services/secrets')
    secrets._reset()
  })

  it('hydrates from the main store into the sync cache', async () => {
    backing.set('snap', 'S'); backing.set('primaryKeyHex', 'K')
    await secrets.hydrate()
    expect(secrets.getSnapshot()).toBe('S')
    expect(secrets.getKeyHex()).toBe('K')
    expect(secrets.getMnemonic()).toBeNull()
  })

  it('migrates legacy localStorage values into the cache and clears them', async () => {
    // Legacy localStorage is loaded into the cache; durable vault write happens on enroll.
    localStore.set('snap', 'legacy-snap')
    localStore.set('mnemonic12', 'legacy-mn')
    await secrets.hydrate()
    expect(secrets.getSnapshot()).toBe('legacy-snap')
    expect(secrets.getMnemonic()).toBe('legacy-mn')
    expect(localStore.has('snap')).toBe(false)
    expect(localStore.has('mnemonic12')).toBe(false)
  })

  it('prefers the main store over legacy localStorage', async () => {
    backing.set('snap', 'from-store')
    localStore.set('snap', 'from-legacy')
    await secrets.hydrate()
    expect(secrets.getSnapshot()).toBe('from-store')
    expect(localStore.get('snap')).toBe('from-legacy') // not migrated/cleared
  })

  it('setSnapshot updates cache synchronously and persists async', async () => {
    await secrets.hydrate()
    secrets.setSnapshot('new-snap')
    expect(secrets.getSnapshot()).toBe('new-snap')
    await Promise.resolve()
    expect(mockSet).toHaveBeenCalledWith('snap', 'new-snap')
  })

  it('clearSnapshot removes from cache and store', async () => {
    backing.set('snap', 'S')
    await secrets.hydrate()
    secrets.clearSnapshot()
    expect(secrets.getSnapshot()).toBeNull()
    await Promise.resolve()
    expect(mockDelete).toHaveBeenCalledWith('snap')
  })
})
