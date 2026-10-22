/**
 * Durable color-module store (contract §2.1 ColorModuleStore, D5).
 *
 * Stability cases pinned here:
 * - crash mid-write: a leftover `*.tmp` never surfaces as a value or a key and
 *   is removed on the next open;
 * - double-submit / multi-window: concurrent writes of one key are serialized
 *   and the last enqueued write wins, with no temp files left;
 * - restart: a new service over the same root reads what the old one wrote;
 * - namespace isolation: identities and chains never see each other's keys.
 */

import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ColorStoreService, registerColorStoreIpc } from '../electron/colorStore.js'
import { createIpcColorModuleStore } from '../src/lib/permissionModules/color/store'

const A = '02' + 'aa'.repeat(32)
const B = '03' + 'bb'.repeat(32)

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-desktop-color-store-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const nsDir = (identityKey: string, chain: string) => path.join(root, `${identityKey}-${chain}`)
const fileFor = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex') + '.json'
const tmpFiles = (dir: string) => fs.readdirSync(dir).filter(f => f.endsWith('.tmp'))

describe('ColorStoreService', () => {
  test('round trip, overwrite, delete, missing', async () => {
    const s = new ColorStoreService({ root })
    expect(await s.get(A, 'test', 'color.v1.settled.t1')).toBeUndefined()
    await s.set(A, 'test', 'color.v1.settled.t1', '1')
    await s.set(A, 'test', 'color.v1.settled.t1', '2')
    expect(await s.get(A, 'test', 'color.v1.settled.t1')).toBe('2')
    await s.delete(A, 'test', 'color.v1.settled.t1')
    await s.delete(A, 'test', 'color.v1.settled.t1')
    expect(await s.get(A, 'test', 'color.v1.settled.t1')).toBeUndefined()
    expect(await s.keys(A, 'test', 'color.v1.')).toEqual([])
  })

  test('stores the empty string and non-ASCII values exactly', async () => {
    const s = new ColorStoreService({ root })
    await s.set(A, 'test', 'color.v1.e', '')
    await s.set(A, 'test', 'color.v1.u', 'snowman ☃ and 😀')
    expect(await s.get(A, 'test', 'color.v1.e')).toBe('')
    expect(await s.get(A, 'test', 'color.v1.u')).toBe('snowman ☃ and 😀')
    expect(await new ColorStoreService({ root }).keys(A, 'test', 'color.v1.')).toEqual(['color.v1.e', 'color.v1.u'])
  })

  test('keys filters by prefix, sorted, per identity and chain', async () => {
    const s = new ColorStoreService({ root })
    await s.set(A, 'test', 'color.v1.settled.b', '1')
    await s.set(A, 'test', 'color.v1.settled.a', '1')
    await s.set(A, 'test', 'color.v1.receipt.x', '1')
    await s.set(B, 'test', 'color.v1.settled.z', '1')
    await s.set(A, 'main', 'color.v1.settled.z', '1')
    expect(await s.keys(A, 'test', 'color.v1.settled.')).toEqual(['color.v1.settled.a', 'color.v1.settled.b'])
    expect(await s.keys(A, 'test', 'color.v1.')).toEqual(['color.v1.receipt.x', 'color.v1.settled.a', 'color.v1.settled.b'])
    expect(await s.keys(B, 'test', 'color.v1.')).toEqual(['color.v1.settled.z'])
    expect(await s.keys(A, 'main', 'color.v1.')).toEqual(['color.v1.settled.z'])
    expect(await s.keys(B, 'main', 'color.v1.')).toEqual([])
    // A prefix need not carry 'color.v1.': the namespace holds nothing else.
    expect(await s.keys(B, 'test', '')).toEqual(['color.v1.settled.z'])
    expect(await s.keys(B, 'test', 'color.v1')).toEqual(['color.v1.settled.z'])
    expect(await s.keys(B, 'test', 'other.')).toEqual([])
    expect(await s.get(B, 'test', 'color.v1.settled.a')).toBeUndefined()
  })

  test('survives a restart (new service, same root)', async () => {
    const s1 = new ColorStoreService({ root })
    await s1.set(A, 'test', 'color.v1.receipt.r1', '{"x":1}')
    await s1.set(A, 'test', 'color.v1.receipt.r2', 'gone')
    await s1.delete(A, 'test', 'color.v1.receipt.r2')
    const s2 = new ColorStoreService({ root })
    expect(await s2.get(A, 'test', 'color.v1.receipt.r1')).toBe('{"x":1}')
    expect(await s2.get(A, 'test', 'color.v1.receipt.r2')).toBeUndefined()
    expect(await s2.keys(A, 'test', 'color.v1.')).toEqual(['color.v1.receipt.r1'])
  })

  test('ignores and removes a crash-leftover temp file', async () => {
    const k = 'color.v1.settled.crash'
    const s1 = new ColorStoreService({ root })
    await s1.set(A, 'test', k, 'old')
    const dir = nsDir(A, 'test')
    // A crash after the temp write but before the rename.
    fs.writeFileSync(path.join(dir, `${fileFor(k)}.123.tmp`), JSON.stringify({ k, v: 'new' }))
    // A crash before the first rename of a never-stored key: no phantom key.
    const phantom = 'color.v1.settled.phantom'
    fs.writeFileSync(path.join(dir, `${fileFor(phantom)}.456.tmp`), JSON.stringify({ k: phantom, v: 'x' }))
    const s2 = new ColorStoreService({ root })
    expect(await s2.get(A, 'test', k)).toBe('old')
    expect(await s2.keys(A, 'test', 'color.v1.')).toEqual([k])
    expect(await s2.get(A, 'test', phantom)).toBeUndefined()
    expect(tmpFiles(dir)).toEqual([])
  })

  test('a corrupt or mismatched file reads as absent and can be overwritten', async () => {
    const s1 = new ColorStoreService({ root })
    await s1.set(A, 'test', 'color.v1.ok', 'v')
    const dir = nsDir(A, 'test')
    fs.writeFileSync(path.join(dir, fileFor('color.v1.bad')), '{"k":"color.v1.bad","v":')
    fs.writeFileSync(path.join(dir, fileFor('color.v1.moved')), JSON.stringify({ k: 'color.v1.other', v: 'x' }))
    fs.writeFileSync(path.join(dir, fileFor('color.v1.num')), JSON.stringify({ k: 'color.v1.num', v: 7 }))
    const s2 = new ColorStoreService({ root })
    expect(await s2.get(A, 'test', 'color.v1.bad')).toBeUndefined()
    expect(await s2.get(A, 'test', 'color.v1.moved')).toBeUndefined()
    expect(await s2.get(A, 'test', 'color.v1.num')).toBeUndefined()
    expect(await s2.keys(A, 'test', 'color.v1.')).toEqual(['color.v1.ok'])
    await s2.set(A, 'test', 'color.v1.bad', 'fixed')
    expect(await s2.get(A, 'test', 'color.v1.bad')).toBe('fixed')
    expect(await s2.keys(A, 'test', 'color.v1.')).toEqual(['color.v1.bad', 'color.v1.ok'])
  })

  test('serializes concurrent writes of one key', async () => {
    const s = new ColorStoreService({ root })
    await Promise.all(Array.from({ length: 50 }, (_, i) => s.set(A, 'test', 'color.v1.k', String(i))))
    expect(await s.get(A, 'test', 'color.v1.k')).toBe('49') // last enqueued wins
    expect(await s.keys(A, 'test', 'color.v1.')).toEqual(['color.v1.k'])
    expect(tmpFiles(nsDir(A, 'test'))).toEqual([])
    expect(await new ColorStoreService({ root }).get(A, 'test', 'color.v1.k')).toBe('49')
  })

  test('interleaved set and delete keep enqueue order; a failed op does not stall the queue', async () => {
    const s = new ColorStoreService({ root })
    const ops = [
      s.set(A, 'test', 'color.v1.k', 'a'),
      s.delete(A, 'test', 'color.v1.k'),
      s.set(A, 'test', 'color.v1.k', 'b'),
      s.set(A, 'test', 'not.color', 'x').catch(e => e),
      s.delete(A, 'test', 'color.v1.k'),
      s.set(A, 'test', 'color.v1.k', 'c')
    ]
    const results = await Promise.all(ops)
    expect(results[3]).toBeInstanceOf(Error)
    expect(await s.get(A, 'test', 'color.v1.k')).toBe('c')
  })

  test('a 16 MiB value round-trips; 32 MiB + 1 is refused', async () => {
    const s = new ColorStoreService({ root })
    const big = 'x'.repeat(16 * 1024 * 1024 + 1024)
    await s.set(A, 'test', 'color.v1.receipt.big', big)
    expect(await new ColorStoreService({ root }).get(A, 'test', 'color.v1.receipt.big')).toBe(big)
    await expect(s.set(A, 'test', 'color.v1.receipt.huge', 'x'.repeat(33_554_433)))
      .rejects.toThrow('Color store value exceeds 32 MiB')
    // Multi-byte characters count as UTF-8 bytes, not UTF-16 units.
    const small = new ColorStoreService({ root, maxValueBytes: 4 })
    await small.set(A, 'test', 'color.v1.m', 'éé')
    await expect(small.set(A, 'test', 'color.v1.m', 'ééa')).rejects.toThrow('Color store value exceeds 32 MiB')
    expect(await s.keys(A, 'test', 'color.v1.receipt.')).toEqual(['color.v1.receipt.big'])
  })

  test('validates identity, chain and key', async () => {
    const s = new ColorStoreService({ root })
    await expect(s.get('02zz', 'test', 'color.v1.a')).rejects.toThrow('Invalid color store identity')
    await expect(s.get('04' + 'aa'.repeat(32), 'test', 'color.v1.a')).rejects.toThrow('Invalid color store identity')
    await expect(s.get(A.toUpperCase(), 'test', 'color.v1.a')).rejects.toThrow('Invalid color store identity')
    await expect(s.get(A, 'regtest', 'color.v1.a')).rejects.toThrow('Invalid color store chain')
    await expect(s.get(A, '../x', 'color.v1.a')).rejects.toThrow('Invalid color store chain')
    await expect(s.set(A, 'test', 'other.a', 'v')).rejects.toThrow('Invalid color store key')
    await expect(s.set(A, 'test', 7, 'v')).rejects.toThrow('Invalid color store key')
    await expect(s.set(A, 'test', 'color.v1.' + 'a'.repeat(1016), 'v')).rejects.toThrow('Invalid color store key')
    await expect(s.set(A, 'test', 'color.v1.\ud800', 'v')).rejects.toThrow('Invalid color store key')
    await expect(s.keys(A, 'test', 7)).rejects.toThrow('Invalid color store key')
    await expect(s.keys(A, 'test', 'c'.repeat(1025))).rejects.toThrow('Invalid color store key')
    await expect(s.set(A, 'test', 'color.v1.a', 5)).rejects.toThrow('Color store value exceeds 32 MiB')
    await s.set(A, 'test', 'color.v1.' + 'a'.repeat(1015), 'v') // exactly 1024 chars
    expect(fs.readdirSync(root)).toEqual([`${A}-test`])
  })
})

