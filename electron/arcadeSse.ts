/**
 * Arcade SSE status events for the monitor worker, wired the way bsv-wallet
 * wires them (packages/expo-wallet-toolbox/core/context/WalletContext.tsx).
 *
 * The toolbox's TaskArcadeSSE subscribes to `GET {arcadeUrl}/events?callbackToken=…`
 * and applies each status event to storage as it arrives: accepted, mined (the
 * proof is fetched at once), double-spent, rejected. It stays disabled unless
 * three things are present together — `arcadeUrl` on the Services, a callback
 * token on the Monitor equal to the one broadcasts carry, and an EventSource
 * class — and says so only in the monitor event log. Without it, a status
 * change waits for a polling task to notice it.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { EventSource } from 'eventsource'
import { Monitor, type MonitorOptions, type Services, type WalletStorageManager } from '@bsv/wallet-toolbox'

/**
 * A MessageEvent as react-native-sse delivers one: `data` and `lastEventId` as
 * own data properties. ArcSSEClient reads them only that way, and a DOM
 * MessageEvent keeps them behind prototype getters, so without this every
 * status event reads as empty and the client drops the stream.
 */
function asPlainEvent(event: Event): unknown {
  if (!('data' in event)) return event
  const message = event as MessageEvent
  return { type: message.type, data: message.data, lastEventId: message.lastEventId, origin: message.origin }
}

const plainListeners = new WeakMap<(...args: any[]) => unknown, (event: Event) => void>()

/**
 * EventSource shaped like react-native-sse's, which is what the toolbox's
 * ArcSSEClient was written against: `new EventSource(url, { headers })`, and
 * events as plain objects ({@link asPlainEvent}). The `eventsource` package
 * takes request headers through a custom fetch instead, so they are applied
 * there; headers it sets itself (`Accept`, and `Last-Event-ID` on its own
 * reconnects) take precedence.
 */
export class ArcadeEventSource extends EventSource {
  constructor(url: string | URL, options: { headers?: Record<string, string> } = {}) {
    const headers = { ...(options.headers ?? {}) }
    super(url, {
      fetch: (input, init) =>
        fetch(input, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } }) as any
    })
  }

  addEventListener(type: any, listener: any, options?: any): void {
    if (typeof listener !== 'function') return super.addEventListener(type, listener, options)
    let plain = plainListeners.get(listener)
    if (!plain) {
      plain = (event: Event) => listener.call(this, asPlainEvent(event))
      plainListeners.set(listener, plain)
    }
    super.addEventListener(type, plain, options)
  }

  removeEventListener(type: any, listener: any, options?: any): void {
    super.removeEventListener(type, (typeof listener === 'function' && plainListeners.get(listener)) || listener, options)
  }
}

/** Where a wallet's SSE resume cursor lives: one small file per identity and chain. */
export function arcadeSseCursorPath(
  identityKey: string,
  chain: string,
  directory = path.join(os.homedir(), '.bsv-desktop', 'arcade-sse')
): string {
  return path.join(directory, `${identityKey}-${chain}.json`)
}

/**
 * Rename over an existing file. Node replaces the destination on every platform
 * (libuv uses MoveFileExW with MOVEFILE_REPLACE_EXISTING on Windows), but
 * Windows refuses briefly with EPERM/EACCES/EBUSY while another process — an
 * antivirus scanner, the search indexer — holds the file open. Those are
 * retried a few times; anything else fails at once.
 */
export async function renameReplacing(from: string, to: string, attempts = 6): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.promises.rename(from, to)
      return
    } catch (error: any) {
      if (attempt >= attempts || !['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)) throw error
      await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt))
    }
  }
}

/**
 * Persists the id of the last status event applied, so a restart resumes the
 * stream rather than replaying it. bsv-wallet keeps the same value in its wallet
 * store; a missing or unreadable file only costs a replay, which the task
 * applies idempotently.
 */
export function createSseCursorStore(filePath: string): {
  load: () => Promise<string | undefined>
  save: (lastEventId: string) => Promise<void>
} {
  // TaskArcadeSSE awaits each save before acknowledging the next event, but the
  // store does not rely on that: saves run one at a time, in call order, so
  // overlapping calls can neither collide on the temp file nor move the cursor
  // backwards.
  let writes: Promise<void> = Promise.resolve()
  const write = async (lastEventId: string): Promise<void> => {
    // Written aside and renamed, so a crash mid-write cannot leave a torn cursor.
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    const pending = `${filePath}.${process.pid}.tmp`
    await fs.promises.writeFile(pending, JSON.stringify({ lastEventId }))
    await renameReplacing(pending, filePath)
  }
  return {
    load: async () => {
      try {
        const id = JSON.parse(await fs.promises.readFile(filePath, 'utf8'))?.lastEventId
        return typeof id === 'string' && id !== '' ? id : undefined
      } catch {
        return undefined
      }
    },
    save: lastEventId => {
      const saved = writes.then(() => write(lastEventId))
      // A failed write rejects its own caller only; later saves still run.
      writes = saved.catch(() => {})
      return saved
    }
  }
}

