/**
 * The wallet window's side of the live payments worker (see protocol.ts): a DirectPayClient
 * whose WebRTC runs in the worker. It takes the options DirectPayManager gives
 * @bsv/webrtpay's DirectPayClient and offers the methods the app calls on one
 * (startReceiving, stopReceiving, connect, sendPayment, close), so the manager and
 * deliverDirect are unchanged.
 *
 * What stays here: the wallet (the worker asks for five checked calls), the signaler (the
 * worker asks to send envelopes and to listen), the ICE server provider, and the payment
 * handlers (the worker hands each payment here, where it is checked and taken).
 *
 * The worker starts with the first client, through {@link LiveWorkerLink}, and stops a while
 * after the last one closes. When it dies (a crash, or the OS ended it), every connection in
 * it ends, its signal subscriptions here are cancelled, and the link starts a new one for the
 * clients still open: each is made again there and receives again if it was receiving.
 */
import { WebRTPayError } from '@bsv/webrtpay'
import type { AuthenticatedPeer, DialOptions, IncomingPayment, PaymentAck, PaymentDecision, PaymentTokenInput, ReceiveHandlers, Signaler, WebRTPayErrorCode } from '@bsv/webrtpay'
import { Endpoint, EndpointClosed, RemoteError, Timeout } from './rpc'
import type { PortLike } from './rpc'
import { checkEnvelope, checkIncomingPayment, checkWalletCall, isIdentityKey, Refused, walletReply } from './protocol'
import type { ClientSpec } from './protocol'

/** Most signal subscriptions the worker may hold for one client (webrtpay holds one). */
const MAX_LISTENS_PER_CLIENT = 4
/** How long the worker runs on after its last client closes, so a relaunch reuses it. */
export const IDLE_STOP_MS = 10_000
/** Restarts after a crash allowed per {@link RESTART_WINDOW_MS}; then the clients stay closed. */
const MAX_RESTARTS = 3
const RESTART_WINDOW_MS = 60_000
/**
 * How long the worker may take to answer an operation that does no network work (make a
 * client, start or stop receiving, close). A worker that takes longer is hung: it is stopped
 * and started again, as when it dies.
 */
export const CONTROL_TIMEOUT_MS = 10_000
/** Added to a dial's or a payment's own time limit before the worker counts as hung. */
const MARGIN_MS = 5_000
/** webrtpay's default dial and acknowledgement limits (DEFAULTS.connectTimeoutMs, ackTimeoutMs). */
const DEFAULT_DIAL_MS = 30_000
const DEFAULT_ACK_MS = 45_000

/** The DirectPayClient options DirectPayManager passes (functions and the wallet stay here). */
export interface RemoteClientOptions {
  wallet: unknown
  originator?: string
  chain?: string
  signaler?: Signaler
  rtc?: { iceServers?: RTCIceServer[] }
  iceServersProvider?: () => Promise<RTCIceServer[]>
  onIceServersProviderError?: (e: unknown) => void
  timeouts?: ClientSpec['timeouts']
  maxMessageBytes?: number
  limits?: { maxMessageBytes?: number }
  /** Largest transaction a payment from the worker may carry; the default is 1 MB. */
  maxTransactionBytes?: number
}

/** How the link opens a port to a new worker, and learns that it died. */
export interface WorkerLauncher {
  /** Starts a worker (or reuses the one running) and resolves with a port to it. */
  open(): Promise<PortLike>
  /** Stops the worker. */
  close(): Promise<void> | void
  /** Calls `fn` when the worker dies; returns the unsubscribe. */
  onGone?(fn: () => void): () => void
}

type WalletMethods = Record<string, (args: unknown, originator?: string) => Promise<unknown>>

interface ClientState {
  cid: number
  options: RemoteClientOptions
  handlers: ReceiveHandlers | undefined
  /** Signal subscriptions the worker holds, by its listen id: their unsubscribes here. */
  listens: Map<number, Promise<() => Promise<void>>>
  peers: Set<RemotePeer>
  /** Made on the current worker: the promise of its `create`. */
  ready: Promise<void> | undefined
  closed: boolean
}

/** One worker, and the clients made on it. Shared by every RemoteDirectPayClient of a launcher. */
export class LiveWorkerLink {
  private endpoint: Endpoint | undefined
  private connecting: Promise<Endpoint> | undefined
  private readonly clients = new Map<number, ClientState>()
  private readonly peers = new Map<number, RemotePeer>()
  private nextClient = 1
  private nextDial = 1
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private restarts: number[] = []
  private stopping = false

