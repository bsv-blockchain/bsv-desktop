/**
 * The live payments worker boundary (src/lib/services/liveWorker): the wallet window's
 * RemoteDirectPayClient on one end of a MessageChannel, the worker's host running the real
 * @bsv/webrtpay DirectPayClient (node-datachannel, loopback) on the other. One "app" per party,
 * each with its own worker, signaling through a memory hub that stays on the wallet side.
 *
 * And what a hostile worker may ask of the wallet window: only the five checked wallet calls,
 * envelopes through the signaler, and payments it then checks.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MessageChannel } from 'worker_threads'
import { LockingScript, MerklePath, P2PKH, PrivateKey, ProtoWallet, PublicKey, Random, Transaction, UnlockingScript, Utils } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'
import { createMemoryHub, DirectPayClient, WebRTPayError } from '@bsv/webrtpay'
import type { AuthenticatedPeer, IncomingPayment, MemoryHub } from '@bsv/webrtpay'
import { serveLiveWorker } from '../src/lib/services/liveWorker/host'
import { CONTROL_TIMEOUT_MS, LiveWorkerLink, remoteClientClass } from '../src/lib/services/liveWorker/remote'
import { Endpoint, RemoteError } from '../src/lib/services/liveWorker/rpc'
import type { PortLike } from '../src/lib/services/liveWorker/rpc'
import { checkIncomingPayment, checkWalletCall, Refused } from '../src/lib/services/liveWorker/protocol'
import { dialFailure } from '../src/lib/pages/Dashboard/Payments/directPayments'
import { MAX_LIVE_MESSAGE_BYTES, MAX_LIVE_TRANSACTION_BYTES } from '../src/lib/utils/directPaySettings'

const ORIGIN = 'admin.bsv-desktop'
const CHAIN = 'main'

let RTCPeerConnection: unknown
beforeAll(async () => {
  RTCPeerConnection = (await import('node-datachannel/polyfill')).RTCPeerConnection
})
afterAll(async () => {
  (await import('node-datachannel')).cleanup()
})

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})

/** A ProtoWallet with spies on the calls the wallet window makes for the worker. */
async function wallet() {
  const w = new ProtoWallet(PrivateKey.fromRandom())
  for (const m of ['getPublicKey', 'encrypt', 'decrypt', 'createSignature', 'verifySignature'] as const) vi.spyOn(w, m)
  const { publicKey } = await w.getPublicKey({ identityKey: true })
  return { wallet: w as unknown as WalletInterface & ProtoWallet, identityKey: publicKey }
}

/** One app: a worker (restartable), its link, and a client like DirectPayManager makes. */
function app(hub: MemoryHub, party: { wallet: WalletInterface; identityKey: string }, signaler = hub.signaler(party.identityKey)) {
  const hosts: Endpoint[] = []
  let gone: (() => void) | undefined
  const launcher = {
    open: async () => {
      const { port1, port2 } = new MessageChannel()
      hosts.push(serveLiveWorker(port2 as unknown as PortLike, {
        DirectPayClient,
        WebRTPayError,
        RTCPeerConnection,
        extraConfig: { bindAddress: '127.0.0.1' }
      }))
      return port1 as unknown as PortLike
    },
    close: () => { for (const h of hosts) h.close() },
    onGone: (fn: () => void) => { gone = fn; return () => { gone = undefined } }
  }
  const link = new LiveWorkerLink(launcher, MAX_LIVE_TRANSACTION_BYTES)
  const Client = remoteClientClass(link)
  const client = new Client({
    wallet: party.wallet,
    originator: ORIGIN,
    chain: CHAIN,
    signaler,
    rtc: { iceServers: [] },
    timeouts: { connectMs: 10_000, ackMs: 10_000 },
    maxMessageBytes: MAX_LIVE_MESSAGE_BYTES,
    limits: { maxMessageBytes: MAX_LIVE_MESSAGE_BYTES }
  })
  cleanups.push(async () => { await client.close(); launcher.close() })
  return {
    client,
    hosts,
    /** The worker dies, and main says so (as `live-worker:gone` does). */
    kill: () => { hosts[hosts.length - 1].close(); gone?.() }
  }
}

