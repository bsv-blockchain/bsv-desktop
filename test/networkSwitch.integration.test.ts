/** Real manager/snapshot/storage coverage for runtime network changes. */
import knex, { type Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrivateKey, Utils } from '@bsv/sdk'
import { KnexMigrations, StorageKnex } from '@bsv/wallet-toolbox'
import { SimpleWalletManager } from '@bsv/wallet-toolbox-client'

const vault = vi.hoisted(() => ({ snapshot: null as string | null, keyHex: null as string | null, mnemonic: null as string | null }))
vi.mock('../src/lib/services/secrets', () => ({
  getSnapshot: () => vault.snapshot,
  setSnapshot: (value: string) => { vault.snapshot = value },
  persistSnapshot: async (value: string) => { vault.snapshot = value },
  getKeyHex: () => vault.keyHex,
  setKeyHex: (value: string) => { vault.keyHex = value },
  getMnemonic: () => vault.mnemonic,
}))
vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('../src/onWalletReady', () => ({ clearWalletForHttpRoute: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))

import { WalletService } from '../src/lib/services/WalletService'
import { PeerPayManager } from '../src/lib/services/PeerPayManager'
import { createServices } from '../src/lib/services/createServices'
import { defaultNetworkSettings, type NetworkSettings, type WalletNetwork } from '../src/lib/networkConfig'
import { deriveMnemonicWallet } from '../src/lib/utils/mnemonicRecovery'
import { _test_resetHttpBridgeSessions, isHttpBridgePaused } from '../src/lib/services/httpBridgeSession'

async function canUseSqlite(): Promise<boolean> {
  const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
  try { await db.raw('SELECT 1'); return true }
  catch { return false }
  finally { await db.destroy() }
}
const sqliteAvailable = await canUseSqlite()

const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const databases: Knex[] = []
const liveWallets: WalletService[] = []
let stores: Map<WalletNetwork, StorageKnex>
let started: Array<{ chain: WalletNetwork; settings: NetworkSettings }>
let releases: WalletNetwork[]
let transitions: string[]
let targetGate: Promise<void> | undefined

beforeEach(() => {
  vault.snapshot = null
  vault.keyHex = null
  vault.mnemonic = null
  stores = new Map()
  started = []
  releases = []
  transitions = []
  targetGate = undefined
  _test_resetHttpBridgeSessions()
  // All wallet construction and storage calls are real. Keep this regression
  // independent of external Message Box/overlay availability and live funds.
  vi.spyOn(PeerPayManager.prototype, 'createClient').mockResolvedValue(undefined)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Live network access is forbidden in this test') }))
  vi.stubGlobal('CustomEvent', class { constructor(public type: string, public options?: unknown) {} })
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    electronAPI: {
      bootConfig: { set: vi.fn(async () => {}) },
      walletData: { call: vi.fn(async (action: string) => {
        if (action === 'binding') return undefined
        if (action === 'cancel') return undefined
        throw new Error(`Unexpected wallet data action: ${action}`)
      }) },
      storage: {
        initializeServices: vi.fn(async (identity: string, chain: WalletNetwork, settings: NetworkSettings) => {
          transitions.push(`open:${chain}`)
          started.push({ chain, settings })
          if (chain === 'test' && targetGate) await targetGate
          if (!stores.has(chain)) {
            const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
            databases.push(db)
            const providerIdentity = new PrivateKey(chain === 'main' ? 2 : chain === 'test' ? 3 : 4).toPublicKey().toString()
            await db.migrate.latest({ migrationSource: new KnexMigrations(chain, `Network test ${chain}`, providerIdentity, 10000) })
            const storage = new StorageKnex({ knex: db, chain, feeModel: { model: 'sat/kb', value: 100 }, commissionSatoshis: 0 })
            await storage.makeAvailable()
            stores.set(chain, storage)
          }
          stores.get(chain)!.setServices(createServices(chain, identity, settings))
          return { success: true }
        }),
        makeAvailable: vi.fn(async (_identity: string, chain: WalletNetwork) => ({ success: true, settings: await stores.get(chain)!.makeAvailable() })),
        callMethod: vi.fn(async (_identity: string, chain: WalletNetwork, method: string, args: any[]) => {
          const storage = stores.get(chain)!
          try { return { success: true, result: await (storage as any)[method](...args) } }
          catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } }
        }),
        // Keep in-memory databases alive to model durable per-chain files;
        // the actual session fences and SimpleWalletManager.destroy still run.
        releaseNetwork: vi.fn(async (_identity: string, chain: WalletNetwork) => {
          transitions.push(`release:${chain}`)
          releases.push(chain)
          return { success: true }
        }),
      },
    },
  })
})

