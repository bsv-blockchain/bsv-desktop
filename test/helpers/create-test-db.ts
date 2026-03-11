/**
 * Creates an isolated test database matching production config (electron/storage.ts:76-109).
 *
 * Uses temp file via os.tmpdir() + unique name, Knex with better-sqlite3,
 * WAL journal mode, and KnexMigrations from @bsv/wallet-toolbox.
 */

import os from 'os'
import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import { StorageKnex, KnexMigrations } from '@bsv/wallet-toolbox'
import { patchListCertificates } from '../../electron/optimized-queries'

const require = createRequire(import.meta.url)

const TEST_IDENTITY_KEY = '02' + 'ab'.repeat(32) // deterministic 66-char hex pubkey
const TEST_CHAIN: 'main' | 'test' = 'test'

export interface TestDb {
  db: any // Knex instance
  storage: StorageKnex
  dbPath: string
  identityKey: string
  chain: 'main' | 'test'
  userId: number
  cleanup: () => Promise<void>
}

export async function createTestDb(): Promise<TestDb> {
  const dbPath = path.join(
    os.tmpdir(),
    `bsv-perf-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  )

  // Create knex instance using the same pattern as electron/storage-loader.cjs
  const knex = require('knex')
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: dbPath },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn: any, cb: any) => {
        conn.pragma('journal_mode = WAL')
        conn.pragma('cache_size = -64000')
        conn.pragma('temp_store = MEMORY')
        conn.pragma('mmap_size = 268435456')
        cb(null, conn)
      },
    },
  })

  // Run migrations (same as electron/storage.ts:92-100)
  const migrations = new KnexMigrations(
    TEST_CHAIN,
    'BSV Desktop Wallet Test',
    TEST_IDENTITY_KEY,
    10000
  )
  await db.migrate.latest({ migrationSource: migrations })

  // Create StorageKnex instance (same as electron/storage.ts:104-109)
  const storage = new StorageKnex({
    knex: db,
    chain: TEST_CHAIN,
    feeModel: { model: 'sat/kb', value: 100 },
    commissionSatoshis: 0,
  })

  // Replace upstream N+1 listCertificates with batched version
  patchListCertificates(storage)

  // Make storage available (reads settings, sets up internal state)
  await storage.makeAvailable()

  // Create a test user
  const { user } = await storage.findOrInsertUser(TEST_IDENTITY_KEY)

  return {
    db,
    storage,
    dbPath,
    identityKey: TEST_IDENTITY_KEY,
    chain: TEST_CHAIN,
    userId: user.userId,
    async cleanup() {
      await db.destroy()
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          fs.unlinkSync(dbPath + suffix)
        } catch {
          // ignore missing files
        }
      }
    },
  }
}
