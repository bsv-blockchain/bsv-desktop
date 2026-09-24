import fs from 'node:fs'
import path from 'node:path'
import * as crypto from 'node:crypto'
import { deriveArchiveKey } from './argon2.js'
import { SQLiteDatabase } from './sqlite.js'
import { ArchiveStreamParser } from './streamParser.js'
import { decodeArchiveStream, encodeArchiveStream, type ArchiveCrypto } from './streamCrypto.js'
import { canonicalStageBytes, initializeArchiveStage, storeArchiveEvents, validateArchiveStage } from './staging.js'
import { captureSqliteArchive, restoreStageDatabase } from './sqliteArchive.js'
import { checkArchiveSize, checkCancelled, PortabilityError, type ArchiveSummary } from './schema.js'

export interface ArchiveJob {
  id: string
  createdAt: string
  fileName: string
  state: 'preparing' | 'ready' | 'restored' | 'merging' | 'merged' | 'activating' | 'active' | 'interrupted'
  format?: 'brc38' | 'brc39'
  digest?: string
  summary?: ArchiveSummary
  recoveryId?: string
  beforeId?: string
  beforeDigest?: string
  mergeId?: string
  mergeDigest?: string
  mergeExportedAt?: string
  target?: string
  error?: string
}
export type Report = (message: string) => void
export const newArchiveId = () => crypto.randomBytes(16).toString('hex')
const safeId = (id: string) => { if (!/^[a-f0-9]{32}$/.test(id)) throw new PortabilityError('storage'); return id }
function writeAll(fd: number, bytes: Uint8Array): void {
  let offset = 0
  while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes, offset, bytes.length - offset)
    if (!count) throw new PortabilityError('storage', 'file write incomplete')
    offset += count
  }
}
export const archiveCrypto: ArchiveCrypto = {
  randomBytes: length => crypto.randomBytes(length),
  deriveKey: deriveArchiveKey,
  cipher: (key, nonce, decrypt) => {
    const cipher = decrypt ? crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 }) : crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 })
    return { update: bytes => cipher.update(bytes), final: () => cipher.final(), getAuthTag: () => (cipher as crypto.CipherGCM).getAuthTag(), setAuthTag: tag => { (cipher as crypto.DecipherGCM).setAuthTag(tag) } }
  }
}
export async function archiveDigest(db: SQLiteDatabase, signal?: AbortSignal): Promise<string> {
  const hash = crypto.createHash('sha256')
  for await (const bytes of canonicalStageBytes(db, signal)) { hash.update(bytes); bytes.fill(0) }
  return hash.digest('hex')
}

/** Files and paths never come from an application URL or a renderer-supplied
 * destination. Native dialogs choose imports/exports; opaque IDs address
 * app-private recovery copies, including after the user moves their home. */
