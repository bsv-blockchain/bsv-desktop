/**
 * Storage access fencing and recovery bindings on the real Electron
 * StorageManager (PR #90), including concurrent everyday wallet requests.
 */

import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import knex from 'knex'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { KnexMigrations } from '@bsv/wallet-toolbox'
import { WalletStorageAccess } from '../electron/wallet-portability/access'
import { WalletDataBindings } from '../electron/wallet-portability/bindings'
import { WalletArchiveRepository } from '../electron/wallet-portability/repository'
import { WalletPortabilityService } from '../electron/wallet-portability/service'
import { portabilityFixture } from './fixtures/wallet-portability'

const forked: any[] = []
const forkBehavior = { failNext: false, stuckNext: false }

vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    fork: vi.fn(() => {
      if (forkBehavior.failNext) { forkBehavior.failNext = false; throw new Error('fork failed') }
      const stuck = forkBehavior.stuckNext
      forkBehavior.stuckNext = false
      const worker: any = Object.assign(new EventEmitter(), {
        send: vi.fn((message: { type: string }) => {
          if (message.type === 'stop' && !stuck) setImmediate(() => worker.emit('exit', 0, null))
        }),
        kill: vi.fn(),
        exitCode: null,
        signalCode: null,
        connected: true,
        stdout: null,
        stderr: null
      })
      forked.push(worker)
      setImmediate(() => worker.emit('message', { type: 'ready' }))
      return worker
    })
  }
})

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

describe('WalletStorageAccess', () => {
  it('runs everyday shared requests concurrently', async () => {
    const access = new WalletStorageAccess()
    const slow = deferred()
    const events: string[] = []

    const first = access.share(async () => { events.push('slow start'); await slow.promise; events.push('slow end') })
    const second = access.share(async () => { events.push('fast') })

    await second
    expect(events).toEqual(['slow start', 'fast'])
    slow.resolve()
    await first
  })

  it('makes an exclusive operation wait for in-flight shared requests and holds later ones', async () => {
    const access = new WalletStorageAccess()
    const held = deferred()
    const events: string[] = []

    const inFlight = access.share(async () => { events.push('shared'); await held.promise; events.push('shared done') })
    const exclusive = access.run(async () => { events.push('exclusive') })
    const later = access.share(async () => { events.push('later') })

    await new Promise(resolve => setImmediate(resolve))
    expect(events).toEqual(['shared'])
    held.resolve()
    await Promise.all([inFlight, exclusive, later])
    expect(events).toEqual(['shared', 'shared done', 'exclusive', 'later'])
  })

  it('stays usable when a close fails before sealing, and fenced once sealed', async () => {
    const access = new WalletStorageAccess()
    await expect(access.close(async () => { throw new Error('monitor did not exit') })).rejects.toThrow('monitor did not exit')
    await expect(access.share(async () => 'still open')).resolves.toBe('still open')

    await expect(access.close(async seal => { seal(); throw new Error('commit failed') })).rejects.toThrow('commit failed')
    await expect(access.share(async () => 'late')).rejects.toThrow('Restart')
  })

  it('rejects shared requests after the storage generation is closed', async () => {
    const access = new WalletStorageAccess()
    const held = deferred()
    const inFlight = access.share(async () => { await held.promise; return 'finished' })
    const closing = access.close(async () => undefined)
    const late = access.share(async () => 'late')

    held.resolve()
    await expect(inFlight).resolves.toBe('finished')
    await closing
    await expect(late).rejects.toThrow('Restart')
  })
})

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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-wallet-data-storage-'))
const identityKey = `02${'34'.repeat(32)}`
const chain = 'test' as const

