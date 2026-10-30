/**
 * Mandala host store (design §9 B7): the host ledger and the @bsv/mandala
 * journals live in a second main-process store under `mandala.` keys, read
 * from the renderer as a `MandalaStorage`.
 *
 * Cases pinned here:
 * - prefix isolation: the Mandala service takes only `mandala.` keys, the
 *   color module store only `color.v1.` keys (no app-reachable path writes
 *   either, and neither can write the other's namespace);
 * - the IPC channels are separate (`mandala-store:*`);
 * - the renderer adapter answers `null` for a missing key, validates the
 *   namespace up front and fails without the bridge;
 * - ledger persistence: a host ledger written through the adapter is read
 *   back by a new service over the same root (restart), merges without
 *   downgrading, and is namespaced per identity and chain.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createHostLedger } from '@bsv/mandala'
import {
  COLOR_STORE_CHANNELS,
  ColorStoreService,
  MANDALA_STORE_CHANNELS,
  MANDALA_STORE_KEY_PREFIX,
  registerColorStoreIpc
} from '../electron/colorStore.js'
import { createIpcMandalaStorage } from '../src/lib/permissionModules/color/mandalaStorage'

const A = '02' + 'aa'.repeat(32)
const B = '03' + 'bb'.repeat(32)
const TXID = 'ab'.repeat(32)
const ASSET = `${'11'.repeat(32)}_0`

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-desktop-mandala-store-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const mandalaService = () => new ColorStoreService({ root, keyPrefix: MANDALA_STORE_KEY_PREFIX })
/** The preload bridge, straight onto a service (what IPC does). */
const bridgeOver = (s: ColorStoreService) => ({
  get: (i: string, c: any, k: string) => s.get(i, c, k),
  set: (i: string, c: any, k: string, v: string) => s.set(i, c, k, v),
  delete: (i: string, c: any, k: string) => s.delete(i, c, k),
  keys: (i: string, c: any, p: string) => s.keys(i, c, p)
})

describe('Mandala store service', () => {
  test('takes only mandala. keys; the color store takes only color.v1. keys', async () => {
    const m = mandalaService()
    await m.set(A, 'test', 'mandala.host.v1.record.x', '1')
    expect(await m.get(A, 'test', 'mandala.host.v1.record.x')).toBe('1')
    await expect(m.set(A, 'test', 'color.v1.settled.x', '1')).rejects.toThrow('Invalid color store key')
    await expect(m.get(A, 'test', 'other.x')).rejects.toThrow('Invalid color store key')

    const c = new ColorStoreService({ root: path.join(root, 'color') })
    await expect(c.set(A, 'test', 'mandala.host.v1.record.x', '1')).rejects.toThrow('Invalid color store key')
    expect(() => new ColorStoreService({ root, keyPrefix: '' })).toThrow()
  })

  test('a file with a foreign key is ignored on scan', async () => {
    const m = mandalaService()
    await m.set(A, 'test', 'mandala.a', '1')
    // the color service over the same directory never lists the mandala key
    const c = new ColorStoreService({ root })
    expect(await c.keys(A, 'test', '')).toEqual([])
    expect(await mandalaService().keys(A, 'test', '')).toEqual(['mandala.a'])
  })

  test('registers its own channels', () => {
    const handled: string[] = []
    registerColorStoreIpc({ handle: (ch) => { handled.push(ch) } }, mandalaService(), MANDALA_STORE_CHANNELS)
    expect(handled.sort()).toEqual(Object.values(MANDALA_STORE_CHANNELS).sort())
    expect(handled.some(ch => (Object.values(COLOR_STORE_CHANNELS) as string[]).includes(ch))).toBe(false)
  })
})

describe('createIpcMandalaStorage', () => {
  test('maps a missing key to null and passes the namespace', async () => {
    const bridge = { get: vi.fn(async () => undefined), set: vi.fn(async () => {}), delete: vi.fn(async () => {}), keys: vi.fn(async () => ['mandala.k']) }
    const s = createIpcMandalaStorage(A, 'test', bridge)
    expect(await s.getItem('mandala.k')).toBeNull()
    await s.setItem('mandala.k', 'v')
    await s.removeItem('mandala.k')
    expect(await s.keys('mandala.')).toEqual(['mandala.k'])
    expect(bridge.set).toHaveBeenCalledWith(A, 'test', 'mandala.k', 'v')
    expect(bridge.delete).toHaveBeenCalledWith(A, 'test', 'mandala.k')
    expect(bridge.keys).toHaveBeenCalledWith(A, 'test', 'mandala.')
  })

  test('a wrong namespace or a missing bridge fails at build', () => {
    const bridge = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), keys: vi.fn() } as any
    expect(() => createIpcMandalaStorage('nope', 'test', bridge)).toThrow('Invalid Mandala store identity')
    expect(() => createIpcMandalaStorage(A, 'mainnet' as any, bridge)).toThrow('Invalid Mandala store chain')
    vi.stubGlobal('window', { electronAPI: {} })
    try {
      expect(() => createIpcMandalaStorage(A, 'test')).toThrow('Mandala store bridge is unavailable')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('host ledger persistence', () => {
  test('a ledger record survives a restart, merges without downgrading, per identity and chain', async () => {
    const ledger = createHostLedger(createIpcMandalaStorage(A, 'test', bridgeOver(mandalaService())))
    await ledger.put({ v: 1, txid: TXID, assetId: ASSET, state: 'pending', outputs: [0], at: 1 })
    await ledger.put({ v: 1, txid: TXID, assetId: ASSET, state: 'settled', outputs: [1], marked: false, at: 2 })

    // restart: a new service and ledger over the same root
    const again = createHostLedger(createIpcMandalaStorage(A, 'test', bridgeOver(mandalaService())))
    const r = await again.get(TXID)
    expect(r).toMatchObject({ txid: TXID, assetId: ASSET, state: 'settled', marked: false })
    expect(r?.outputs).toEqual([0, 1])
    // a late pending write never downgrades a settled record
    await again.put({ v: 1, txid: TXID, assetId: ASSET, state: 'pending', outputs: [0], at: 3 })
    expect((await again.get(TXID))?.state).toBe('settled')
    expect((await again.list()).map(x => x.txid)).toEqual([TXID])

    // other identity / chain see nothing
    expect(await createHostLedger(createIpcMandalaStorage(B, 'test', bridgeOver(mandalaService()))).get(TXID)).toBeUndefined()
    expect(await createHostLedger(createIpcMandalaStorage(A, 'main', bridgeOver(mandalaService()))).get(TXID)).toBeUndefined()
  })
})
