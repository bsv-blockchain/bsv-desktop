import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WalletArchiveRepository } from '../electron/wallet-portability/repository'
import { WalletDataBindings, assertRecoveryBinding } from '../electron/wallet-portability/bindings'
import { WalletStorageAccess } from '../electron/wallet-portability/access'
import { WalletPortabilityService } from '../electron/wallet-portability/service'
import { SQLiteDatabase } from '../electron/wallet-portability/sqlite'
import { portabilityFixture } from './fixtures/wallet-portability'

const roots: string[] = [], services: WalletPortabilityService[] = []
afterEach(async () => { for (const s of services.splice(0)) await s.close(); for (const root of roots.splice(0)) fs.rmSync(root, { force: true, recursive: true }) })
const setup = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-file-service-')); roots.push(root)
  const repo = new WalletArchiveRepository(root); await repo.ready()
  const bindings = new WalletDataBindings(root)
  let closed = 0
  const service = new WalletPortabilityService(repo, { bindings,
    getOrCreateStorage: async () => { throw new Error('unexpected live storage access') },
    quiesce: async (_identity, _chain, operation) => await operation(),
    closeForActivation: async (_identity, _chain, commit) => { closed++; await commit() }
  })
  services.push(service)
  const fixture = portabilityFixture(), original = path.join(root, 'fixture.brc38')
  fs.writeFileSync(original, JSON.stringify(fixture))
  const job = await repo.import(original, '', () => {})
  return { root, repo, bindings, service, fixture, job, closed: () => closed }
}
describe('wallet portability storage safety', () => {
  it('rejects a replaced recovery database before migrations or monitor startup', () => {
    const binding = { id: 'a'.repeat(32), storageIdentityKey: 'b'.repeat(64), preferLocal: true, activatedAt: new Date().toISOString() }
    const identity = portabilityFixture().user.identityKey
    const settings = { chain: 'test', storageIdentityKey: binding.storageIdentityKey }, user = { identityKey: identity }
    expect(() => assertRecoveryBinding(binding, 'test', settings, user, identity)).not.toThrow()
    for (const [changedSettings, changedUser] of [[{ ...settings, chain: 'main' }, user], [{ ...settings, storageIdentityKey: 'c'.repeat(64) }, user], [settings, { identityKey: '02' + 'd'.repeat(64) }], [settings, undefined]]) {
      expect(() => assertRecoveryBinding(binding, 'test', changedSettings, changedUser, identity)).toThrow('does not match')
    }
  })
  it('fences queued old requests and waits for an in-flight request before activation', async () => {
    const queue = new WalletStorageAccess(), events: string[] = []
    let finish!: () => void
    const held = queue.run(async () => { events.push('held'); await new Promise<void>(resolve => { finish = resolve }); events.push('drained') })
    await Promise.resolve()
    const closing = queue.close(async () => { events.push('commit') })
    const late = expect(queue.run(async () => { events.push('late') })).rejects.toThrow('Restart')
    expect(events).toEqual(['held']); finish(); await held; await closing; await late
    expect(events).toEqual(['held', 'drained', 'commit'])
  })
  it('rejects wrong-network activation and binds a verified separate copy without changing its original', async () => {
    const { repo, bindings, service, fixture, job, closed } = await setup()
    const original = fs.readFileSync(repo.originalPath(job.id))
    await expect(service.activate(job.id, 'main', undefined, () => {})).rejects.toThrow('identity or network')
    expect(closed()).toBe(0)
    await service.activate(job.id, 'test', fixture.user.identityKey, () => {})
    const binding = bindings.get(fixture.user.identityKey, 'test')!
    expect(binding.preferLocal).toBe(true); expect(closed()).toBe(1)
    const db = new SQLiteDatabase(repo.databasePath(binding.id), true)
    try {
      expect((await db.getFirstAsync('SELECT activeStorage FROM users')).activeStorage).toBe(binding.storageIdentityKey)
      expect((await db.getFirstAsync('SELECT description FROM transactions')).description).toBe(fixture.tables.transactions[0].description)
    } finally { await db.closeAsync() }
    expect(fs.readFileSync(repo.originalPath(job.id))).toEqual(original)
    expect((await repo.get(job.id)).state).toBe('active')
  })
  it('reconciles an isolated merge, retains the before point, and detects modified resumable data', async () => {
    const { repo, service, fixture, job } = await setup()
    const restored = await repo.restore(job.id, () => {})
    const before = await repo.snapshot(repo.databasePath(restored.recoveryId!), fixture.user.identityKey, () => {})
    const target = 'a'.repeat(64)
    const prepared = await service.prepareMerge(job.id, fixture.user.identityKey, 'test', target, before, () => {})
    expect(prepared.job.state).toBe('merging')
    expect(prepared.job.beforeDigest).toBe(before.digest)
    expect(await service.copyCall(prepared.reader, 'makeAvailable', [])).toHaveProperty('chain', 'test')
    await expect(service.copyCall(prepared.reader, 'processSyncChunk', [{ identityKey: fixture.user.identityKey }, {}])).rejects.toThrow('read-only')
    await service.closeCopy(prepared.reader)
    const resumed = await service.prepareMerge(job.id, fixture.user.identityKey, 'test', target, undefined, () => {})
    await service.closeCopy(resumed.reader)
    const db = new SQLiteDatabase(repo.databasePath(prepared.job.mergeId!), true)
    try { await db.runAsync("UPDATE transactions SET description='tampered'") } finally { await db.closeAsync() }
    await expect(service.prepareMerge(job.id, fixture.user.identityKey, 'test', target, undefined, () => {})).rejects.toThrow('saved merge changed')
    expect((await repo.get(job.id)).state).toBe('merging')
  })
  it('restricts remote-copy operations and identities, and releases copy handles', async () => {
    const { service, fixture } = await setup()
    const id = await service.createCopy(fixture.user.identityKey, 'test', 'a'.repeat(64))
    expect(await service.copyCall(id, 'makeAvailable', [])).toHaveProperty('chain', 'test')
    await expect(service.copyCall(id, 'destroy', [])).rejects.toThrow('unsupported')
    await expect(service.copyCall(id, 'findOrInsertUser', ['02' + 'b'.repeat(64)])).rejects.toThrow('unsupported')
    await service.closeCopy(id)
    await expect(service.copyCall(id, 'makeAvailable', [])).rejects.toThrow('session ended')
  })
})