/** Atomic BEEF paying the payee's BRC-29 key at output 0, as a payer wallet builds it. */
async function token(payer: { wallet: WalletInterface }, payeeKey: string, amount = 1000) {
  const derivationPrefix = Utils.toBase64(Random(16)), derivationSuffix = Utils.toBase64(Random(16))
  const { publicKey } = await payer.wallet.getPublicKey({ protocolID: [2, '3241645161d8'], keyID: `${derivationPrefix} ${derivationSuffix}`, counterparty: payeeKey })
  const parent = new Transaction()
  parent.addInput({ sourceTXID: '00'.repeat(32), sourceOutputIndex: 0xffffffff, unlockingScript: new UnlockingScript() })
  parent.addOutput({ lockingScript: new P2PKH().lock(PrivateKey.fromRandom().toPublicKey().toHash()), satoshis: amount + 1000 })
  parent.merklePath = MerklePath.fromCoinbaseTxidAndHeight(parent.id('hex'), 1)
  const child = new Transaction()
  child.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScript: new UnlockingScript() })
  child.addOutput({ lockingScript: LockingScript.fromHex(new P2PKH().lock(PublicKey.fromString(publicKey).toHash()).toHex()), satoshis: amount })
  return { customInstructions: { derivationPrefix, derivationSuffix }, transaction: child.toAtomicBEEF(), amount, outputIndex: 0 }
}