  constructor(private readonly launcher: WorkerLauncher, private readonly defaultMaxTransactionBytes: number) {
    launcher.onGone?.(() => this.endpoint?.close(new EndpointClosed('The live payments worker stopped')))
  }

  /** @internal */
  register(options: RemoteClientOptions): ClientState {
    clearTimeout(this.idleTimer)
    const state: ClientState = { cid: this.nextClient++, options, handlers: undefined, listens: new Map(), peers: new Set(), ready: undefined, closed: false }
    this.clients.set(state.cid, state)
    this.begin(state)
    return state
  }

  /** @internal The worker's endpoint, with `state` made on it. */
  async on(state: ClientState): Promise<Endpoint> {
    if (state.closed) throw new WebRTPayError('closed', 'The client is closed')
    const endpoint = await this.connect()
    await (state.ready ?? this.begin(state))
    return endpoint
  }

  /** @internal */
  nextDialId(): number {
    return this.nextDial++
  }

  /** @internal */
  async release(state: ClientState): Promise<void> {
    if (state.closed) return
    state.closed = true
    this.clients.delete(state.cid)
    for (const peer of state.peers) peer.ended()
    await this.cancelListens(state)
    if (this.endpoint && !this.endpoint.isClosed) await this.call(this.endpoint, 'close', { cid: state.cid }).catch(() => {})
    if (this.clients.size === 0) {
      clearTimeout(this.idleTimer)
      this.idleTimer = setTimeout(() => this.stop(), IDLE_STOP_MS)
    }
  }

  /** @internal */
  track(state: ClientState, pid: number, peer: RemotePeer): void {
    this.peers.set(pid, peer)
    state.peers.add(peer)
    peer.whenEnded(() => {
      this.peers.delete(pid)
      state.peers.delete(peer)
    })
  }

  private stop(): void {
    if (this.clients.size > 0) return
    this.stopping = true
    this.endpoint?.close()
    this.endpoint = undefined
    void Promise.resolve(this.launcher.close()).catch(() => {}).finally(() => { this.stopping = false })
  }

  /** Makes `state` on the worker; its `ready`. A failure is the caller's to see, never unhandled. */
  private begin(state: ClientState): Promise<void> {
    const ready = this.make(state)
    ready.catch(() => {})
    state.ready = ready
    return ready
  }

  private async make(state: ClientState): Promise<void> {
    const endpoint = await this.connect()
    const o = state.options
    const spec: ClientSpec = {
      chain: o.chain,
      signaler: o.signaler !== undefined,
      iceServers: copyIceServers(o.rtc?.iceServers ?? []),
      iceProvider: typeof o.iceServersProvider === 'function',
      ...(o.timeouts && { timeouts: { ...o.timeouts } }),
      ...(o.maxMessageBytes !== undefined && { maxMessageBytes: o.maxMessageBytes }),
      ...(o.limits && { limits: { ...o.limits } })
    }
    await this.control(endpoint, 'create', { cid: state.cid, spec })
    if (state.handlers) await this.control(endpoint, 'startReceiving', { cid: state.cid })
  }

  /**
   * A request to the worker with a time limit, as a WebRTPayError when it fails. A worker that
   * does not answer in time is hung: it is stopped and started again for the open clients.
   */
  async call<T = unknown>(endpoint: Endpoint, op: string, fields: Record<string, unknown>, timeoutMs = CONTROL_TIMEOUT_MS): Promise<T> {
    try {
      return await endpoint.request<T>(op, fields, timeoutMs)
    } catch (e) {
      if (e instanceof Timeout) this.hung(endpoint)
      throw errorFrom(e instanceof RemoteError ? e.remote : e)
    }
  }

  private control(endpoint: Endpoint, op: string, fields: Record<string, unknown>): Promise<unknown> {
    return this.call(endpoint, op, fields)
  }

  /** The worker stopped answering: stop it, then lose it (which starts a new one for the open clients). */
  private hung(endpoint: Endpoint): void {
    if (endpoint.isClosed || this.endpoint !== endpoint) return
    console.warn('[live worker] not answering; stopping it')
    void Promise.resolve(this.launcher.close())
      .catch(() => {})
      .finally(() => endpoint.close(new EndpointClosed('The live payments worker stopped answering')))
  }