export interface ArcadeSseWiring {
  /** Must equal the `arcadeConfig.callbackToken` every broadcast carries. */
  callbackToken: string
  cursorPath: string
  /** Told of every transaction status change the monitor sees, from SSE or polling. */
  onStatusChanged?: (txid: string, status: string) => void
}

/** Enable TaskArcadeSSE on monitor options (before `new Monitor`). */
export function configureArcadeSSE(options: MonitorOptions, wiring: ArcadeSseWiring): void {
  const cursor = createSseCursorStore(wiring.cursorPath)
  options.callbackToken = wiring.callbackToken
  options.EventSourceClass = ArcadeEventSource
  options.loadLastSSEEventId = cursor.load
  options.saveLastSSEEventId = cursor.save

  const notify = wiring.onStatusChanged
  if (notify == null) return
  const tell = (txid: string | undefined, status: string): void => {
    if (typeof txid !== 'string' || txid === '') return
    try { notify(txid, status) } catch { /* a listener cannot break the monitor */ }
  }
  options.onTransactionStatusChanged = async (txid, status) => tell(txid, status)
  options.onTransactionProven = async proven => tell(proven?.txid, 'proven')
  options.onTransactionBroadcasted = async result => tell(result?.txid, result?.status ?? 'broadcast')
}

/**
 * Monitor options for one wallet with Arcade SSE enabled.
 *
 * The services go into the toolbox factory rather than being assigned
 * afterwards: it also copies their ChainTracks client into `options.chaintracks`,
 * which TaskNewHeader, TaskCheckForProofs and TaskArcadeSSE read directly. Left
 * out, it builds a throwaway default Services and the monitor tracks headers
 * through a client nothing here configured. (bsv-wallet passes its services too.)
 */
export function createArcadeMonitorOptions(
  chain: 'main' | 'test' | 'ttn',
  storageManager: WalletStorageManager,
  services: Services,
  wiring: ArcadeSseWiring
): MonitorOptions {
  const options = Monitor.createDefaultWalletMonitorOptions(chain, storageManager, services)
  configureArcadeSSE(options, wiring)
  return options
}

/**
 * Arcade also answers REJECTED for its own infrastructure failures (a 503 "no
 * available server"). The toolbox reads any REJECTED that carries a reason as
 * terminal, which would fail a transaction that was never judged. bsv-wallet
 * patches the task for the same reason, but there it ignores every REJECTED;
 * here only an infrastructure failure is let through, so a rejection on the
 * transaction's merits still fails it.
 */
export function isTransientArcadeRejection(event: { txStatus?: string, status?: number, extraInfo?: string }): boolean {
  if (event?.txStatus !== 'REJECTED') return false
  const status = Number(event.status)
  if (Number.isFinite(status) && (status >= 500 || status === 408 || status === 429)) return true
  return /no available server|service unavailable|temporarily unavailable/i.test(event.extraInfo ?? '')
}

/** Install {@link isTransientArcadeRejection} on the monitor's ArcadeSSE task. */
export function tolerateTransientArcadeRejections(monitor: Monitor): boolean {
  const task = monitor._tasks.find(t => t.name === 'ArcadeSSE') as any
  if (typeof task?.classifyRejection !== 'function') return false
  const classify = task.classifyRejection.bind(task)
  task.classifyRejection = (event: any) =>
    isTransientArcadeRejection(event)
      ? { terminal: false, inputConflict: false, reqStatus: 'invalid', reason: 'Arcade reported an infrastructure failure' }
      : classify(event)
  return true
}

/**
 * The SSE client does not reconnect after an error; `monitor.fetchSSEEvents()`
 * reopens a closed stream and does nothing to an open one. bsv-wallet calls it
 * when the app returns to the foreground. A desktop app is never backgrounded,
 * so the worker calls it on a timer too (and the main process asks for it on
 * window focus and system resume).
 */
export function startArcadeSsePump(monitor: Pick<Monitor, 'fetchSSEEvents'>, intervalMs = 30_000): () => void {
  const timer = setInterval(() => {
    monitor.fetchSSEEvents().catch(() => { /* the next tick retries */ })
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
