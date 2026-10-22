/**
 * The live payments worker's side of the port (see protocol.ts): it runs @bsv/webrtpay's
 * DirectPayClient, and so WebRTC, for the wallet window, which keeps the keys, the signalers
 * and the payments. Each client the wallet window makes here gets:
 * - a wallet that asks the wallet window for the five calls webrtpay makes (checked there);
 * - a signaler that carries envelopes through the wallet window's signaler;
 * - an ICE server provider that asks the wallet window (for the relay's TURN servers);
 * - an `onPayment` that hands each payment to the wallet window to take.
 *
 * Runs in the worker page (src/liveWorkerPage.ts) and, in the tests, in Node.
 */
import type { DirectPayClient as DirectPayClientType, PaymentTokenInput, SignalEnvelope, Signaler, WalletLike, WebRTPayError as WebRTPayErrorType } from '@bsv/webrtpay'
import { Endpoint, RemoteError } from './rpc'
import type { PortLike } from './rpc'
import { serializeError } from './protocol'
import type { ClientSpec } from './protocol'

/** What the host needs of @bsv/webrtpay (injected, so tests can use the real package with a polyfill). */
export interface HostDeps {
  DirectPayClient: typeof DirectPayClientType
  WebRTPayError: typeof WebRTPayErrorType
  /** The page's own RTCPeerConnection unless given (node-datachannel's in the tests). */
  RTCPeerConnection?: unknown
  /** Passed to every RTCPeerConnection (the tests bind to loopback). */
  extraConfig?: Record<string, unknown>
}

type Peer = Awaited<ReturnType<DirectPayClientType['connect']>>

