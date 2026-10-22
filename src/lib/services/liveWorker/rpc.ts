/**
 * One end of the live payments worker's port (see protocol.ts): requests with replies, and
 * one-way events, over a MessagePort (a browser one in the app, Node's in the tests).
 *
 * Each side answers only the operations it registers. Requests from the other side are
 * bounded ({@link MAX_INCOMING}), and anything malformed is dropped. Closing the endpoint (or
 * the port) rejects every request still waiting.
 */
import { isSerializedError, serializeError } from './protocol'
import type { Message, SerializedError } from './protocol'

/** The part of a MessagePort this uses (browser and Node ports both have it). */
export interface PortLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener?(type: 'message', listener: (event: { data: unknown }) => void): void
  start?(): void
  close(): void
}

/** Requests from the other side being handled at once, at most; more are refused. */
export const MAX_INCOMING = 256

export class EndpointClosed extends Error {
  constructor(message = 'The live payments worker is not running') {
    super(message)
    this.name = 'EndpointClosed'
  }
}

/** The other side did not answer a request in time: it may be hung. */
export class Timeout extends Error {
  constructor(readonly op: string) {
    super(`The live payments worker did not answer (${op})`)
    this.name = 'Timeout'
  }
}

/** A request the other side failed: its error, as it crossed. */
export class RemoteError extends Error {
  constructor(readonly remote: SerializedError) {
    super(remote.message)
    this.name = remote.name
  }
}

export type RequestHandler = (msg: Record<string, unknown>) => unknown | Promise<unknown>
export type EventHandler = (msg: Record<string, unknown>) => void

export class Endpoint {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  private incoming = 0
  private closed = false
  private readonly onClose = new Set<() => void>()
  private readonly listener = (event: { data: unknown }) => this.receive(event.data)

  constructor(
    private readonly port: PortLike,
    private readonly requests: Record<string, RequestHandler>,
    private readonly events: Record<string, EventHandler> = {}
  ) {
    port.addEventListener('message', this.listener)
    port.start?.()
  }

  get isClosed(): boolean {
    return this.closed
  }

  /**
   * Asks the other side; rejects with its error, or {@link EndpointClosed} when this endpoint
   * closes first. With `timeoutMs`, a reply that takes longer rejects with {@link Timeout}
   * (a late reply is then ignored).
   */
  request<T = unknown>(op: string, fields: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    if (this.closed) return Promise.reject(new EndpointClosed())
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
        if (this.pending.delete(id)) reject(new Timeout(op))
      }, timeoutMs)
      const settle = <A>(fn: (a: A) => void) => (a: A) => { clearTimeout(timer); fn(a) }
      this.pending.set(id, { resolve: settle(resolve as (v: unknown) => void), reject: settle(reject) })
      this.post({ ...fields, t: 'req', id, op })
    })
  }

  /** Tells the other side; nothing comes back. Does nothing once closed. */
  emit(op: string, fields: Record<string, unknown> = {}): void {
    if (!this.closed) this.post({ ...fields, t: 'ev', op })
  }

  /** Runs `fn` once, when this endpoint closes. */
  whenClosed(fn: () => void): () => void {
    if (this.closed) {
      fn()
      return () => {}
    }
    this.onClose.add(fn)
    return () => this.onClose.delete(fn)
  }

  /** Stops: every waiting request rejects with `reason`, and the port closes. */
  close(reason: Error = new EndpointClosed()): void {
    if (this.closed) return
    this.closed = true
    this.port.removeEventListener?.('message', this.listener)
    for (const p of this.pending.values()) p.reject(reason)
    this.pending.clear()
    try { this.port.close() } catch { /* already closed */ }
    for (const fn of [...this.onClose]) {
      try { fn() } catch { /* a close hook must not stop the others */ }
    }
    this.onClose.clear()
  }

  private post(msg: Message): void {
    try {
      this.port.postMessage(msg)
    } catch (e) {
      this.close(e instanceof Error ? e : new EndpointClosed())
    }
  }

  private receive(data: unknown): void {
    if (this.closed || typeof data !== 'object' || data === null || Array.isArray(data)) return
    const msg = data as Record<string, unknown>
    if (msg.t === 'res') return this.settle(msg)
    if (typeof msg.op !== 'string') return
    if (msg.t === 'ev') {
      const handler = Object.prototype.hasOwnProperty.call(this.events, msg.op) ? this.events[msg.op] : undefined
      try { handler?.(msg) } catch (e) { console.warn('[live worker] event handler failed:', msg.op, e) }
      return
    }
    if (msg.t !== 'req' || typeof msg.id !== 'number' || !Number.isSafeInteger(msg.id)) return
    const id = msg.id
    const handler = Object.prototype.hasOwnProperty.call(this.requests, msg.op) ? this.requests[msg.op] : undefined
    if (!handler) return this.post({ t: 'res', id, ok: false, error: { name: 'Refused', message: `unknown operation ${msg.op.slice(0, 40)}` } })
    if (this.incoming >= MAX_INCOMING) return this.post({ t: 'res', id, ok: false, error: { name: 'Refused', message: 'too many requests at once' } })
    this.incoming++
    Promise.resolve()
      .then(() => handler(msg))
      .then(
        value => this.post({ t: 'res', id, ok: true, value }),
        e => this.post({ t: 'res', id, ok: false, error: serializeError(e) })
      )
      .finally(() => { this.incoming-- })
  }

  private settle(msg: Record<string, unknown>): void {
    if (typeof msg.id !== 'number') return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.ok === true) p.resolve(msg.value)
    else p.reject(new RemoteError(isSerializedError(msg.error) ? msg.error : { name: 'Error', message: 'The request failed' }))
  }
}
