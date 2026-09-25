import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArcSSEClient, Monitor, WalletStorageManager } from '@bsv/wallet-toolbox'
import { arcadeCallbackToken, createArcadeServices } from '../electron/arcade'
import {
  ArcadeEventSource,
  arcadeSseCursorPath,
  createArcadeMonitorOptions,
  createSseCursorStore,
  isTransientArcadeRejection,
  startArcadeSsePump,
  tolerateTransientArcadeRejections
} from '../electron/arcadeSse'
import { arcadeUrl } from '../electron/endpoints'

const IDENTITY_KEY = '03' + 'cd'.repeat(32)
const TOKEN = IDENTITY_KEY.substring(0, 32)
const TXID = 'ab'.repeat(32)

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-sse-')) })
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** A fetch that answers with an SSE stream carrying `frames` and then stays open. */
function mockSseFetch(frames: string) {
  const fn = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(
    new ReadableStream({ start: c => c.enqueue(new TextEncoder().encode(frames)) }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  ))
  vi.stubGlobal('fetch', fn)
  return fn
}

function statusFrame(id: string, payload: Record<string, unknown>) {
  return `event: status\nid: ${id}\ndata: ${JSON.stringify(payload)}\n\n`
}

/** A Monitor wired the way monitor-worker.ts wires it, without storage or a running loop. */
function wiredMonitor(chain: 'main' | 'test' | 'ttn', onStatusChanged = vi.fn()) {
  const services = createArcadeServices(chain, IDENTITY_KEY)
  const options = createArcadeMonitorOptions(chain, new WalletStorageManager(IDENTITY_KEY), services, {
    callbackToken: arcadeCallbackToken(IDENTITY_KEY),
    cursorPath: path.join(tmp, 'cursor.json'),
    onStatusChanged
  })
  const monitor = new Monitor(options)
  monitor.addDefaultTasks()
  return { monitor, options, services, onStatusChanged }
}

describe('ArcadeEventSource with the toolbox ArcSSEClient', () => {
  it('sends the resume cursor and delivers status events in order', async () => {
    const fetchMock = mockSseFetch(
      statusFrame('7', { txid: TXID, txStatus: 'SEEN_ON_NETWORK', timestamp: '2026-09-24T00:00:00Z' }) +
      statusFrame('8', { txid: TXID, txStatus: 'MINED', timestamp: '2026-09-24T00:10:00Z', blockHeight: 968250 })
    )
    const events: any[] = []
    const client = new ArcSSEClient({
      baseUrl: arcadeUrl('main'),
      callbackToken: TOKEN,
      lastEventId: '6',
      EventSourceClass: ArcadeEventSource,
      onEvent: async (event: any) => { events.push(event) }
    })

    client.connect()
    await vi.waitFor(() => expect(events).toHaveLength(2))
    client.close()

    const [url, init] = fetchMock.mock.calls[0] as [unknown, RequestInit]
    expect(String(url)).toBe(`${arcadeUrl('main')}/events?callbackToken=${TOKEN}`)
    const headers = init.headers as Record<string, string>
    expect(headers['Last-Event-ID']).toBe('6')
    expect(headers.Accept).toBe('text/event-stream')
    expect(events.map(e => [e.eventId, e.txStatus])).toEqual([['7', 'SEEN_ON_NETWORK'], ['8', 'MINED']])
    expect(client.lastEventId).toBe('8')
  })
})

describe('TaskArcadeSSE, wired as the monitor worker wires it', () => {
  it('passes all three of its setup gates and subscribes to this wallet\'s stream', async () => {
    for (const chain of ['main', 'test', 'ttn'] as const) {
      const fetchMock = mockSseFetch('')
      const { monitor } = wiredMonitor(chain)
      const task = monitor._tasks.find(t => t.name === 'ArcadeSSE') as any

      await task.asyncSetup()

      expect(task.sseClient, chain).not.toBeNull()
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
      expect(String(fetchMock.mock.calls[0][0]), chain).toBe(`${arcadeUrl(chain)}/events?callbackToken=${TOKEN}`)
      task.close()
      vi.unstubAllGlobals()
    }
  })

  it('tracks headers through the same ChainTracks client as the wallet\'s Services', () => {
    for (const chain of ['main', 'test', 'ttn'] as const) {
      const { monitor, services } = wiredMonitor(chain)
      expect(monitor.services, chain).toBe(services)
      // TaskNewHeader and TaskCheckForProofs read monitor.chaintracks directly.
      expect(monitor.chaintracks, chain).toBe(services.options.chaintracks)
    }
  })

  it('uses the same callback token the broadcasts carry', () => {
    const { monitor, options } = wiredMonitor('main')
    expect(options.callbackToken).toBe(TOKEN)
    expect((monitor.services.options.arcadeConfig as any).callbackToken).toBe(options.callbackToken)
  })

  it('resumes from the persisted cursor', async () => {
    await createSseCursorStore(path.join(tmp, 'cursor.json')).save('41')
    const fetchMock = mockSseFetch('')
    const { monitor } = wiredMonitor('main')
    const task = monitor._tasks.find(t => t.name === 'ArcadeSSE') as any

    await task.asyncSetup()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    task.close()

    expect((fetchMock.mock.calls[0][1] as any).headers['Last-Event-ID']).toBe('41')
  })
})