  private connect(): Promise<Endpoint> {
    if (this.endpoint && !this.endpoint.isClosed) return Promise.resolve(this.endpoint)
    this.connecting ??= this.launcher.open().then(
      port => {
        this.connecting = undefined
        const endpoint = this.serve(port)
        this.endpoint = endpoint
        endpoint.whenClosed(() => this.lost(endpoint))
        return endpoint
      },
      e => {
        this.connecting = undefined
        throw new WebRTPayError('unavailable', `The live payments worker did not start: ${e instanceof Error ? e.message : String(e)}`)
      }
    )
    return this.connecting
  }

  /** The worker is gone: end what lived in it, and start the clients over on a new one. */
  private lost(endpoint: Endpoint): void {
    if (this.endpoint === endpoint) this.endpoint = undefined
    for (const peer of [...this.peers.values()]) peer.ended()
    const clients = [...this.clients.values()]
    for (const state of clients) {
      state.ready = undefined
      void this.cancelListens(state)
    }
    if (this.stopping || clients.length === 0) return
    const now = Date.now()
    this.restarts = this.restarts.filter(t => now - t < RESTART_WINDOW_MS)
    if (this.restarts.length >= MAX_RESTARTS) {
      console.warn('[live worker] stopped too often; live payments stay off until the next start')
      for (const state of clients) state.handlers?.onError?.(new WebRTPayError('closed', 'The live payments worker keeps stopping'))
      return
    }
    this.restarts.push(now)
    console.warn('[live worker] stopped; starting it again')
    for (const state of clients) this.begin(state).catch(e => console.warn('[live worker] could not start a client again:', e))
  }

  private async cancelListens(state: ClientState): Promise<void> {
    const listens = [...state.listens.values()]
    state.listens.clear()
    await Promise.allSettled(listens.map(async l => (await l)()))
  }

  /** The wallet window's answers to the worker. Everything the worker sends is checked. */
  private serve(port: PortLike): Endpoint {
    const stateOf = (msg: Record<string, unknown>) => {
      const state = typeof msg.cid === 'number' ? this.clients.get(msg.cid) : undefined
      if (!state || state.closed) throw new WebRTPayError('closed', 'No such client')
      return state
    }
    let endpoint: Endpoint
    endpoint = new Endpoint(
      port,
      {
        wallet: async msg => {
          const state = stateOf(msg)
          const call = checkWalletCall(msg.method, msg.args)
          const wallet = state.options.wallet as WalletMethods
          const result = await wallet[call.method](call.args, state.options.originator)
          return walletReply(call, result)
        },
        send: async msg => {
          const state = stateOf(msg)
          if (!state.options.signaler) throw new WebRTPayError('unsupported', 'No signaler')
          if (!isIdentityKey(msg.to)) throw new Refused('the recipient must be an identity key')
          await state.options.signaler.send(msg.to, checkEnvelope(msg.envelope))
        },
        listen: async msg => {
          const state = stateOf(msg)
          const signaler = state.options.signaler
          if (!signaler) throw new WebRTPayError('unsupported', 'No signaler')
          const lid = msg.lid
          if (typeof lid !== 'number' || state.listens.has(lid)) throw new Refused('bad listen id')
          if (state.listens.size >= MAX_LISTENS_PER_CLIENT) throw new Refused('too many subscriptions')
          const unlisten = signaler.listen((from, e) => {
            if (!endpoint.isClosed) endpoint.emit('signal', { cid: state.cid, lid, from, envelope: { v: e.v, sid: e.sid, ciphertext: e.ciphertext } })
          })
          state.listens.set(lid, unlisten)
          try {
            await unlisten
          } catch (e) {
            state.listens.delete(lid)
            throw e
          }
        },
        unlisten: async msg => {
          const state = stateOf(msg)
          const unlisten = typeof msg.lid === 'number' ? state.listens.get(msg.lid) : undefined
          if (!unlisten) return
          state.listens.delete(msg.lid as number)
          await (await unlisten)()
        },
        ice: async msg => {
          const state = stateOf(msg)
          const provider = state.options.iceServersProvider
          return provider ? copyIceServers(await provider()) : []
        },
        payment: async msg => {
          const state = stateOf(msg)
          const handlers = state.handlers
          if (!handlers) throw new WebRTPayError('rejected', 'Not receiving', { reason: 'not_receiving' })
          const max = state.options.maxTransactionBytes ?? this.defaultMaxTransactionBytes
          const { payment, ctx } = checkIncomingPayment(msg.payment, msg.ctx, max)
          return decisionOf(await handlers.onPayment(payment as IncomingPayment, ctx))
        }
      },
      {
        setActive: msg => {
          const state = typeof msg.cid === 'number' ? this.clients.get(msg.cid) : undefined
          state?.options.signaler?.setActive?.(msg.active === true)
        },
        error: msg => {
          const state = typeof msg.cid === 'number' ? this.clients.get(msg.cid) : undefined
          state?.handlers?.onError?.(errorFrom(msg.error))
        },
        iceError: msg => {
          const state = typeof msg.cid === 'number' ? this.clients.get(msg.cid) : undefined
          state?.options.onIceServersProviderError?.(errorFrom(msg.error))
        },
        peerClosed: msg => {
          const peer = typeof msg.pid === 'number' ? this.peers.get(msg.pid) : undefined
          peer?.ended(msg.error === undefined ? undefined : errorFrom(msg.error))
        }
      }
    )
    return endpoint
  }
}

