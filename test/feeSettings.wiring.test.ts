/**
 * Proves the persisted per-chain fee rate reaches the wallet's StorageKnex and
 * the monitor worker's start configuration, not just the settings service.
 */

import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import knex from 'knex'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

const forked: Array<EventEmitter & { send: ReturnType<typeof vi.fn> }> = []

vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    fork: vi.fn(() => {
      const worker: any = Object.assign(new EventEmitter(), {
        send: vi.fn((message: { type: string }) => {
          if (message.type === 'stop') setImmediate(() => worker.emit('exit', 0, null))
        }),
        kill: vi.fn(),
        stdout: null,
        stderr: null
      })
      forked.push(worker)
      setImmediate(() => worker.emit('message', { type: 'ready' }))
      return worker
    })
  }
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-fee-wiring-'))
const identityKey = `02${'12'.repeat(32)}`

describe.skipIf(!sqliteAvailable)('fee rate wiring', () => {
  let storageManager: typeof import('../electron/storage').storageManager

  beforeAll(async () => {
    fs.mkdirSync(path.join(home, '.bsv-desktop'), { recursive: true })
    fs.writeFileSync(path.join(home, '.bsv-desktop', 'fee-settings.json'), JSON.stringify({ test: 321 }))
    vi.spyOn(os, 'homedir').mockReturnValue(home)
    ;({ storageManager } = await import('../electron/storage'))
  })

  afterEach(async () => {
    await storageManager.cleanup()
  })

  afterAll(() => {
    vi.restoreAllMocks()
    fs.rmSync(home, { recursive: true, force: true })
  })

  test('local storage uses the configured rate for its chain', async () => {
    const storage = await storageManager.getOrCreateStorage(identityKey, 'test')
    expect(storage.feeModel).toEqual({ model: 'sat/kb', value: 321 })
  })

  test('chains without an override keep the 250 sat/kB storage default', async () => {
    const storage = await storageManager.getOrCreateStorage(identityKey, 'main')
    expect(storage.feeModel).toEqual({ model: 'sat/kb', value: 250 })
  })

  test('the monitor worker is started with the configured rate', async () => {
    await storageManager.startMonitorWorker(identityKey, 'test')
    await storageManager.startMonitorWorker(identityKey, 'main')

    const configs = forked.map(worker => worker.send.mock.calls[0][0])
    const databasePath = (chain: string) => path.join(home, '.bsv-desktop', `wallet-${identityKey}-${chain}.db`)
    expect(configs).toEqual([
      { type: 'start', config: { identityKey, chain: 'test', databasePath: databasePath('test'), feeRate: 321 } },
      { type: 'start', config: { identityKey, chain: 'main', databasePath: databasePath('main'), feeRate: 100 } }
    ])
  })
})
