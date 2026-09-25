import fs from 'node:fs'
import { WalletStorageAccess } from './access.js'
import { createRequire } from 'node:module'
import { StorageKnex, WalletStorageManager } from '@bsv/wallet-toolbox'
import { SQLiteDatabase } from './sqlite.js'
import { WalletArchiveRepository, archiveDigest, newArchiveId, type ArchiveJob, type Report } from './repository.js'
import { WalletDataBindings, walletStorageKey } from './bindings.js'
import { checkCancelled, PortabilityError, type ArchiveChain } from './schema.js'
import { captureSqliteArchive } from './sqliteArchive.js'

const require = createRequire(import.meta.url)
interface Copy { storage: StorageKnex; identity: string; chain: ArchiveChain; writable: boolean; access: WalletStorageAccess }
interface StorageHost {
  bindings: WalletDataBindings
  getOrCreateStorage(identity: string, chain: ArchiveChain): Promise<StorageKnex>
  quiesce<T>(identity: string, chain: ArchiveChain, action: () => Promise<T>): Promise<T>
  closeForActivation(identity: string, chain: ArchiveChain, commit: () => Promise<void>): Promise<void>
}
/** Opaque handles expose only bounded synchronization pages. No SQL, arbitrary
 * filename, private key or whole-wallet IPC payload is accepted from renderer. */
