/**
 * End-to-end coverage for unique local storage provider identities (PR #83).
 *
 * Unlike storageIdentity.test.ts (hand-built minimal schema), these tests run
 * the real wallet-toolbox KnexMigrations, StorageKnex and WalletStorageManager,
 * plus the Electron StorageManager's concurrent initialization path.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import knex, { type Knex } from 'knex'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { KnexMigrations, StorageKnex, WalletStorageManager } from '@bsv/wallet-toolbox'
import { ensureUniqueLocalStorageIdentity } from '../electron/storage-identity'

// better-sqlite3 is rebuilt for Electron's ABI by postinstall; skip when plain
// node cannot load it (see test/stas/migration.test.ts).
async function canUseBetterSqlite3(): Promise<boolean> {
  try {
    const probe = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    await probe.raw('SELECT 1')
    await probe.destroy()
    return true
  } catch {
    return false
  }
}

const sqliteAvailable = await canUseBetterSqlite3()
const chain = 'test' as const
const walletIdentityKey = `02${'ab'.repeat(32)}`

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-storage-identity-'))
const openDbs: Knex[] = []

/** A local database exactly as a pre-fix BSV Desktop created it. */
async function legacyDb(name: string, storageIdentityKey = walletIdentityKey): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: path.join(tmpRoot, `${name}.db`) },
    useNullAsDefault: true
  })
  openDbs.push(db)
  await db.migrate.latest({
    migrationSource: new KnexMigrations(chain, name, storageIdentityKey, 10000)
  })
  return db
}

async function storageFor(db: Knex): Promise<StorageKnex> {
  const storage = new StorageKnex({
    knex: db,
    chain,
    feeModel: { model: 'sat/kb', value: 100 },
    commissionSatoshis: 0
  })
  await storage.makeAvailable()
  return storage
}

afterAll(async () => {
  await Promise.all(openDbs.map(db => db.destroy().catch(() => undefined)))
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe.skipIf(!sqliteAvailable)('local storage identity with real wallet-toolbox storage', () => {
  test('legacy migrations reuse the wallet identity as the provider identity', async () => {
    const db = await legacyDb('legacy-shape')
    expect((await db('settings').first()).storageIdentityKey).toBe(walletIdentityKey)
  })

  test('migrates a legacy database and StorageKnex/users pick up the new identity', async () => {
    const db = await legacyDb('legacy-migrate')
    const before = await storageFor(db)
    const { user } = await before.findOrInsertUser(walletIdentityKey)
    expect(user.activeStorage).toBe(walletIdentityKey)

    const storageIdentityKey = await ensureUniqueLocalStorageIdentity(db, walletIdentityKey)

    expect(storageIdentityKey).toMatch(/^(02|03)[0-9a-f]{64}$/)
    expect(storageIdentityKey).not.toBe(walletIdentityKey)
    const after = await storageFor(db)
    expect(after.getSettings().storageIdentityKey).toBe(storageIdentityKey)
    const reloaded = await after.findOrInsertUser(walletIdentityKey)
    expect(reloaded.isNew).toBe(false)
    expect(reloaded.user.userId).toBe(user.userId)
    expect(reloaded.user.activeStorage).toBe(storageIdentityKey)

    // Idempotent on the next start.
    await expect(ensureUniqueLocalStorageIdentity(db, walletIdentityKey)).resolves.toBe(storageIdentityKey)
  })

  test('two local databases for the same wallet no longer share a provider identity', async () => {
    const deviceA = await legacyDb('device-a')
    const deviceB = await legacyDb('device-b')

    const a = await ensureUniqueLocalStorageIdentity(deviceA, walletIdentityKey)
    const b = await ensureUniqueLocalStorageIdentity(deviceB, walletIdentityKey)

    expect(a).not.toBe(b)
    expect([a, b]).not.toContain(walletIdentityKey)
  })

  test('buildWallet-style setActive resolves a backup still pointing at the legacy identity', async () => {
    // Local-primary wallet whose backup store recorded the legacy local identity as active.
    const localDb = await legacyDb('local-primary')
    const backupDb = await legacyDb('backup', `03${'cd'.repeat(32)}`)
    const legacyLocal = await storageFor(localDb)
    await legacyLocal.findOrInsertUser(walletIdentityKey)
    const backup = await storageFor(backupDb)
    const { user: backupUser } = await backup.findOrInsertUser(walletIdentityKey)
    await backup.setActive({ identityKey: walletIdentityKey, userId: backupUser.userId }, walletIdentityKey)

    const localIdentityKey = await ensureUniqueLocalStorageIdentity(localDb, walletIdentityKey)
    const local = await storageFor(localDb)

    const manager = new WalletStorageManager(walletIdentityKey, local, [backup])
    await manager.makeAvailable()
    expect(manager.getConflictingStores()).toEqual([backup.getSettings().storageIdentityKey])
    expect(manager.isActiveEnabled).toBe(false)

    // WalletService.buildWallet always calls setActive(stores[0]) after adding stores.
    await manager.setActive(localIdentityKey)

    expect(manager.isActiveEnabled).toBe(true)
    expect(manager.getActiveStore()).toBe(localIdentityKey)
    expect((await backup.findOrInsertUser(walletIdentityKey)).user.activeStorage).toBe(localIdentityKey)
  })
})

describe.skipIf(!sqliteAvailable)('StorageManager local identity initialization', () => {
  const home = path.join(tmpRoot, 'home')
  let storageManager: typeof import('../electron/storage').storageManager

  beforeAll(async () => {
    fs.mkdirSync(home, { recursive: true })
    vi.spyOn(os, 'homedir').mockReturnValue(home)
    ;({ storageManager } = await import('../electron/storage'))
  })

  afterEach(async () => {
    await storageManager.cleanup()
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  test('concurrent initializations share one storage and migrate a legacy file once', async () => {
    const legacy = knex({
      client: 'better-sqlite3',
      connection: { filename: path.join(home, '.bsv-desktop', `wallet-${walletIdentityKey}-${chain}.db`) },
      useNullAsDefault: true
    })
    fs.mkdirSync(path.join(home, '.bsv-desktop'), { recursive: true })
    await legacy.migrate.latest({
      migrationSource: new KnexMigrations(chain, 'BSV Desktop Wallet', walletIdentityKey, 10000)
    })
    await legacy.destroy()

    const [first, second] = await Promise.all([
      storageManager.getOrCreateStorage(walletIdentityKey, chain),
      storageManager.getOrCreateStorage(walletIdentityKey, chain)
    ])

    expect(second).toBe(first)
    const settings = await storageManager.makeAvailable(walletIdentityKey, chain)
    expect(settings.storageIdentityKey).toMatch(/^(02|03)[0-9a-f]{64}$/)
    expect(settings.storageIdentityKey).not.toBe(walletIdentityKey)
    expect(await first.knex('settings').count({ n: '*' }).first()).toEqual({ n: 1 })
  })

  test('the generated provider identity is durable across restarts', async () => {
    const identityKey = `03${'ef'.repeat(32)}`
    const initial = await storageManager.makeAvailable(identityKey, chain)
    await storageManager.cleanup()

    const restarted = await storageManager.makeAvailable(identityKey, chain)

    expect(initial.storageIdentityKey).not.toBe(identityKey)
    expect(restarted.storageIdentityKey).toBe(initial.storageIdentityKey)
  })
})
