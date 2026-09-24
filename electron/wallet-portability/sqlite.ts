import fs from 'node:fs'
import { createRequire } from 'node:module'
import { KnexMigrations } from '@bsv/wallet-toolbox'

const require = createRequire(import.meta.url)
const bindings = (values: unknown[]) => values.map(value => value instanceof Uint8Array ? Buffer.from(value) : value)

/** Dedicated connections keep a capture's WAL snapshot independent of the
 * normal wallet and monitor connections. All filenames are chosen by main. */
export class SQLiteDatabase {
  private readonly database: any
  private budget = 0
  constructor(readonly filename: string, existing = false) {
    const Database = require('better-sqlite3')
    this.database = new Database(filename, { fileMustExist: existing })
    fs.chmodSync(filename, 0o600)
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('synchronous = FULL')
    this.database.pragma('busy_timeout = 5000')
  }
  private async yield(): Promise<void> {
    if (++this.budget % 128 === 0) await new Promise<void>(resolve => setImmediate(resolve))
  }
  async execAsync(sql: string): Promise<void> { this.database.exec(sql); await this.yield() }
  async runAsync(sql: string, ...params: unknown[]): Promise<any> {
    const result = this.database.prepare(sql).run(...bindings(params)); await this.yield(); return result
  }
  async getAllAsync<T = any>(sql: string, ...params: unknown[]): Promise<T[]> {
    const result = this.database.prepare(sql).all(...bindings(params)); await this.yield(); return result
  }
  async getFirstAsync<T = any>(sql: string, ...params: unknown[]): Promise<T | null> {
    const result = this.database.prepare(sql).get(...bindings(params)); await this.yield(); return result ?? null
  }
  async *getEachAsync<T = any>(sql: string, ...params: unknown[]): AsyncGenerator<T> {
    for (const row of this.database.prepare(sql).iterate(...bindings(params))) { await this.yield(); yield row }
  }
  async closeAsync(): Promise<void> { this.database.close() }
}

/** Initialize only a brand-new destination with the released Toolbox schema.
 * Its generated settings row is replaced by the validated archive metadata. */
export async function createTables(db: SQLiteDatabase): Promise<void> {
  if (await db.getFirstAsync("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'")) return
  if (await db.getFirstAsync("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) throw new Error('Recovery destination must be empty')
  const knex = require('knex')({ client: 'better-sqlite3', connection: { filename: db.filename }, useNullAsDefault: true })
  try {
    await knex.migrate.latest({ migrationSource: new KnexMigrations('main', 'Wallet data recovery', '0'.repeat(64), 10000) })
    await knex('settings').delete()
  } finally { await knex.destroy() }
}
