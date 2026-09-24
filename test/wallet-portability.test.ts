import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decryptBRC39, encryptBRC39 } from '@bsv/wallet-toolbox'
import { WalletArchiveRepository } from '../electron/wallet-portability/repository'
import { SQLiteDatabase } from '../electron/wallet-portability/sqlite'
import { portabilityFixture } from './fixtures/wallet-portability'

const directories: string[] = []
const repositories: WalletArchiveRepository[] = []
const setup = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-portability-test-')); directories.push(root)
  const repo = new WalletArchiveRepository(path.join(root, 'private')); await repo.ready()
  repositories.push(repo)
  return { root, repo }
}
afterEach(async () => { for (const repo of repositories.splice(0)) await repo.close(); for (const root of directories.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
const report = () => {}
const password = 'unfunded-fixture-passphrase'

describe('native wallet file round trip', () => {
  it('imports the published codec, restores all categories with embedded NUL text and re-exports independently', async () => {
    const { root, repo } = await setup(), fixture = portabilityFixture()
    const original = path.join(root, 'fixture.brc39')
    fs.writeFileSync(original, Buffer.from(await encryptBRC39(fixture, password)))
    const job = await repo.import(original, password, report)
    expect(job.summary?.totalRecords).toBe(13)
    const restored = await repo.restore(job.id, report)
    expect(restored.state).toBe('restored')
    const db = new SQLiteDatabase(repo.databasePath(restored.recoveryId!), true)
    try {
      expect(await db.getFirstAsync('SELECT description FROM transactions')).toEqual({ description: fixture.tables.transactions[0].description })
      const meta = await db.getFirstAsync('SELECT chain FROM settings')
      expect(meta.chain).toBe('test')
    } finally { await db.closeAsync() }
    const output = path.join(root, 'export.brc39')
    await repo.exportImport(job.id, password, output, report)
    expect(await decryptBRC39(new Uint8Array(fs.readFileSync(output)), password)).toEqual(fixture)
    expect(fs.readFileSync(repo.originalPath(job.id))).toEqual(fs.readFileSync(original))
  })
  it('retains failed originals, rejects corrupt tags and does not offer an unverified restore', async () => {
    const { root, repo } = await setup(), fixture = portabilityFixture()
    const original = path.join(root, 'damaged.brc39')
    const encrypted = Buffer.from(await encryptBRC39(fixture, password)); encrypted[encrypted.length - 1] ^= 1
    fs.writeFileSync(original, encrypted)
    await expect(repo.import(original, password, report)).rejects.toThrow('could not be unlocked')
    const jobs = await repo.list(); expect(jobs).toHaveLength(1); expect(jobs[0].state).toBe('interrupted')
    expect(fs.readFileSync(repo.originalPath(jobs[0].id))).toEqual(encrypted)
    await expect(repo.restore(jobs[0].id, report)).rejects.toThrow('unverified')
  })
  it('rejects recovery ID path traversal and modified verified staging rows', async () => {
    const { root, repo } = await setup(), original = path.join(root, 'fixture.brc38')
    fs.writeFileSync(original, JSON.stringify(portabilityFixture()))
    const job = await repo.import(original, '', report)
    expect(() => repo.originalPath('../elsewhere')).toThrow()
    const db = new SQLiteDatabase(repo.databasePath(job.id), true)
    try { await db.runAsync("UPDATE archive_rows SET json=json_set(json,'$.description','changed') WHERE name='transactions'") } finally { await db.closeAsync() }
    await expect(repo.restore(job.id, report)).rejects.toThrow('recovery copy changed')
  })
})