describe('a live payment through two workers', () => {
  it('reaches the payee wallet window, which takes it; the wallets saw only the checked calls', async () => {
    const hub = createMemoryHub()
    const payer = await wallet(), payee = await wallet()
    const payeeApp = app(hub, payee), payerApp = app(hub, payer)
    const received: Array<{ p: IncomingPayment; ctx: { note?: string; txid: string } }> = []
    await payeeApp.client.startReceiving({ onPayment: async (p, ctx) => { received.push({ p, ctx }); return 'accepted' } })

    const peer = await payerApp.client.connect(payee.identityKey)
    expect(peer.peerIdentityKey).toBe(payee.identityKey)
    expect(peer.isOpen).toBe(true)
    const t = await token(payer, payee.identityKey, 2500)
    const ack = await payerApp.client.sendPayment(peer, t, { note: 'lunch' })
    expect(ack.status).toBe('accepted')

    expect(received).toHaveLength(1)
    expect(received[0].p.sender).toBe(payer.identityKey)
    expect(received[0].p.token.amount).toBe(2500)
    expect(received[0].p.token.transaction).toEqual(t.transaction)
    expect(received[0].ctx.note).toBe('lunch')
    expect(received[0].ctx.txid).toBe(Transaction.fromAtomicBEEF(t.transaction).id('hex'))

    // Every wallet call came from the wallet window with its own originator, under webrtpay's protocols.
    for (const party of [payer, payee]) {
      for (const m of ['encrypt', 'decrypt'] as const) {
        expect(party.wallet[m]).toHaveBeenCalled()
        for (const [args, originator] of (party.wallet[m] as any).mock.calls) {
          expect(args.protocolID).toEqual([2, 'webrtpay signaling'])
          expect(originator).toBe(ORIGIN)
        }
      }
      for (const m of ['createSignature', 'verifySignature'] as const) {
        expect(party.wallet[m]).toHaveBeenCalled()
        for (const [args, originator] of (party.wallet[m] as any).mock.calls) {
          expect(args.protocolID).toEqual([2, 'webrtpay channel'])
          expect(originator).toBe(ORIGIN)
        }
      }
    }

    peer.close()
    expect(peer.isOpen).toBe(false)
  })

  it('a payment the wallet window refuses is acked rejected, with its reason', async () => {
    const hub = createMemoryHub()
    const payer = await wallet(), payee = await wallet()
    const payeeApp = app(hub, payee), payerApp = app(hub, payer)
    await payeeApp.client.startReceiving({ onPayment: async () => { throw new WebRTPayError('invalid_payment', 'Not this one') } })
    const peer = await payerApp.client.connect(payee.identityKey)
    const ack = await payerApp.client.sendPayment(peer, await token(payer, payee.identityKey))
    expect(ack).toMatchObject({ status: 'rejected', reason: 'Not this one' })
    peer.close()
  })

  it('a dial nobody answers fails as a WebRTPayError the app reads as offline', async () => {
    const hub = createMemoryHub()
    const payer = await wallet(), payee = await wallet()
    const payerApp = app(hub, payer)
    app(hub, payee) // has a client, but is not receiving
    const error = await payerApp.client.connect(payee.identityKey, { presenceTimeoutMs: 300 }).catch(e => e)
    expect(error).toBeInstanceOf(WebRTPayError)
    expect(['offline', 'not_receiving']).toContain(dialFailure(error))
  })

  it('cancelling a dial cancels it in the worker', async () => {
    const hub = createMemoryHub()
    const payer = await wallet(), payee = await wallet()
    // A carrier that takes the knock and never brings a reply: the dial waits for its presence clock.
    const silent = { send: async () => {}, listen: async () => async () => {} }
    const payerApp = app(hub, payer, silent)
    const abort = new AbortController()
    const dial = payerApp.client.connect(payee.identityKey, { signal: abort.signal, presenceTimeoutMs: 5000 }).catch(e => e)
    setTimeout(() => abort.abort(), 100)
    const started = Date.now()
    const error = await dial
    expect(Date.now() - started).toBeLessThan(2000)
    expect(error).toBeInstanceOf(WebRTPayError)
    expect(error.code).toBe('closed')
  })

  it('starts the worker again when it dies, and the payee receives again', async () => {
    const hub = createMemoryHub()
    const payer = await wallet(), payee = await wallet()
    const payeeApp = app(hub, payee), payerApp = app(hub, payer)
    const received: IncomingPayment[] = []
    await payeeApp.client.startReceiving({ onPayment: async p => { received.push(p); return 'accepted' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    payeeApp.kill()
    await vi.waitFor(() => expect(payeeApp.hosts).toHaveLength(2))
    // The new worker listens again: a dial gets through and pays.
    let peer: AuthenticatedPeer | undefined
    await vi.waitFor(async () => { peer = await payerApp.client.connect(payee.identityKey, { presenceTimeoutMs: 500 }) }, { timeout: 5000, interval: 200 })
    const ack = await payerApp.client.sendPayment(peer!, await token(payer, payee.identityKey))
    expect(ack.status).toBe('accepted')
    expect(received).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('starting it again'))
    peer!.close()
  })
})

describe('what a hostile worker may ask of the wallet window', () => {
  /** A link whose "worker" is this test: it answers `create` and asks what it likes. */
  async function hostile() {
    const w = await wallet()
    const signaler = { send: vi.fn(async () => {}), listen: vi.fn(async () => async () => {}) }
    let worker!: Endpoint
    const link = new LiveWorkerLink({
      open: async () => {
        const { port1, port2 } = new MessageChannel()
        worker = new Endpoint(port2 as unknown as PortLike, { create: () => undefined, startReceiving: () => undefined, close: () => undefined })
        return port1 as unknown as PortLike
      },
      close: () => worker?.close()
    }, MAX_LIVE_TRANSACTION_BYTES)
    const Client = remoteClientClass(link)
    const client = new Client({ wallet: w.wallet, originator: ORIGIN, signaler })
    const onPayment = vi.fn(async () => 'accepted' as const)
    await client.startReceiving({ onPayment })
    cleanups.push(async () => { await client.close(); worker.close() })
    const ask = (op: string, fields: Record<string, unknown>) => worker.request(op, { cid: 1, ...fields })
    const refused = async (op: string, fields: Record<string, unknown>) => {
      const e = await ask(op, fields).catch(err => err)
      expect(e).toBeInstanceOf(RemoteError)
      return e as RemoteError
    }
    return { w, signaler, onPayment, ask, refused }
  }

  it('gets the identity key and the webrtpay protocol calls, with the wallet window\'s own originator', async () => {
    const { w, ask } = await hostile()
    const other = (await wallet()).identityKey
    await expect(ask('wallet', { method: 'getPublicKey', args: { identityKey: true } })).resolves.toEqual({ publicKey: w.identityKey })
    const sealed = await ask('wallet', { method: 'encrypt', args: { plaintext: [1, 2, 3], protocolID: [2, 'webrtpay signaling'], keyID: 'sid-1', counterparty: other } }) as { ciphertext: number[] }
    expect(sealed.ciphertext.length).toBeGreaterThan(3)
    expect(w.wallet.encrypt).toHaveBeenCalledWith({ plaintext: [1, 2, 3], protocolID: [2, 'webrtpay signaling'], keyID: 'sid-1', counterparty: other }, ORIGIN)
  })

  it.each<[string, Record<string, unknown>]>([
    ['createAction', { description: 'steal', outputs: [] }],
    ['internalizeAction', {}],
    ['getPublicKey', { identityKey: true, privileged: true }],
    ['getPublicKey', { protocolID: [2, 'webrtpay signaling'], keyID: '1', counterparty: 'self' }],
    ['encrypt', { plaintext: [1], protocolID: [2, '3241645161d8'], keyID: '1', counterparty: `02${'11'.repeat(32)}` }],
    ['encrypt', { plaintext: [1], protocolID: [2, 'webrtpay signaling'], keyID: '1', counterparty: 'self' }],
    ['decrypt', { ciphertext: [1], protocolID: [1, 'webrtpay signaling'], keyID: '1', counterparty: `02${'11'.repeat(32)}` }],
    ['createSignature', { data: [1], protocolID: [2, 'webrtpay relay'], keyID: '1', counterparty: 'anyone' }],
    ['createSignature', { data: [1], protocolID: [2, 'webrtpay signaling'], keyID: '1', counterparty: `02${'11'.repeat(32)}` }],
    ['createSignature', { data: new Array(5000).fill(1), protocolID: [2, 'webrtpay channel'], keyID: '1', counterparty: `02${'11'.repeat(32)}` }],
    ['createHmac', { data: [1], protocolID: [2, 'payment request auth'], keyID: '1', counterparty: `02${'11'.repeat(32)}` }],
    ['revealCounterpartyKeyLinkage', {}]
  ])('refuses %s %j', async (method, args) => {
    const { w, refused } = await hostile()
    const e = await refused('wallet', { method, args })
    expect(e.remote.name).toBe('Refused')
    for (const m of ['encrypt', 'decrypt', 'createSignature', 'verifySignature'] as const) expect(w.wallet[m]).not.toHaveBeenCalled()
  })

  it('sends only well-formed envelopes to identity keys through the signaler', async () => {
    const { signaler, ask, refused } = await hostile()
    const to = `03${'22'.repeat(32)}`
    await ask('send', { to, envelope: { v: 1, sid: 'abc', ciphertext: 'AAAA', extra: 'dropped' } })
    expect(signaler.send).toHaveBeenCalledWith(to, { v: 1, sid: 'abc', ciphertext: 'AAAA' })
    await refused('send', { to: 'not a key', envelope: { v: 1, sid: 'abc', ciphertext: 'AAAA' } })
    await refused('send', { to, envelope: { v: 2, sid: 'abc', ciphertext: 'AAAA' } })
    await refused('send', { to, envelope: { v: 1, sid: 'abc', ciphertext: 'A'.repeat(30_000) } })
    expect(signaler.send).toHaveBeenCalledOnce()
  })

  it('hands only a checked payment of at most 1 MB to onPayment', async () => {
    const { onPayment, ask, refused } = await hostile()
    const payment = {
      messageId: 'm1',
      sender: `02${'33'.repeat(32)}`,
      token: { customInstructions: { derivationPrefix: 'a', derivationSuffix: 'b' }, transaction: [1, 2, 3], amount: 5, outputIndex: 0 }
    }
    const ctx = { txid: 'ab'.repeat(32) }
    await expect(ask('payment', { payment, ctx })).resolves.toBe('accepted')
    expect(onPayment).toHaveBeenCalledOnce()
    await refused('payment', { payment: { ...payment, token: { ...payment.token, transaction: new Array(MAX_LIVE_TRANSACTION_BYTES + 1).fill(0) } }, ctx })
    await refused('payment', { payment: { ...payment, sender: 'me' }, ctx })
    await refused('payment', { payment: { ...payment, token: { ...payment.token, amount: -1 } }, ctx })
    await refused('payment', { payment, ctx: { txid: 'nope' } })
    await refused('payment', { payment: { ...payment, token: { ...payment.token, transaction: [256] } }, ctx })
    expect(onPayment).toHaveBeenCalledOnce()
  })

  it('answers nothing for a client it did not make, or an operation it does not know', async () => {
    const { ask, refused } = await hostile()
    const e = await ask('wallet', { cid: 99, method: 'getPublicKey', args: { identityKey: true } }).catch(err => err)
    expect(e).toBeInstanceOf(RemoteError)
    await refused('readSecrets', {})
  })
})

describe('a worker that stops answering', () => {
  it('is stopped and started again, and the client works on the new one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    cleanups.push(() => { vi.useRealTimers() })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const w = await wallet()
    const workers: Endpoint[] = []
    const closes = vi.fn()
    const link = new LiveWorkerLink({
      open: async () => {
        const { port1, port2 } = new MessageChannel()
        // The first worker never answers `create`; the second does.
        const hang = workers.length === 0
        workers.push(new Endpoint(port2 as unknown as PortLike, {
          create: () => (hang ? new Promise(() => {}) : undefined),
          startReceiving: () => undefined,
          close: () => undefined
        }))
        return port1 as unknown as PortLike
      },
      close: closes
    }, MAX_LIVE_TRANSACTION_BYTES)
    const Client = remoteClientClass(link)
    const client = new Client({ wallet: w.wallet, originator: ORIGIN })
    cleanups.push(async () => { await client.close(); for (const e of workers) e.close() })
    const started = client.startReceiving({ onPayment: async () => 'accepted' }).catch(e => e)
    await vi.advanceTimersByTimeAsync(CONTROL_TIMEOUT_MS + 1)
    expect(await started).toBeInstanceOf(WebRTPayError)
    expect(closes).toHaveBeenCalled()
    await vi.waitFor(() => expect(workers).toHaveLength(2))
    await expect(client.startReceiving({ onPayment: async () => 'accepted' })).resolves.toBeUndefined()
  })
})

describe('checkWalletCall and checkIncomingPayment', () => {
  it('rebuilds the arguments from checked fields only', () => {
    const counterparty = `02${'44'.repeat(32)}`
    const call = checkWalletCall('verifySignature', { data: [1], signature: [2], protocolID: [2, 'webrtpay channel'], keyID: 'n', counterparty, privileged: true, seekPermission: false })
    expect(call).toEqual({ method: 'verifySignature', args: { data: [1], signature: [2], protocolID: [2, 'webrtpay channel'], keyID: 'n', counterparty } })
    expect(() => checkWalletCall('verifySignature', { data: [1], signature: new Array(81).fill(1), protocolID: [2, 'webrtpay channel'], keyID: 'n', counterparty })).toThrow(Refused)
    expect(() => checkWalletCall('decrypt', { ciphertext: [1], protocolID: [2, 'webrtpay signaling'], keyID: 'x'.repeat(65), counterparty })).toThrow(Refused)
  })

  it('keeps only the payment fields webrtpay hands over', () => {
    const { payment } = checkIncomingPayment({
      messageId: 'm', sender: `02${'55'.repeat(32)}`, evil: true,
      token: { customInstructions: { derivationPrefix: 'p', derivationSuffix: 's', extra: 1 }, transaction: Uint8Array.from([9]), amount: 1 }
    }, { txid: 'cd'.repeat(32) }, 10)
    expect(payment).toEqual({ messageId: 'm', sender: `02${'55'.repeat(32)}`, token: { customInstructions: { derivationPrefix: 'p', derivationSuffix: 's' }, transaction: [9], amount: 1 } })
  })
})