describe('registerColorStoreIpc', () => {
  test('registers the four IPC channels and delegates', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, fn) } }
    registerColorStoreIpc(ipcMain, new ColorStoreService({ root }))
    expect([...handlers.keys()].sort()).toEqual(['color-store:delete', 'color-store:get', 'color-store:keys', 'color-store:set'])
    await handlers.get('color-store:set')!({}, A, 'test', 'color.v1.k', 'v')
    expect(await handlers.get('color-store:get')!({}, A, 'test', 'color.v1.k')).toBe('v')
    expect(await handlers.get('color-store:keys')!({}, A, 'test', 'color.v1.')).toEqual(['color.v1.k'])
    await handlers.get('color-store:delete')!({}, A, 'test', 'color.v1.k')
    expect(await handlers.get('color-store:get')!({}, A, 'test', 'color.v1.k')).toBeUndefined()
    await expect(Promise.resolve(handlers.get('color-store:set')!({}, A, 'test', 'bad', 'v'))).rejects.toThrow('Invalid color store key')
  })
})

describe('createIpcColorModuleStore', () => {
  test('renderer store passes identity and chain through', async () => {
    const calls: unknown[][] = []
    const fakeApi = {
      get: async (...a: unknown[]) => { calls.push(['get', ...a]); return 'v' },
      set: async (...a: unknown[]) => { calls.push(['set', ...a]) },
      delete: async (...a: unknown[]) => { calls.push(['delete', ...a]) },
      keys: async (...a: unknown[]) => { calls.push(['keys', ...a]); return ['color.v1.x'] }
    }
    const store = createIpcColorModuleStore(A, 'test', fakeApi as any)
    expect(await store.keys('color.v1.')).toEqual(['color.v1.x'])
    expect(await store.get('color.v1.x')).toBe('v')
    await store.set('color.v1.x', 'w')
    await store.delete('color.v1.x')
    expect(calls).toEqual([
      ['keys', A, 'test', 'color.v1.'],
      ['get', A, 'test', 'color.v1.x'],
      ['set', A, 'test', 'color.v1.x', 'w'],
      ['delete', A, 'test', 'color.v1.x']
    ])
  })

  test('refuses a bad namespace and a missing bridge up front', () => {
    expect(() => createIpcColorModuleStore('02zz', 'test', {} as any)).toThrow('Invalid color store identity')
    expect(() => createIpcColorModuleStore(A, 'regtest' as any, {} as any)).toThrow('Invalid color store chain')
    expect(() => createIpcColorModuleStore(A, 'test')).toThrow('Color store bridge is unavailable')
  })
})