export class WalletArchiveRepository {
  private readonly journal: SQLiteDatabase
  private controller?: AbortController
  private completed?: Promise<void>
  private closed = false
  constructor(readonly directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    fs.chmodSync(directory, 0o700)
    this.journal = new SQLiteDatabase(path.join(directory, 'journal.db'))
  }
  async ready(): Promise<void> { await this.journal.execAsync('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY NOT NULL,json TEXT NOT NULL)') }
  databasePath(id: string): string { return path.join(this.directory, `${safeId(id)}.db`) }
  originalPath(id: string): string { return path.join(this.directory, `${safeId(id)}.original`) }
  async save(job: ArchiveJob): Promise<ArchiveJob> {
    safeId(job.id)
    await this.journal.runAsync('INSERT OR REPLACE INTO jobs(id,json) VALUES (?,?)', job.id, JSON.stringify(job)); return job
  }
  async get(id: string): Promise<ArchiveJob> {
    const row = await this.journal.getFirstAsync<{ json: string }>('SELECT json FROM jobs WHERE id=?', safeId(id))
    if (!row) throw new PortabilityError('storage')
    return JSON.parse(row.json)
  }
  async list(): Promise<ArchiveJob[]> {
    return (await this.journal.getAllAsync<{ json: string }>('SELECT json FROM jobs')).map(row => JSON.parse(row.json)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  cancel(): void { this.controller?.abort() }
  async run<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed || this.controller) throw new PortabilityError('busy')
    const controller = new AbortController(); this.controller = controller
    let complete!: () => void
    this.completed = new Promise<void>(resolve => { complete = resolve })
    try { return await action(controller.signal) } finally { this.controller = undefined; complete() }
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true; this.cancel(); await this.completed
    await this.journal.closeAsync()
  }
  async import(file: string, password: string, report: Report, displayName?: string): Promise<ArchiveJob> {
    return await this.run(async signal => {
      const original = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
      const id = newArchiveId()
      let db: SQLiteDatabase | undefined
      let job: ArchiveJob = { id, createdAt: new Date().toISOString(), fileName: path.basename(displayName ?? file), state: 'preparing' }
      try {
        const info = fs.fstatSync(original)
        if (!info.isFile()) throw new PortabilityError('invalid')
        checkArchiveSize(info.size)
        await this.save(job)
        const target = fs.openSync(this.originalPath(id), 'wx', 0o600)
        try {
          report('Retaining the original file…')
          const buffer = Buffer.alloc(256 * 1024)
          for (let offset = 0; offset < info.size;) {
            checkCancelled(signal)
            const count = fs.readSync(original, buffer, 0, Math.min(buffer.length, info.size - offset), offset)
            if (!count) throw new PortabilityError('invalid', 'file copy incomplete')
            writeAll(target, buffer.subarray(0, count)); offset += count
            await new Promise<void>(resolve => setImmediate(resolve))
          }
          fs.fsyncSync(target)
        } finally { fs.closeSync(target) }
        db = new SQLiteDatabase(this.databasePath(id))
        await initializeArchiveStage(db)
        const parser = new ArchiveStreamParser(), input = fs.openSync(this.originalPath(id), 'r')
        let read = 0, format: 'brc38' | 'brc39'
        try {
          format = await decodeArchiveStream({ size: info.size, read: (offset, count) => { const bytes = Buffer.alloc(count); return bytes.subarray(0, fs.readSync(input, bytes, 0, count, offset)) } }, password, archiveCrypto, async bytes => {
            await storeArchiveEvents(db!, parser.write(bytes)); read += bytes.length
            report(`Validating ${Math.floor(read / 1024 / 1024)} MiB…`)
          }, signal)
          await storeArchiveEvents(db, parser.end())
        } finally { fs.closeSync(input) }
        const summary = await validateArchiveStage(db, signal), digest = await archiveDigest(db, signal)
        checkCancelled(signal)
        return await this.save({ ...job, state: 'ready', summary, digest, format })
      } catch (error) {
        await this.save({ ...job, state: 'interrupted', error: error instanceof PortabilityError ? error.message : 'The file could not be saved completely. Earlier copies are retained.' })
        throw error
      } finally { fs.closeSync(original); await db?.closeAsync() }
    })
  }
  async verified<T>(id: string, action: (stage: SQLiteDatabase, job: ArchiveJob) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const job = await this.get(id)
    if (!job.summary || !job.digest || ['preparing', 'interrupted'].includes(job.state)) throw new PortabilityError('storage', 'unverified recovery copy')
    const db = new SQLiteDatabase(this.databasePath(id), true)
    try {
      await validateArchiveStage(db, signal)
      if (await archiveDigest(db, signal) !== job.digest) throw new PortabilityError('storage', 'recovery copy changed')
      return await action(db, job)
    } finally { await db.closeAsync() }
  }
  async materialize(stage: SQLiteDatabase, report: Report, signal?: AbortSignal): Promise<string> {
    const id = newArchiveId(), db = new SQLiteDatabase(this.databasePath(id))
    try { await restoreStageDatabase(stage, db, crypto.randomBytes(32).toString('hex'), report, signal); await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE)'); return id }
    finally { await db.closeAsync() }
  }
  async restore(id: string, report: Report): Promise<ArchiveJob> {
    return await this.run(signal => this.verified(id, async (stage, job) => {
      if (['merging', 'activating'].includes(job.state)) throw new PortabilityError('busy')
      const recoveryId = await this.materialize(stage, report, signal)
      return await this.save({ ...job, state: 'restored', recoveryId })
    }, signal))
  }
  async snapshot(filename: string, identity: string, report: Report, signal?: AbortSignal, exportedAt?: string): Promise<{ id: string; digest: string }> {
    const source = new SQLiteDatabase(filename, true), id = newArchiveId(), stage = new SQLiteDatabase(this.databasePath(id))
    try {
      await captureSqliteArchive(source, stage, identity, report, signal, exportedAt)
      return { id, digest: await archiveDigest(stage, signal) }
    } finally { await source.closeAsync(); await stage.closeAsync() }
  }
  async exportStage(id: string, password: string, destination: string, report: Report, signal?: AbortSignal): Promise<void> {
    const db = new SQLiteDatabase(this.databasePath(id), true)
    const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${newArchiveId()}.partial`)
    let output: number | undefined
    try {
      await validateArchiveStage(db, signal)
      output = fs.openSync(temporary, 'wx', 0o600)
      report('Encrypting wallet data…')
      await encodeArchiveStream(canonicalStageBytes(db, signal), password, archiveCrypto, async bytes => { writeAll(output!, bytes); await new Promise<void>(resolve => setImmediate(resolve)) }, signal)
      fs.fsyncSync(output); fs.closeSync(output); output = undefined
      checkCancelled(signal)
      fs.renameSync(temporary, destination)
      report('Encrypted wallet data saved.')
    } finally {
      if (output !== undefined) fs.closeSync(output)
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
      await db.closeAsync()
    }
  }
  async exportImport(id: string, password: string, destination: string, report: Report): Promise<void> {
    await this.run(signal => this.verified(id, async () => { await this.exportStage(id, password, destination, report, signal) }, signal))
  }
}
