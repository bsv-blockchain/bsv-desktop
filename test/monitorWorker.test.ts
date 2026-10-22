/**
 * electron/monitor-worker.ts tells its parent 'monitor-started' once the
 * Monitor's task loop is running. startTasks() returns only when the tasks
 * stop, so a message sent after awaiting it would arrive at stop, if at all,
 * and the parent offers BRC-177 noSend expiry only after it has arrived.
 *
 * The real worker module runs here, driven through the process handlers it
 * registers, with a stand-in Monitor whose task loop runs until stopTasks()
 * or until the test fails it. The toolbox, Arcade services and SSE wiring are
 * stand-ins too, so nothing opens a database or the network.
 */

import os from 'os'
import path from 'path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const loop = { started: false, ended: false, fail: (_error: Error) => {} }
/** The callback tokens the worker built its Services and its SSE wiring with. */
const tokens = { services: [] as unknown[], sse: [] as unknown[] }
/** The Services stand-ins the worker built, and every postBeef that reached them. */
const built = { services: [] as any[], posted: [] as string[][] }
const CALLBACK_TOKEN = '0123456789abcdef'.repeat(2)

vi.mock('@bsv/wallet-toolbox', () => ({
  StorageKnex: class { setServices() {} },
  WalletStorageManager: class { async addWalletStorageProvider() {} },
  Monitor: class {
    private end = () => {}
    addDefaultTasks() {}
    startTasks() {
      loop.started = true
      return new Promise<void>((resolve, reject) => {
        this.end = () => { loop.ended = true; resolve() }
        loop.fail = error => { loop.ended = true; reject(error) }
      })
    }
    async stopTasks() { this.end() }
    async fetchSSEEvents() {}
  }
}))
vi.mock('../electron/arcade', () => ({
  createArcadeServices: (_chain: string, callbackToken: unknown) => {
    tokens.services.push(callbackToken)
    const services = {
      options: { arcadeUrl: 'http://127.0.0.1:9' },
      postBeef: async (_beef: unknown, txids: string[]) => {
        built.posted.push([...txids])
        return [{ name: 'FakeArc', status: 'success', txidResults: txids.map(txid => ({ txid, status: 'success' })) }]
      }
    }
    built.services.push(services)
    return services
  }
}))
vi.mock('../electron/arcadeSse', () => ({
  arcadeSseCursorPath: () => path.join(os.tmpdir(), 'unused-cursor.json'),
  createArcadeMonitorOptions: (_chain: string, _storage: unknown, _services: unknown, wiring: { callbackToken: unknown }) => {
    tokens.sse.push(wiring.callbackToken)
    return {}
  },
  startArcadeSsePump: () => () => {},
  tolerateTransientArcadeRejections: () => true
}))

const workerMessages = new Set(['ready', 'monitor-started', 'monitor-error', 'monitor-stopped', 'tx-status-changed', 'color-held'])
const startMessage = {
  type: 'start',
  config: {
    identityKey: '02'.padEnd(66, '1'),
    chain: 'test',
    databasePath: path.join(os.tmpdir(), 'unused-monitor-worker.db'),
    feeRate: 100,
    sseCursorPath: path.join(os.tmpdir(), 'unused-cursor.json'),
    callbackToken: CALLBACK_TOKEN
  }
}

let restoreProcess = () => {}

beforeEach(() => {
  Object.assign(loop, { started: false, ended: false })
  Object.assign(tokens, { services: [], sse: [] })
  Object.assign(built, { services: [], posted: [] })
  vi.resetModules()
})

afterEach(() => {
  restoreProcess()
  vi.restoreAllMocks()
})

/**
 * Load a fresh copy of the worker module. Its handlers are kept off the test
 * runner's own process and IPC channel: they, and the worker's messages, are
 * captured, and everything else is passed on.
 */