describe('configureArcadeSSE status notifications', () => {
  it('reports status changes, proofs and broadcasts', async () => {
    const { options, onStatusChanged } = wiredMonitor('main')
    await options.onTransactionStatusChanged!(TXID, 'SEEN_ON_NETWORK')
    await options.onTransactionProven!({ txid: TXID } as any)
    await options.onTransactionBroadcasted!({ txid: TXID, status: 'success' } as any)
    expect(onStatusChanged.mock.calls).toEqual([[TXID, 'SEEN_ON_NETWORK'], [TXID, 'proven'], [TXID, 'success']])
  })

  it('never lets a listener break the monitor, and ignores events without a txid', async () => {
    const { options } = wiredMonitor('main', vi.fn(() => { throw new Error('boom') }))
    await expect(options.onTransactionStatusChanged!(TXID, 'MINED')).resolves.toBeUndefined()
    await expect(options.onTransactionProven!({} as any)).resolves.toBeUndefined()
  })
})

describe('createSseCursorStore', () => {
  it('round-trips the last event id, creating its directory', async () => {
    const store = createSseCursorStore(path.join(tmp, 'nested', 'cursor.json'))
    expect(await store.load()).toBeUndefined()
    await store.save('123')
    await store.save('124')
    expect(await store.load()).toBe('124')
    expect(fs.readdirSync(path.join(tmp, 'nested'))).toEqual(['cursor.json'])
  })

  it('treats an unreadable cursor as none (a replay, which the task applies idempotently)', async () => {
    const file = path.join(tmp, 'cursor.json')
    fs.writeFileSync(file, '{not json')
    expect(await createSseCursorStore(file).load()).toBeUndefined()
  })

  it('keeps one cursor per identity and chain', () => {
    const a = arcadeSseCursorPath(IDENTITY_KEY, 'main', tmp)
    expect(a).toBe(path.join(tmp, `${IDENTITY_KEY}-main.json`))
    expect(arcadeSseCursorPath(IDENTITY_KEY, 'test', tmp)).not.toBe(a)
  })
})

describe('transient Arcade rejections', () => {
  it('recognises Arcade infrastructure failures, and only those', () => {
    expect(isTransientArcadeRejection({ txStatus: 'REJECTED', status: 503, extraInfo: 'no available server' })).toBe(true)
    expect(isTransientArcadeRejection({ txStatus: 'REJECTED', extraInfo: 'No available server' })).toBe(true)
    expect(isTransientArcadeRejection({ txStatus: 'REJECTED', status: 429 })).toBe(true)
    expect(isTransientArcadeRejection({ txStatus: 'REJECTED', status: 461, extraInfo: 'script verification failed' })).toBe(false)
    expect(isTransientArcadeRejection({ txStatus: 'REJECTED', extraInfo: 'missing inputs' })).toBe(false)
    expect(isTransientArcadeRejection({ txStatus: 'SEEN_ON_NETWORK', status: 503 })).toBe(false)
  })

  it('keeps the task from failing a transaction Arcade never judged', () => {
    const { monitor } = wiredMonitor('main')
    const task = monitor._tasks.find(t => t.name === 'ArcadeSSE') as any
    const before = task.classifyRejection({ txid: TXID, txStatus: 'REJECTED', status: 503, extraInfo: 'no available server' })
    expect(before.terminal).toBe(true)

    expect(tolerateTransientArcadeRejections(monitor)).toBe(true)

    expect(task.classifyRejection({ txid: TXID, txStatus: 'REJECTED', status: 503, extraInfo: 'no available server' }).terminal).toBe(false)
    expect(task.classifyRejection({ txid: TXID, txStatus: 'REJECTED', status: 461, extraInfo: 'script verification failed' }).terminal).toBe(true)
  })
})

describe('startArcadeSsePump', () => {
  it('asks the monitor to reopen a dropped stream on every tick, until stopped', async () => {
    vi.useFakeTimers()
    const monitor = { fetchSSEEvents: vi.fn(async () => 0) }
    const stop = startArcadeSsePump(monitor, 1000)
    await vi.advanceTimersByTimeAsync(3000)
    expect(monitor.fetchSSEEvents).toHaveBeenCalledTimes(3)
    stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(monitor.fetchSSEEvents).toHaveBeenCalledTimes(3)
  })

  it('survives a failed reconnect', async () => {
    vi.useFakeTimers()
    const monitor = { fetchSSEEvents: vi.fn(async () => { throw new Error('offline') }) }
    const stop = startArcadeSsePump(monitor, 1000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(monitor.fetchSSEEvents).toHaveBeenCalledTimes(2)
    stop()
  })
})