describe.skipIf(!sqliteAvailable)('StorageManager with a recovery binding', () => {
  let storageManager: typeof import('../electron/storage').storageManager
  let bindings: WalletDataBindings
  const recoveryId = 'a'.repeat(32)
  const recoveryStorageKey = 'b'.repeat(64)

  /** A recovered database as WalletArchiveRepository.materialize leaves it. */
  async function recoveredDb(storageIdentityKey: string) {
    const db = knex({
      client: 'better-sqlite3',
      connection: { filename: path.join(bindings.directory, `${recoveryId}.db`) },
      useNullAsDefault: true
    })
    await db.migrate.latest({ migrationSource: new KnexMigrations(chain, 'recovered', storageIdentityKey, 10000) })
    await db('users').insert({ identityKey, activeStorage: storageIdentityKey, created_at: new Date(), updated_at: new Date() })
    await db.destroy()
  }

  beforeAll(async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(home)
    ;({ storageManager } = await import('../electron/storage'))
    bindings = storageManager.bindings
    fs.mkdirSync(bindings.directory, { recursive: true })
  })

  afterEach(async () => {
    await storageManager.cleanup()
  })

  afterAll(() => {
    vi.restoreAllMocks()
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('opens the bound database, keeps its storage identity, and hands the monitor the same file', async () => {
    await recoveredDb(recoveryStorageKey)
    bindings.set(identityKey, chain, { id: recoveryId, storageIdentityKey: recoveryStorageKey, preferLocal: true, activatedAt: new Date().toISOString() })

    const settings = await storageManager.makeAvailable(identityKey, chain)
    await storageManager.startMonitorWorker(identityKey, chain)

    // The unique-provider-identity migration (PR #83) must leave a bound database alone,
    // otherwise the next start would fail the binding check.
    expect(settings.storageIdentityKey).toBe(recoveryStorageKey)
    expect(fs.existsSync(path.join(home, '.bsv-desktop', `wallet-${identityKey}-${chain}.db`))).toBe(false)
    expect(forked.at(-1).send.mock.calls[0][0].config.databasePath).toBe(path.join(bindings.directory, `${recoveryId}.db`))

    await storageManager.cleanup()
    await expect(storageManager.makeAvailable(identityKey, chain)).resolves.toMatchObject({ storageIdentityKey: recoveryStorageKey })
  })

  it('refuses to open a bound database whose storage identity was substituted', async () => {
    fs.rmSync(path.join(bindings.directory, `${recoveryId}.db`), { force: true })
    await recoveredDb('c'.repeat(64))

    await expect(storageManager.makeAvailable(identityKey, chain)).rejects.toThrow('does not match')
  })

  it('does not let a failed monitor restart mask a successful quiesced operation', async () => {
    const otherIdentity = `03${'78'.repeat(32)}`
    await storageManager.startMonitorWorker(otherIdentity, chain)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    forkBehavior.failNext = true

    await expect(storageManager.quiesce(otherIdentity, chain, async () => 'snapshot')).resolves.toBe('snapshot')
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/Failed to restart/), expect.any(Error))
    error.mockRestore()
  })

  it('still closes every database on quit when a monitor worker will not stop', async () => {
    const otherIdentity = `02${'9a'.repeat(32)}`
    await storageManager.makeAvailable(otherIdentity, chain)
    forkBehavior.stuckNext = true
    await storageManager.startMonitorWorker(otherIdentity, chain)
    const db = (storageManager as any).databases.get(`${otherIdentity}-${chain}`)
    const destroy = vi.spyOn(db, 'destroy')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await storageManager.cleanup()

    expect(destroy).toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/did not stop during cleanup/), expect.any(Error))
    error.mockRestore()
  }, 30_000)

  it('round-trips an activated recovery copy: reopen, export encrypted, re-import', async () => {
    const fixture = portabilityFixture()
    const identity = fixture.user.identityKey
    const repository = new WalletArchiveRepository(bindings.directory)
    await repository.ready()
    const service = new WalletPortabilityService(repository, storageManager)
    try {
      const original = path.join(home, 'fixture.brc38')
      fs.writeFileSync(original, JSON.stringify(fixture))
      const imported = await repository.import(original, '', () => {})
      await service.activate(imported.id, chain, identity, () => {})
      const binding = bindings.get(identity, chain)!

      // The app restarts after activation; model that with fresh access fences.
      await storageManager.cleanup()
      ;(storageManager as any).access.clear()
      const settings = await storageManager.makeAvailable(identity, chain)
      expect(settings.storageIdentityKey).toBe(binding.storageIdentityKey)

      const snapshot = await service.capture(identity, chain, undefined, () => {})
      const exported = path.join(home, 'exported.brc39')
      await service.exportSnapshot(snapshot.id, snapshot.digest, 'correct horse battery staple', exported, () => {})
      const reimported = await repository.import(exported, 'correct horse battery staple', () => {})

      expect(reimported.format).toBe('brc39')
      expect(reimported.summary!.identityKey).toBe(identity)
      expect(reimported.summary!.chain).toBe(chain)
      expect(reimported.summary!.counts).toEqual(imported.summary!.counts)
      expect(reimported.summary!.totalRecords).toBeGreaterThan(0)
      await expect(repository.import(exported, 'wrong passphrase!!', () => {})).rejects.toThrow()
    } finally {
      await service.close()
    }
  })

  it('does not serialize everyday storage requests behind a slow one', async () => {
    const otherIdentity = `03${'56'.repeat(32)}`
    await storageManager.makeAvailable(otherIdentity, chain)
    const slow = deferred()
    const events: string[] = []

    const first = storageManager.request(otherIdentity, chain, async () => { events.push('slow'); await slow.promise })
    const second = storageManager.request(otherIdentity, chain, async () => {
      events.push('listOutputs')
      return await storageManager.callStorageMethod(otherIdentity, chain, 'findOutputs', [{ partial: {} }])
    })

    await expect(second).resolves.toEqual([])
    expect(events).toEqual(['slow', 'listOutputs'])
    slow.resolve()
    await first
  })
})