afterEach(async () => {
  for (const service of liveWallets.splice(0)) {
    await service.walletData?.close().catch(() => {})
    service.managers.walletManager?.destroy()
  }
  await Promise.all(databases.splice(0).map(db => db.destroy()))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function returningWallet(loginType: 'direct-key' | 'mnemonic'): Promise<WalletService> {
  vault.mnemonic = loginType === 'mnemonic' ? phrase : null
  const key = loginType === 'mnemonic' ? deriveMnemonicWallet(phrase).keyHex : new PrivateKey(1).toHex()
  vault.keyHex = key
  const snapshotManager = new SimpleWalletManager('admin.com', async () => { throw new Error('Snapshot seed must not construct a wallet') })
  await snapshotManager.providePrimaryKey(Utils.toArray(key, 'hex'))
  const seed = new WalletService() as any
  seed._loginType = loginType
  seed._managers = { walletManager: snapshotManager }
  vault.snapshot = seed.saveEnhancedSnapshot()

  const service = new WalletService()
  liveWallets.push(service)
  service.restoreConfigFromSnapshot()
  await service.initialize()
  expect(service.lifecycle, service.startupError).toBe('ready')
  expect(service.managers.walletManager).toBeInstanceOf(SimpleWalletManager)
  return service
}

describe.skipIf(!sqliteAvailable)('runtime network changes with real wallet-toolbox managers and SQLite', () => {
  it.each(['direct-key', 'mnemonic'] as const)('keeps %s identity and saved services through main → test → ttn and restart', async loginType => {
    const service = await returningWallet(loginType)
    const identity = (await service.wallet!.getPublicKey({ identityKey: true })).publicKey
    // RecoveryKeyHandler re-registers its callback when managers change.
    // This must not start a second initialize during transition teardown.
    service.on('stateChanged', snapshot => {
      if (snapshot.lifecycle === 'configured') service.setRecoveryKeySaver(async () => true)
    })

    let openTarget!: () => void
    targetGate = new Promise<void>(resolve => { openTarget = resolve })
    let finished = false
    const switching = service.applyNetworkSettings('test', defaultNetworkSettings('test')).finally(() => { finished = true })
    // Attach the failure handler immediately, so the pre-fix race reports an
    // assertion failure without leaving an unhandled rejection or open gate.
    void switching.catch(() => {})
    try {
      await vi.waitFor(() => expect(started.some(entry => entry.chain === 'test')).toBe(true))
      expect(finished).toBe(false)
      expect(isHttpBridgePaused()).toBe(true)
      expect(releases).toContain('main')
      expect(transitions.indexOf('release:main')).toBeLessThan(transitions.indexOf('open:test'))
    } finally {
      openTarget()
      await switching.catch(() => {})
    }
    await switching
    expect(service.selectedNetwork).toBe('test')
    expect(service.lifecycle, service.startupError).toBe('ready')
    expect((await service.wallet!.getPublicKey({ identityKey: true })).publicKey).toBe(identity)
    expect(isHttpBridgePaused()).toBe(false)

    await service.applyNetworkSettings('ttn', defaultNetworkSettings('ttn'))
    expect(service.lifecycle, service.startupError).toBe('ready')
    expect(service.selectedNetwork).toBe('ttn')
    expect((await service.wallet!.getPublicKey({ identityKey: true })).publicKey).toBe(identity)

    const custom = { ...defaultNetworkSettings('ttn'), arcadeUrl: 'https://arcade.example.com', chaintracksUrl: 'https://chaintracks.example.com', messageBoxUrl: 'https://messagebox.example.com' }
    await service.applyNetworkSettings('ttn', custom)
    expect(started.at(-1)).toEqual({ chain: 'ttn', settings: custom })
    await service.walletData!.close()
    service.managers.walletManager.destroy()
    const restored = new WalletService()
    liveWallets.push(restored)
    restored.restoreConfigFromSnapshot()
    await restored.initialize()
    expect(restored.lifecycle, restored.startupError).toBe('ready')
    expect(restored.selectedNetwork).toBe('ttn')
    expect(restored.getSnapshot().networkSettings.ttn).toEqual(custom)
    expect(started.at(-1)).toEqual({ chain: 'ttn', settings: custom })
    expect((await restored.wallet!.getPublicKey({ identityKey: true })).publicKey).toBe(identity)
    expect([...stores.keys()]).toEqual(['main', 'test', 'ttn'])
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
