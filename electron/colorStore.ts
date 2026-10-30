/**
 * Durable key-value store for the BRC-207 color permission module (contract
 * §2.1 `ColorModuleStore`, D5: receipt and settlement evidence lives here).
 *
 * The main process is the only writer. Every renderer window reaches it over
 * IPC (`color-store:*`), so one per-namespace promise chain orders all reads
 * and writes, including those from concurrent windows.
 *
 * Layout: `<root>/<identityKey>-<chain>/<sha256hex(utf8 key)>.json`, each file
 * `{"k": key, "v": value}`. A write goes to `<name>.<uuid>.tmp`, is fsynced,
 * then renamed over the target, then the directory is fsynced (best effort).
 * A crash therefore leaves either the old file or the new one, plus at most a
 * stray `*.tmp` that is deleted the next time the namespace is opened.
 *
 * Why not renderer localStorage: it is one origin shared by every identity,
 * "clear local wallet state" wipes it, and its flushes are not crash-durable.
 */

import { createHash, randomUUID } from 'crypto'
import { promises as fsp } from 'fs'
import os from 'os'
import path from 'path'

export const COLOR_STORE_CHANNELS = {
  get: 'color-store:get',
  set: 'color-store:set',
  delete: 'color-store:delete',
  keys: 'color-store:keys'
} as const

/**
 * The Mandala host store (design §9 B7): the host ledger and the
 * `@bsv/mandala` journals, the same layout under its own root, channels and
 * key prefix. It is a separate service so the color module store keeps only
 * `color.v1.` keys; neither is reachable over BRC-100.
 */
export const MANDALA_STORE_CHANNELS = {
  get: 'mandala-store:get',
  set: 'mandala-store:set',
  delete: 'mandala-store:delete',
  keys: 'mandala-store:keys'
} as const

export const MANDALA_STORE_KEY_PREFIX = 'mandala.'

export type StoreChannels = { get: string, set: string, delete: string, keys: string }

const IDENTITY_RE = /^0[23][0-9a-f]{64}$/
const CHAINS = new Set(['main', 'test', 'ttn', 'tstn'])
const COLOR_KEY_PREFIX = 'color.v1.'
const MAX_KEY_LENGTH = 1024
const DEFAULT_MAX_VALUE_BYTES = 33_554_432
const FILE_RE = /^[0-9a-f]{64}\.json$/
// A lone surrogate encodes to U+FFFD in UTF-8, so two distinct keys could
// share one file name. Such keys are refused.
const LONE_SURROGATE_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

export interface ColorStoreServiceOptions {
  /** Default `~/.bsv-desktop/color-store`. */
  root?: string
  /** Default 32 MiB (33 554 432 UTF-8 bytes). */
  maxValueBytes?: number
  /** Every key must start with it. Default `color.v1.`. */
  keyPrefix?: string
}

export function defaultColorStoreRoot(): string {
  return path.join(os.homedir(), '.bsv-desktop', 'color-store')
}

export function defaultMandalaStoreRoot(): string {
  return path.join(os.homedir(), '.bsv-desktop', 'mandala-store')
}

function assertIdentity(identityKey: unknown): asserts identityKey is string {
  if (typeof identityKey !== 'string' || !IDENTITY_RE.test(identityKey)) {
    throw new Error('Invalid color store identity')
  }
}

function assertChain(chain: unknown): asserts chain is string {
  if (typeof chain !== 'string' || !CHAINS.has(chain)) {
    throw new Error('Invalid color store chain')
  }
}

function assertKey(key: unknown, keyPrefix: string): asserts key is string {
  if (
    typeof key !== 'string' ||
    !key.startsWith(keyPrefix) ||
    key.length > MAX_KEY_LENGTH ||
    LONE_SURROGATE_RE.test(key)
  ) {
    throw new Error('Invalid color store key')
  }
}

function fileNameFor(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex') + '.json'
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/** Parses a store file; anything malformed, or stored under another key, is absent. */
function decodeRecord(text: string, expectedKey?: string): { k: string; v: string } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const { k, v } = parsed as { k?: unknown; v?: unknown }
  if (typeof k !== 'string' || typeof v !== 'string') return undefined
  if (expectedKey !== undefined && k !== expectedKey) return undefined
  return { k, v }
}

interface Namespace {
  dir: string
  /** key -> file name; null until the lazy scan has completed. */
  index: Map<string, string> | null
  /** Single-flight scan, cleared on failure so a later call retries. */
  indexing: Promise<Map<string, string>> | null
  /** Every operation in this namespace runs in enqueue order. */
  tail: Promise<void>
}

export class ColorStoreService {
  readonly root: string
  private readonly maxValueBytes: number
  readonly keyPrefix: string
  private readonly namespaces = new Map<string, Namespace>()

  constructor(options: ColorStoreServiceOptions = {}) {
    this.root = options.root ?? defaultColorStoreRoot()
    this.maxValueBytes = options.maxValueBytes ?? DEFAULT_MAX_VALUE_BYTES
    this.keyPrefix = options.keyPrefix ?? COLOR_KEY_PREFIX
    if (this.keyPrefix.length === 0) throw new Error('A store key prefix is required')
  }

  async get(identityKey: unknown, chain: unknown, key: unknown): Promise<string | undefined> {
    const ns = this.namespace(identityKey, chain)
    assertKey(key, this.keyPrefix)
    return this.enqueue(ns, async () => {
      await this.ensureIndex(ns)
      let text: string
      try {
        text = await fsp.readFile(path.join(ns.dir, fileNameFor(key)), 'utf8')
      } catch (error) {
        if (isMissing(error)) return undefined
        throw error
      }
      return decodeRecord(text, key)?.v
    })
  }

