/**
 * The Arcade callback token is derived in the renderer, which alone holds the
 * wallet's key, and has to reach both halves of the main process that use it:
 * the Services that broadcast (X-CallbackToken) and the monitor worker that
 * subscribes to the SSE stream. These run the real StorageElectronIPC and the
 * real StorageManager, with stub storage and a stand-in worker process.
 */

import { EventEmitter } from 'events'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CachedKeyDeriver, PrivateKey } from '@bsv/sdk'
import type { StorageKnex } from '@bsv/wallet-toolbox'
import { storageManager } from '../electron/storage'
import { StorageElectronIPC } from '../src/lib/StorageElectronIPC'
import { deriveArcadeCallbackToken } from '../src/lib/services/createServices'

type FakeWorker = EventEmitter & { messages: Array<{ type: string, config?: Record<string, unknown> }> }
const forked: FakeWorker[] = []

vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    fork: () => {
      const worker: any = Object.assign(new EventEmitter(), {
        exitCode: null, signalCode: null, connected: true, stdout: null, stderr: null, messages: [],
        send: (message: { type: string }, callback?: (error: Error | null) => void) => {
          worker.messages.push(message)
          if (message.type === 'stop') setImmediate(() => worker.emit('exit', 0, null))
          callback?.(null)
        },
        kill: () => {}
      })
      worker.on('exit', (code: number | null, signal: string | null) => {
        Object.assign(worker, { exitCode: code, signalCode: signal, connected: false })
      })
      forked.push(worker)
      setImmediate(() => worker.emit('message', { type: 'ready' }))
      return worker
    }
  }
})

const chain = 'test' as const
const keyDeriver = new CachedKeyDeriver(new PrivateKey(7))
const identityKey = keyDeriver.identityKey
const callbackToken = deriveArcadeCallbackToken(keyDeriver)

/** Stub main-process storage that records the Services it is given. */
function stubStorage() {
  const storage = { setServices: vi.fn() }
  vi.spyOn(storageManager, 'getOrCreateStorage').mockResolvedValue(storage as unknown as StorageKnex)
  return storage
}

const startConfigs = () => forked.flatMap(w => w.messages.filter(m => m.type === 'start').map(m => m.config!))

afterEach(async () => {
  await storageManager.cleanup()
  forked.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('main process', () => {
  test('broadcasts and starts the monitor with the token the renderer derived', async () => {
    const storage = stubStorage()

    await storageManager.initializeServices(identityKey, chain, undefined, callbackToken)

    const services = storage.setServices.mock.calls[0][0]
    expect(services.options.arcadeConfig.callbackToken).toBe(callbackToken)
    expect(startConfigs()).toEqual([expect.objectContaining({ identityKey, chain, callbackToken })])
  })

  test('restarts the monitor with the same token after storage is quiesced', async () => {
    stubStorage()
    await storageManager.initializeServices(identityKey, chain, undefined, callbackToken)

    await storageManager.quiesce(identityKey, chain, async () => {})

    expect(startConfigs().map(c => c.callbackToken)).toEqual([callbackToken, callbackToken])
  })

  test('starts over when the token changes', async () => {
    stubStorage()
    const other = deriveArcadeCallbackToken(new CachedKeyDeriver(new PrivateKey(8)))
    await storageManager.initializeServices(identityKey, chain, undefined, callbackToken)
    await storageManager.initializeServices(identityKey, chain, undefined, callbackToken)
    await storageManager.initializeServices(identityKey, chain, undefined, other)

    expect(startConfigs().map(c => c.callbackToken)).toEqual([callbackToken, other])
  })

  test('refuses to start services without a well-formed token', async () => {
    const storage = stubStorage()

    for (const bad of [undefined, '', identityKey, callbackToken.toUpperCase()]) {
      await expect(storageManager.initializeServices(identityKey, chain, undefined, bad as string), String(bad)).rejects.toThrow()
    }
    expect(storage.setServices).not.toHaveBeenCalled()
    expect(forked).toEqual([])
  })
})

describe('renderer', () => {
  test('hands the token to the main process when it initializes backend services', async () => {
    const initializeServices = vi.fn(async () => ({ success: true }))
    vi.stubGlobal('window', { electronAPI: { storage: { initializeServices } } })

    await new StorageElectronIPC(identityKey, chain, undefined, callbackToken).initializeBackendServices()

    expect(initializeServices).toHaveBeenCalledWith(identityKey, chain, undefined, callbackToken)
  })

  test('will not initialize backend services without a token', async () => {
    const initializeServices = vi.fn(async () => ({ success: true }))
    vi.stubGlobal('window', { electronAPI: { storage: { initializeServices } } })

    await expect(new StorageElectronIPC(identityKey, chain).initializeBackendServices()).rejects.toThrow()
    expect(initializeServices).not.toHaveBeenCalled()
  })
})