/** Serves the wallet window on `port` until it closes. Returns the endpoint (for the tests). */
export function serveLiveWorker(port: PortLike, deps: HostDeps): Endpoint {
  const clients = new Map<number, DirectPayClientType>()
  const peers = new Map<number, Peer>()
  const dials = new Map<number, AbortController>()
  /** Each client's signal subscriptions, by listen id: the handler webrtpay gave `listen`. */
  const listeners = new Map<number, Map<number, (from: string, e: SignalEnvelope) => void>>()
  let nextPeer = 1
  let nextListen = 1

  /** An error from the wallet window, as webrtpay expects it: a WebRTPayError keeps its code. */
  const rebuild = (e: unknown): Error => {
    if (!(e instanceof RemoteError)) return e instanceof Error ? e : new Error(String(e))
    const { code, reason, message } = e.remote
    if (code) return new deps.WebRTPayError(code as WebRTPayErrorType['code'], message, reason !== undefined ? { reason } : undefined)
    return new Error(message)
  }
  const ask = async <T>(op: string, fields: Record<string, unknown>): Promise<T> => {
    try {
      return await endpoint.request<T>(op, fields)
    } catch (e) {
      throw rebuild(e)
    }
  }
  const clientOf = (msg: Record<string, unknown>) => {
    const c = clients.get(msg.cid as number)
    if (!c) throw new deps.WebRTPayError('closed', 'No such client')
    return c
  }

  function walletFor(cid: number): WalletLike {
    const call = (method: string) => (args: unknown) => ask('wallet', { cid, method, args })
    // Only these five; the originator webrtpay passes is dropped (the wallet window uses its own).
    return {
      getPublicKey: call('getPublicKey'),
      encrypt: call('encrypt'),
      decrypt: call('decrypt'),
      createSignature: call('createSignature'),
      verifySignature: call('verifySignature')
    } as unknown as WalletLike
  }

  function signalerFor(cid: number): Signaler {
    return {
      send: (to, e) => ask<void>('send', { cid, to, envelope: { v: e.v, sid: e.sid, ciphertext: e.ciphertext } }),
      listen: async fn => {
        const lid = nextListen++
        let subs = listeners.get(cid)
        if (!subs) listeners.set(cid, (subs = new Map()))
        subs.set(lid, fn)
        try {
          await ask<void>('listen', { cid, lid })
        } catch (e) {
          subs.delete(lid)
          throw e
        }
        return async () => {
          subs!.delete(lid)
          await ask<void>('unlisten', { cid, lid }).catch(() => {})
        }
      },
      setActive: active => endpoint.emit('setActive', { cid, active: active === true })
    }
  }

  const endpoint = new Endpoint(
    port,
    {
      create: msg => {
        const cid = msg.cid as number
        const spec = msg.spec as ClientSpec
        if (clients.has(cid)) throw new Error('That client exists')
        const client = new deps.DirectPayClient({
          wallet: walletFor(cid),
          chain: spec.chain,
          ...(spec.signaler && { signaler: signalerFor(cid) }),
          rtc: {
            iceServers: spec.iceServers,
            ...(deps.RTCPeerConnection !== undefined && { RTCPeerConnection: deps.RTCPeerConnection as typeof RTCPeerConnection }),
            ...(deps.extraConfig && { extraConfig: deps.extraConfig })
          },
          ...(spec.iceProvider && {
            iceServersProvider: () => ask<RTCIceServer[]>('ice', { cid }),
            onIceServersProviderError: (e: unknown) => endpoint.emit('iceError', { cid, error: serializeError(e) })
          }),
          ...(spec.timeouts && { timeouts: spec.timeouts }),
          ...(spec.maxMessageBytes !== undefined && { maxMessageBytes: spec.maxMessageBytes }),
          ...(spec.limits && { limits: spec.limits })
        })
        clients.set(cid, client)
      },
      startReceiving: async msg => {
        const cid = msg.cid as number
        // Payments only: no payment request handler, so requests are dropped.
        await clientOf(msg).startReceiving({
          onPayment: (payment, ctx) => ask('payment', { cid, payment, ctx }),
          onError: e => endpoint.emit('error', { cid, error: serializeError(e) })
        })
      },
      stopReceiving: msg => clientOf(msg).stopReceiving(),
      close: async msg => {
        const cid = msg.cid as number
        const client = clients.get(cid)
        clients.delete(cid)
        listeners.delete(cid)
        await client?.close()
      },
      connect: async msg => {
        const client = clientOf(msg)
        const dialId = msg.dialId as number
        const abort = new AbortController()
        dials.set(dialId, abort)
        try {
          const num = (x: unknown) => (typeof x === 'number' ? x : undefined)
          const peer = await client.connect(msg.recipient as string, {
            signal: abort.signal,
            timeoutMs: num(msg.timeoutMs),
            presenceTimeoutMs: num(msg.presenceTimeoutMs),
            dialTimeoutMs: num(msg.dialTimeoutMs)
          })
          const pid = nextPeer++
          peers.set(pid, peer)
          peer.onClose(e => {
            peers.delete(pid)
            endpoint.emit('peerClosed', { pid, ...(e && { error: serializeError(e) }) })
          })
          return { pid, peerIdentityKey: peer.peerIdentityKey, localIdentityKey: peer.localIdentityKey, isOpen: peer.isOpen }
        } finally {
          dials.delete(dialId)
        }
      },
      sendPayment: async msg => {
        const client = clientOf(msg)
        const peer = peers.get(msg.pid as number)
        if (!peer) throw new deps.WebRTPayError('closed', 'The connection has ended')
        const o: { note?: string; timeoutMs?: number } = {}
        if (typeof msg.note === 'string') o.note = msg.note
        if (typeof msg.timeoutMs === 'number') o.timeoutMs = msg.timeoutMs
        const ack = await client.sendPayment(peer, msg.token as PaymentTokenInput, o)
        return { ...ack }
      }
    },
    {
      abortDial: msg => dials.get(msg.dialId as number)?.abort(),
      closePeer: msg => peers.get(msg.pid as number)?.close(),
      signal: msg => {
        const fn = listeners.get(msg.cid as number)?.get(msg.lid as number)
        const e = msg.envelope as SignalEnvelope
        if (fn && typeof msg.from === 'string' && e && typeof e === 'object') fn(msg.from, { v: 1, sid: e.sid, ciphertext: e.ciphertext })
      }
    }
  )
  endpoint.whenClosed(() => {
    for (const client of clients.values()) void client.close().catch(() => {})
    clients.clear()
    peers.clear()
  })
  return endpoint
}