export class WalletPortabilityService {
  private copies = new Map<string, Copy>()
  private creation = new WalletStorageAccess()
  private closed = false
  constructor(readonly repository: WalletArchiveRepository, readonly host: StorageHost) {}
  private async provider(id: string, chain: ArchiveChain): Promise<StorageKnex> {
    const filename = this.repository.databasePath(id)
    const check = new SQLiteDatabase(filename, true)
    try {
      const settings = await check.getFirstAsync<{ chain: string }>('SELECT chain FROM settings LIMIT 1')
      if (settings?.chain !== chain) throw new PortabilityError('identity')
    } finally { await check.closeAsync() }
    const knex = require('knex')({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true,
      pool: { afterCreate: (db: any, done: any) => { db.pragma('journal_mode = WAL'); db.pragma('synchronous = FULL'); done(null, db) } } })
    const storage = new StorageKnex({ knex, chain, commissionSatoshis: 0, feeModel: { model: 'sat/kb', value: 250 } })
    try { await storage.makeAvailable(); return storage } catch (error) { await storage.destroy(); throw error }
  }
  async createCopy(identity: string, chain: ArchiveChain, activeStore: string): Promise<string> {
    return await this.creation.run(async () => {
    if (this.closed) throw new PortabilityError('busy')
    walletStorageKey(identity, chain)
    if (this.copies.size >= 4 || !/^[a-f0-9]{64}$/.test(activeStore)) throw new PortabilityError('busy')
    const id = newArchiveId(), filename = this.repository.databasePath(id)
    fs.closeSync(fs.openSync(filename, 'wx', 0o600))
    const knex = require('knex')({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true })
    const storage = new StorageKnex({ knex, chain, commissionSatoshis: 0, feeModel: { model: 'sat/kb', value: 250 } })
    try {
      await storage.migrate('Wallet data export copy', newArchiveId() + newArchiveId())
      await storage.makeAvailable()
      const { user } = await storage.findOrInsertUser(identity)
      await storage.setActive({ identityKey: identity, userId: user.userId }, activeStore)
      this.copies.set(id, { storage, identity, chain, writable: true, access: new WalletStorageAccess() }); return id
    } catch (error) { await storage.destroy(); throw error }
    })
  }
  private copy(id: string): Copy {
    const copy = this.copies.get(id)
    if (!copy) throw new PortabilityError('storage', 'copy session ended')
    return copy
  }
  async copyCall(id: string, method: string, args: any[]): Promise<any> {
    const copy = this.copy(id)
    return await copy.access.run(async () => {
    if (!Array.isArray(args) || args.length > 3) throw new PortabilityError('invalid')
    if (method === 'makeAvailable' && args.length === 0) return await copy.storage.makeAvailable()
    if (method === 'getSyncChunk') {
      const request = args[0]
      if (!request || request.identityKey !== copy.identity || !Number.isSafeInteger(request.maxItems) || !Number.isSafeInteger(request.maxRoughSize)) throw new PortabilityError('identity')
      return await copy.storage.getSyncChunk({ ...request, maxItems: Math.min(250, Math.max(1, request.maxItems)), maxRoughSize: Math.min(2 * 1024 * 1024, Math.max(1, request.maxRoughSize)) })
    }
    if (!copy.writable) throw new PortabilityError('storage', 'copy is read-only')
    if (method === 'findOrInsertUser' && args[0] === copy.identity) return await copy.storage.findOrInsertUser(copy.identity)
    if (method === 'findOrInsertSyncStateAuth' && args[0]?.identityKey === copy.identity) return await copy.storage.findOrInsertSyncStateAuth(args[0], args[1], args[2])
    if (method === 'processSyncChunk' && args[0]?.identityKey === copy.identity) {
      const result = await copy.storage.processSyncChunk(args[0], args[1])
      if (!result || result.error || !Number.isSafeInteger(result.inserts) || !Number.isSafeInteger(result.updates)) throw new PortabilityError('storage', 'synchronization page')
      return result
    }
    throw new PortabilityError('invalid', 'unsupported copy operation')
    })
  }
  async closeCopy(id: string): Promise<void> {
    const copy = this.copies.get(id)
    if (!copy) return
    this.copies.delete(id); await copy.access.close(async () => { await copy.storage.destroy() })
  }
  async capture(identity: string, chain: ArchiveChain, copyId: string | undefined, report: Report): Promise<{ id: string; digest: string }> {
    walletStorageKey(identity, chain)
    return await this.repository.run(async signal => {
      if (copyId) {
        const copy = this.copy(copyId)
        if (!copy.writable || copy.identity !== identity || copy.chain !== chain) throw new PortabilityError('identity')
        return await copy.access.run(async () => {
          copy.writable = false
          return await this.repository.snapshot(this.repository.databasePath(copyId), identity, report, signal)
        })
      }
      return await this.host.quiesce(identity, chain, async () => {
        await this.host.getOrCreateStorage(identity, chain)
        return await this.repository.snapshot(this.host.bindings.databasePath(identity, chain), identity, report, signal)
      })
    })
  }
  async exportSnapshot(id: string, digest: string, password: string, destination: string, report: Report): Promise<void> {
    await this.repository.run(async signal => {
      const db = new SQLiteDatabase(this.repository.databasePath(id), true)
      try { if (await archiveDigest(db, signal) !== digest) throw new PortabilityError('storage', 'snapshot changed') }
      finally { await db.closeAsync() }
      await this.repository.exportStage(id, password, destination, report, signal)
    })
  }
  async prepareMerge(id: string, identity: string, chain: ArchiveChain, target: string, before: { id: string; digest: string } | undefined, report: Report): Promise<{ job: ArchiveJob; reader: string }> {
    walletStorageKey(identity, chain)
    if (this.closed || !/^[a-f0-9]{64}$/.test(target) || this.copies.size >= 4) throw new PortabilityError('identity')
    return await this.repository.run(signal => this.repository.verified(id, async (incoming, original) => {
      if (original.summary!.identityKey !== identity || original.summary!.chain !== chain) throw new PortabilityError('identity')
      let job = original, merged: StorageKnex | undefined
      try {
        if (job.state === 'merging') {
          if (job.target !== target || !job.mergeId || !job.mergeDigest || !job.mergeExportedAt) throw new PortabilityError('identity', 'merge destination changed')
          const verification = await this.repository.snapshot(this.repository.databasePath(job.mergeId), identity, report, signal, job.mergeExportedAt)
          if (verification.digest !== job.mergeDigest) throw new PortabilityError('storage', 'saved merge changed')
          merged = await this.provider(job.mergeId, chain)
        } else {
          if (!['ready', 'restored', 'merged'].includes(job.state) || !before) throw new PortabilityError('busy')
          const stage = new SQLiteDatabase(this.repository.databasePath(before.id), true)
          let mergeId: string
          try {
            if (await archiveDigest(stage, signal) !== before.digest) throw new PortabilityError('storage', 'recovery point changed')
            mergeId = await this.repository.materialize(stage, report, signal)
          } finally { await stage.closeAsync() }
          merged = await this.provider(mergeId, chain)
          const user = await merged.findUserByIdentityKey(identity)
          if (!user) throw new PortabilityError('identity')
          await merged.setActive({ identityKey: identity, userId: user.userId }, merged.getSettings().storageIdentityKey)
          const processChunk = merged.processSyncChunk.bind(merged)
          merged.processSyncChunk = async (...args) => {
            const result = await processChunk(...args)
            if (!result || result.error || !Number.isSafeInteger(result.inserts) || !Number.isSafeInteger(result.updates)) throw new PortabilityError('storage', 'synchronization page')
            return result
          }
          const manager = new WalletStorageManager(identity)
          await manager.addWalletStorageProvider(merged)
          const incomingId = await this.repository.materialize(incoming, report, signal)
          const reader = await this.provider(incomingId, chain)
          try {
            const getChunk = reader.getSyncChunk.bind(reader)
            reader.getSyncChunk = async args => { checkCancelled(signal); return await getChunk({ ...args, maxItems: Math.min(250, args.maxItems), maxRoughSize: Math.min(2 * 1024 * 1024, args.maxRoughSize) }) }
            report('Reconciling records in a separate copy…')
            await manager.syncFromReader(identity, reader)
          } finally { await reader.destroy() }
          const mergeExportedAt = new Date().toISOString()
          const verified = await this.repository.snapshot(this.repository.databasePath(mergeId), identity, report, signal, mergeExportedAt)
          job = await this.repository.save({ ...job, state: 'merging', target, beforeId: before.id, beforeDigest: before.digest, mergeId, mergeDigest: verified.digest, mergeExportedAt })
        }
        checkCancelled(signal)
        const handle = newArchiveId()
        this.copies.set(handle, { storage: merged, identity, chain, writable: false, access: new WalletStorageAccess() }); merged = undefined
        return { job, reader: handle }
      } finally { await merged?.destroy() }
    }, signal))
  }
  async finishMerge(id: string, target: string): Promise<ArchiveJob> {
    const job = await this.repository.get(id)
    if (job.state !== 'merging' || job.target !== target) throw new PortabilityError('identity')
    return await this.repository.save({ ...job, state: 'merged', error: undefined })
  }
  async activate(id: string, chain: ArchiveChain, expectedIdentity: string | undefined, report: Report): Promise<void> {
    await this.repository.run(signal => this.repository.verified(id, async (stage, job) => {
      const identity = job.summary!.identityKey
      if (job.summary!.chain !== chain || (expectedIdentity && expectedIdentity !== identity) || job.state === 'merging') throw new PortabilityError('identity')
      const recoveryId = await this.repository.materialize(stage, report, signal)
      const provider = await this.provider(recoveryId, chain)
      try {
        const user = await provider.findUserByIdentityKey(identity)
        if (!user) throw new PortabilityError('identity')
        const key = provider.getSettings().storageIdentityKey
        await provider.setActive({ identityKey: identity, userId: user.userId }, key)
        await this.repository.save({ ...job, state: 'activating', recoveryId })
        await this.host.closeForActivation(identity, chain, async () => {
          checkCancelled(signal)
          this.host.bindings.set(identity, chain, { id: recoveryId, storageIdentityKey: key, preferLocal: true, activatedAt: new Date().toISOString() })
          await this.repository.save({ ...job, state: 'active', recoveryId })
        })
      } finally { await provider.destroy() }
    }, signal))
  }
  async close(): Promise<void> {
    this.closed = true
    await this.repository.close()
    await this.creation.close(async () => {})
    for (const id of this.copies.keys()) await this.closeCopy(id)
  }
}