  async set(identityKey: unknown, chain: unknown, key: unknown, value: unknown): Promise<void> {
    const ns = this.namespace(identityKey, chain)
    assertKey(key, this.keyPrefix)
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > this.maxValueBytes) {
      throw new Error('Color store value exceeds 32 MiB')
    }
    return this.enqueue(ns, async () => {
      const index = await this.ensureIndex(ns)
      const name = fileNameFor(key)
      await fsp.mkdir(ns.dir, { recursive: true })
      await writeFileAtomic(ns.dir, name, JSON.stringify({ k: key, v: value }))
      index.set(key, name)
    })
  }

  async delete(identityKey: unknown, chain: unknown, key: unknown): Promise<void> {
    const ns = this.namespace(identityKey, chain)
    assertKey(key, this.keyPrefix)
    return this.enqueue(ns, async () => {
      const index = await this.ensureIndex(ns)
      try {
        await fsp.unlink(path.join(ns.dir, fileNameFor(key)))
      } catch (error) {
        if (!isMissing(error)) throw error
        index.delete(key)
        return
      }
      index.delete(key)
      await syncDirectory(ns.dir)
    })
  }

  /** Keys starting with `prefix`, sorted ascending. */
  async keys(identityKey: unknown, chain: unknown, prefix: unknown): Promise<string[]> {
    const ns = this.namespace(identityKey, chain)
    // Any prefix is safe to enumerate: the namespace only ever holds keys under keyPrefix.
    if (typeof prefix !== 'string' || prefix.length > MAX_KEY_LENGTH) {
      throw new Error('Invalid color store key')
    }
    return this.enqueue(ns, async () => {
      const index = await this.ensureIndex(ns)
      return [...index.keys()].filter(k => k.startsWith(prefix)).sort()
    })
  }

  private namespace(identityKey: unknown, chain: unknown): Namespace {
    assertIdentity(identityKey)
    assertChain(chain)
    const name = `${identityKey}-${chain}`
    let ns = this.namespaces.get(name)
    if (!ns) {
      ns = { dir: path.join(this.root, name), index: null, indexing: null, tail: Promise.resolve() }
      this.namespaces.set(name, ns)
    }
    return ns
  }

  /** Runs `work` after every earlier operation in the namespace; a failure never stalls the chain. */
  private enqueue<T>(ns: Namespace, work: () => Promise<T>): Promise<T> {
    const run = ns.tail.then(work)
    ns.tail = run.then(() => undefined, () => undefined)
    return run
  }

  private async ensureIndex(ns: Namespace): Promise<Map<string, string>> {
    if (ns.index) return ns.index
    ns.indexing ??= scanNamespace(ns.dir, this.keyPrefix).then(
      index => {
        ns.index = index
        ns.indexing = null
        return index
      },
      error => {
        ns.indexing = null
        throw error
      }
    )
    return ns.indexing
  }
}

/** Builds key -> file for one namespace directory and deletes crash-leftover temp files. */
async function scanNamespace(dir: string, keyPrefix: string): Promise<Map<string, string>> {
  const index = new Map<string, string>()
  let entries: string[]
  try {
    entries = await fsp.readdir(dir)
  } catch (error) {
    if (isMissing(error)) return index
    throw error
  }
  for (const entry of entries) {
    if (entry.endsWith('.tmp')) {
      await fsp.rm(path.join(dir, entry), { force: true })
      continue
    }
    if (!FILE_RE.test(entry)) continue
    let text: string
    try {
      text = await fsp.readFile(path.join(dir, entry), 'utf8')
    } catch (error) {
      if (isMissing(error)) continue
      throw error
    }
    const record = decodeRecord(text)
    // A record whose key does not hash to its file name is never readable by get().
    if (record && fileNameFor(record.k) === entry) {
      try {
        assertKey(record.k, keyPrefix)
      } catch {
        continue
      }
      index.set(record.k, entry)
    }
  }
  return index
}

async function writeFileAtomic(dir: string, name: string, contents: string): Promise<void> {
  const target = path.join(dir, name)
  const tmp = path.join(dir, `${name}.${randomUUID()}.tmp`)
  try {
    const handle = await fsp.open(tmp, 'wx')
    try {
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fsp.rename(tmp, target)
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
  await syncDirectory(dir)
}

/** Makes a rename or unlink durable where the platform allows it (not on Windows). */
async function syncDirectory(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fsp.open>> | undefined
  try {
    handle = await fsp.open(dir, 'r')
    await handle.sync()
  } catch {
    // best effort
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export interface ColorStoreIpcMainLike {
  handle(channel: string, fn: (event: unknown, ...args: unknown[]) => unknown): void
}

/**
 * Registers `color-store:{get,set,delete,keys}` (or `channels`, e.g.
 * MANDALA_STORE_CHANNELS) with the argument order of the service methods.
 */
export function registerColorStoreIpc(
  ipcMain: ColorStoreIpcMainLike,
  service: ColorStoreService,
  channels: StoreChannels = COLOR_STORE_CHANNELS
): void {
  ipcMain.handle(channels.get, (_event, identityKey, chain, key) =>
    service.get(identityKey, chain, key))
  ipcMain.handle(channels.set, (_event, identityKey, chain, key, value) =>
    service.set(identityKey, chain, key, value))
  ipcMain.handle(channels.delete, (_event, identityKey, chain, key) =>
    service.delete(identityKey, chain, key))
  ipcMain.handle(channels.keys, (_event, identityKey, chain, prefix) =>
    service.keys(identityKey, chain, prefix))
}