/** A connection to a peer, as `connect` resolves it; it lives in the worker. */
export class RemotePeer {
  private open = true
  private readonly ends = new Set<(e?: WebRTPayError) => void>()

  constructor(
    private readonly endpoint: Endpoint,
    readonly pid: number,
    readonly peerIdentityKey: string,
    readonly localIdentityKey: string
  ) {}

  get isOpen(): boolean {
    return this.open && !this.endpoint.isClosed
  }

  close(): void {
    if (!this.open) return
    this.endpoint.emit('closePeer', { pid: this.pid })
    this.ended()
  }

  onClose(fn: (e?: WebRTPayError) => void): () => void {
    if (!this.open) {
      fn()
      return () => {}
    }
    this.ends.add(fn)
    return () => this.ends.delete(fn)
  }

  /** @internal */
  whenEnded(fn: () => void): void {
    this.onClose(() => fn())
  }

  /** @internal The worker says it ended (or the worker is gone). */
  ended(e?: WebRTPayError): void {
    if (!this.open) return
    this.open = false
    for (const fn of [...this.ends]) {
      try { fn(e) } catch { /* one listener must not stop the others */ }
    }
    this.ends.clear()
  }
}

/** Makes the DirectPayClient class whose clients run on `link`'s worker. */
export function remoteClientClass(link: LiveWorkerLink) {
  return class RemoteDirectPayClient {
    private readonly state: ClientState

    constructor(o: RemoteClientOptions) {
      this.state = link.register(o)
    }

    get receiving(): boolean {
      return this.state.handlers !== undefined
    }

    async startReceiving(h: ReceiveHandlers): Promise<void> {
      if (typeof h?.onPayment !== 'function') throw new TypeError('onPayment must be a function')
      const endpoint = await link.on(this.state)
      // Payments only: whatever else `h` has (a payment request handler) is not used.
      this.state.handlers = { onPayment: h.onPayment, ...(h.onError && { onError: h.onError }) }
      try {
        await link.call(endpoint, 'startReceiving', { cid: this.state.cid })
      } catch (e) {
        this.state.handlers = undefined
        throw e
      }
    }

    async stopReceiving(): Promise<void> {
      this.state.handlers = undefined
      if (this.state.closed) return
      const endpoint = await link.on(this.state).catch(() => undefined)
      if (endpoint) await link.call(endpoint, 'stopReceiving', { cid: this.state.cid })
    }

    async connect(recipient: string, o: DialOptions = {}): Promise<AuthenticatedPeer> {
      if (o.signal?.aborted) throw new WebRTPayError('closed', 'Dial cancelled')
      const endpoint = await link.on(this.state)
      const dialId = link.nextDialId()
      const onAbort = () => endpoint.emit('abortDial', { dialId })
      o.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const r = await link.call<{ pid: number; peerIdentityKey: string; localIdentityKey: string; isOpen: boolean }>(endpoint, 'connect', {
          cid: this.state.cid,
          dialId,
          recipient,
          timeoutMs: o.timeoutMs,
          presenceTimeoutMs: o.presenceTimeoutMs,
          dialTimeoutMs: o.dialTimeoutMs
        }, (o.timeoutMs ?? this.state.options.timeouts?.connectMs ?? DEFAULT_DIAL_MS) + MARGIN_MS)
        if (!r || typeof r.pid !== 'number' || !isIdentityKey(r.peerIdentityKey) || r.peerIdentityKey !== recipient) {
          endpoint.emit('closePeer', { pid: r?.pid })
          throw new WebRTPayError('protocol', 'The worker connected to someone else')
        }
        const peer = new RemotePeer(endpoint, r.pid, r.peerIdentityKey, String(r.localIdentityKey))
        link.track(this.state, r.pid, peer)
        if (r.isOpen === false) peer.ended()
        return peer as unknown as AuthenticatedPeer
      } finally {
        o.signal?.removeEventListener('abort', onAbort)
      }
    }

    async sendPayment(peer: AuthenticatedPeer, token: PaymentTokenInput, o: { note?: string; timeoutMs?: number } = {}): Promise<PaymentAck> {
      const remote = peer as unknown as RemotePeer
      if (!(remote instanceof RemotePeer)) throw new TypeError('Not a connection of this client')
      const endpoint = await link.on(this.state)
      const ack = await link.call<PaymentAck>(endpoint, 'sendPayment', {
        cid: this.state.cid,
        pid: remote.pid,
        token: {
          customInstructions: { ...token.customInstructions },
          transaction: Array.from(token.transaction),
          amount: token.amount,
          ...(token.outputIndex !== undefined && { outputIndex: token.outputIndex })
        },
        ...(o.note !== undefined && { note: o.note }),
        ...(o.timeoutMs !== undefined && { timeoutMs: o.timeoutMs })
      }, (o.timeoutMs ?? this.state.options.timeouts?.ackMs ?? DEFAULT_ACK_MS) + MARGIN_MS)
      return checkAck(ack)
    }

    async close(): Promise<void> {
      this.state.handlers = undefined
      await link.release(this.state)
    }
  }
}