async function loadWorker() {
  const handlers = new Map<string, (message?: any) => Promise<void>>()
  const on = process.on.bind(process)
  vi.spyOn(process, 'on').mockImplementation(((event: string, handler: any) => {
    if (['message', 'SIGTERM', 'SIGINT', 'disconnect'].includes(String(event))) handlers.set(String(event), handler)
    else on(event, handler)
    return process
  }) as typeof process.on)
  const sent: { type: string, error?: string, loopRunning: boolean }[] = []
  const send = process.send
  const connected = Object.getOwnPropertyDescriptor(process, 'connected')
  process.send = ((message: any, ...rest: any[]) => {
    if (!workerMessages.has(message?.type)) return send ? send.call(process, message, ...rest) : false
    sent.push({ type: message.type, ...(message.error ? { error: message.error } : {}), loopRunning: loop.started && !loop.ended })
    rest.find(arg => typeof arg === 'function')?.(null)
    return true
  }) as typeof process.send
  Object.defineProperty(process, 'connected', { configurable: true, value: true })
  restoreProcess = () => {
    if (send) process.send = send
    else delete (process as any).send
    if (connected) Object.defineProperty(process, 'connected', connected)
    else delete (process as any).connected
  }
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as typeof process.exit)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  await import('../electron/monitor-worker')
  expect(sent).toEqual([{ type: 'ready', loopRunning: false }])
  const handle = (message: unknown) => handlers.get('message')!(message)
  return { handle, sent, exit }
}

test('monitor-worker reports monitor-started while its task loop runs, not when it stops', async () => {
  const { handle, sent, exit } = await loadWorker()

  const running = handle(startMessage)

  await vi.waitFor(() => expect(sent.map(m => m.type)).toContain('monitor-started'), { timeout: 5000 })
  expect(sent[1]).toEqual({ type: 'monitor-started', loopRunning: true })

  await handle({ type: 'stop' })
  await running
  expect(loop.ended).toBe(true)
  expect(sent.map(m => m.type)).toEqual(['ready', 'monitor-started', 'monitor-stopped'])
  expect(exit).toHaveBeenCalledWith(0)
})

test('monitor-worker reports monitor-error and exits 1 when its running task loop fails', async () => {
  const { handle, sent, exit } = await loadWorker()

  const running = handle(startMessage)
  await vi.waitFor(() => expect(sent.map(m => m.type)).toContain('monitor-started'), { timeout: 5000 })
  expect(exit).not.toHaveBeenCalled()

  loop.fail(new Error('task loop failed'))
  await running

  expect(sent.map(m => m.type)).toEqual(['ready', 'monitor-started', 'monitor-error'])
  expect(sent[2]).toMatchObject({ error: 'task loop failed' })
  expect(exit).toHaveBeenCalledWith(1)
})

test('monitor-worker broadcasts and subscribes with the callback token it is started with', async () => {
  const { handle, sent } = await loadWorker()

  const running = handle(startMessage)
  await vi.waitFor(() => expect(sent.map(m => m.type)).toContain('monitor-started'), { timeout: 5000 })

  expect(tokens).toEqual({ services: [CALLBACK_TOKEN], sse: [CALLBACK_TOKEN] })

  await handle({ type: 'stop' })
  await running
})

test('monitor-worker withholds an unreleased 1Color tx from its broadcasters (contract §8.2)', async () => {
  const fs = await import('fs')
  const { Beef, P2PKH, Transaction, UnlockingScript } = await import('@bsv/sdk')
  const { OneColor } = await import('@bsv/templates')
  const { ColorGuardJournal } = await import('../electron/colorBroadcastGuard')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-desktop-worker-guard-'))
  try {
    const { handle, sent } = await loadWorker()
    const config = { ...startMessage.config, colorGuardRoot: root }
    const running = handle({ type: 'start', config })
    await vi.waitFor(() => expect(sent.map(m => m.type)).toContain('monitor-started'), { timeout: 5000 })

    const pkh = new Array(20).fill(3)
    const mk = (locking: any) => {
      const tx = new Transaction()
      tx.addInput({ sourceTXID: 'cd'.repeat(32), sourceOutputIndex: 0, unlockingScript: new UnlockingScript(), sequence: 0xffffffff })
      tx.addOutput({ lockingScript: locking, satoshis: 1 })
      return tx
    }
    const T = mk(new OneColor().lock('ef'.repeat(32) + '_0', 5n, pkh))
    const P = mk(new P2PKH().lock(pkh))
    const beef = new Beef()
    beef.mergeTransaction(T)
    beef.mergeTransaction(P)
    const rs = await built.services[0].postBeef(beef, [T.id('hex'), P.id('hex')])
    expect(built.posted).toEqual([[P.id('hex')]])
    expect(rs[0].txidResults).toContainEqual({ txid: T.id('hex'), status: 'error', serviceError: true })
    expect(await new ColorGuardJournal({ root }).held(config.identityKey, 'test')).toEqual([T.id('hex')])
    expect(sent.map(m => m.type)).toContain('color-held')

    await handle({ type: 'stop' })
    await running
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
