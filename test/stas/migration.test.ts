/**
 * V1 — STAS storage migration.
 *
 * Verifies that the bsv-desktop-owned STAS migration creates its three tables,
 * tracks itself in the isolated `knex_migrations_stas` ledger, and is idempotent.
 * Pure local logic — no chain interaction.
 */

import { describe, test, expect } from 'vitest'
import knex from 'knex'
import { stasMigrationSource } from '../../electron/stas-migrations/index'

// `better-sqlite3` is a native module rebuilt against Electron's Node ABI by
// the project's `postinstall: electron-builder install-app-deps` hook. Plain
// `node` (which Vitest uses by default) then can't load it. These tests still
// pass when better-sqlite3 happens to match the runtime ABI (e.g. you ran
// `npm rebuild better-sqlite3` first — see `npm run test:stas:db`). We skip
// gracefully otherwise so the rest of the suite stays runnable in plain node.
async function canUseBetterSqlite3(): Promise<boolean> {
  try {
    const probe = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    })
    await probe.raw('SELECT 1')
    await probe.destroy()
    return true
  } catch {
    return false
  }
}

const sqliteAvailable = await canUseBetterSqlite3()

const MIGRATOR = { migrationSource: stasMigrationSource, tableName: 'knex_migrations_stas' }

async function freshDb() {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  })
  // Stand-in for wallet-toolbox's `outputs` table (FK target of stas_outputs).
  // Migration 0002's DSTAS backfill joins on lockingScript + userId, so the
  // stand-in must carry them or the whole chain fails at 0002.
  await db.schema.createTable('outputs', (t: any) => {
    t.integer('outputId').primary()
    t.text('lockingScript')
    t.integer('userId')
  })
  return db
}

describe.skipIf(!sqliteAvailable)('STAS migration 0001', () => {
  test('creates the three STAS tables and records the migration', async () => {
    const db = await freshDb()
    await db.migrate.latest(MIGRATOR)

    expect(await db.schema.hasTable('stas_tokens')).toBe(true)
    expect(await db.schema.hasTable('stas_outputs')).toBe(true)
    expect(await db.schema.hasTable('stas_receive_contexts')).toBe(true)

    const ledger = await db('knex_migrations_stas').select('name')
    expect(ledger.map((r: any) => r.name)).toContain('0001_create_stas_tables')

    await db.destroy()
  })

  test('is idempotent — a second run applies nothing new', async () => {
    const db = await freshDb()
    await db.migrate.latest(MIGRATOR)
    const after1 = Number((await db('knex_migrations_stas').count('* as c'))[0].c)
    await db.migrate.latest(MIGRATOR)
    const after2 = Number((await db('knex_migrations_stas').count('* as c'))[0].c)

    // One ledger row per applied migration, unchanged by a repeat run.
    expect(after1).toBeGreaterThan(0)
    expect(after2).toBe(after1)

    await db.destroy()
  })

  test('stas_receive_contexts enforces unique (profile, keyIndex)', async () => {
    const db = await freshDb()
    await db.migrate.latest(MIGRATOR)

    const row = {
      profileIdentityKey: 'p1',
      keyIndex: 1,
      keyId: 'recv 1',
      ownerFieldHash160: '00'.repeat(20),
      derivedPublicKey: '02'.padEnd(66, '0'),
      createdAt: new Date().toISOString(),
    }
    await db('stas_receive_contexts').insert(row)
    await expect(db('stas_receive_contexts').insert(row)).rejects.toThrow()

    await db.destroy()
  })
})

describe.skipIf(!sqliteAvailable)('STAS migration 0004 — token_verifications', () => {
  test('creates the table and StasQueries roundtrips a verdict', async () => {
    const db = await freshDb()
    await db.migrate.latest(MIGRATOR)
    expect(await db.schema.hasTable('token_verifications')).toBe(true)

    const { StasQueries } = await import('../../electron/stas-queries')
    const q = new StasQueries(db)

    const now = new Date().toISOString()
    await q.upsertTokenVerification({
      txid: 'aa', vout: 0, protocol: 'stas', result: 'authentic',
      genesis: 'aa_0', genesisDepth: 0, reason: null, verifiedAt: now,
    })
    // Upsert is keyed on the outpoint — a re-verify overwrites, not duplicates.
    await q.upsertTokenVerification({
      txid: 'aa', vout: 0, protocol: 'stas', result: 'not-authentic',
      genesis: null, genesisDepth: null, reason: 'no-genesis', verifiedAt: now,
    })
    // A different outpoint is a separate row.
    await q.upsertTokenVerification({
      txid: 'bb', vout: 1, protocol: 'bsv-21', result: 'authentic',
      genesis: 'bb_1', genesisDepth: 2, reason: null, verifiedAt: now,
    })

    const rows = await q.listTokenVerifications()
    expect(rows).toHaveLength(2)
    const aa = rows.find((r: any) => r.txid === 'aa')
    expect(aa.result).toBe('not-authentic')
    expect(aa.reason).toBe('no-genesis')
    const bb = rows.find((r: any) => r.txid === 'bb')
    expect(bb.protocol).toBe('bsv-21')
    expect(bb.genesisDepth).toBe(2)

    await db.destroy()
  })
})