const CODES = new Set<WebRTPayErrorCode>(['timeout', 'closed', 'protocol', 'auth_failed', 'peer_unreachable', 'rejected', 'invalid_code', 'invalid_payment', 'invalid_signal', 'rate_limited', 'too_large', 'unsupported', 'unavailable'])

/** An error from the worker as the app expects it: a WebRTPayError with a known code, else `closed`. */
function errorFrom(e: unknown): WebRTPayError {
  if (e instanceof WebRTPayError) return e
  if (e instanceof EndpointClosed) return new WebRTPayError('closed', e.message)
  const r = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; message?: unknown; reason?: unknown }
  const code = typeof r.code === 'string' && CODES.has(r.code as WebRTPayErrorCode) ? (r.code as WebRTPayErrorCode) : 'closed'
  const message = typeof r.message === 'string' ? r.message.slice(0, 500) : 'The live payments worker failed'
  return new WebRTPayError(code, message, typeof r.reason === 'string' ? { reason: r.reason.slice(0, 64) } : undefined)
}

/** A payment decision as it crosses: only the three forms webrtpay knows. */
function decisionOf(d: PaymentDecision): PaymentDecision {
  if (d === 'accepted' || d === 'received') return d
  if (typeof d === 'object' && d !== null && d.status === 'rejected') return { status: 'rejected', reason: String(d.reason ?? '').slice(0, 500) }
  return { status: 'rejected', reason: 'The payment could not be taken' }
}

/** An ack from the worker, checked: a status, and an optional txid and reason. */
function checkAck(a: unknown): PaymentAck {
  const r = (typeof a === 'object' && a !== null ? a : {}) as Record<string, unknown>
  const status = r.status
  if (status !== 'accepted' && status !== 'received' && status !== 'rejected') throw new WebRTPayError('protocol', 'The worker sent a malformed acknowledgement')
  return {
    t: 'payment.ack',
    id: typeof r.id === 'string' ? r.id.slice(0, 64) : '',
    status,
    ...(typeof r.txid === 'string' && /^[0-9a-f]{64}$/.test(r.txid) && { txid: r.txid }),
    ...(typeof r.reason === 'string' && { reason: r.reason.slice(0, 500) })
  } as PaymentAck
}

/** ICE servers as plain data: urls, and a username and credential when there are. */
function copyIceServers(servers: RTCIceServer[]): RTCIceServer[] {
  const out: RTCIceServer[] = []
  for (const s of Array.isArray(servers) ? servers : []) {
    const urls = typeof s?.urls === 'string' ? [s.urls] : Array.isArray(s?.urls) ? s.urls.filter((u): u is string => typeof u === 'string') : []
    if (urls.length === 0) continue
    out.push({ urls, ...(typeof s.username === 'string' && { username: s.username }), ...(typeof s.credential === 'string' && { credential: s.credential }) })
  }
  return out
}

