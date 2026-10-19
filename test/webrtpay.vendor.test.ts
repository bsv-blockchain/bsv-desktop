import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { PrivateKey, ProtoWallet } from '@bsv/sdk'
import * as webrtpay from '@bsv/webrtpay'
import { AuthenticatedPeer, createMemoryHub, DEFAULT_INBOUND_LIMITS, DirectPayClient, MAX_DIRECT_TRANSACTION_BYTES, RelaySignaler, validatePaymentToken, VERSION, WebRTPayError } from '@bsv/webrtpay'

const identityKey = `02${'42'.repeat(32)}`
const wallet = {
  getPublicKey: async () => ({ publicKey: identityKey }),
  createSignature: async () => ({ signature: [1, 2, 3] })
} as any

/**
 * A WebSocket stand-in for a relay. Each socket the signaler opens takes the next behaviour
 * from the list; `relayUp` answers the challenge, auth, ready and ICE handshake and then
 * `turn` requests.
 */
function fakeRelay(behaviours: Array<(ws: FakeSocket) => void>) {
  const sockets: FakeSocket[] = []
  const frames: any[] = []
  class Socket implements FakeSocket {
    readyState = 0
    onSend: (frame: any) => void = () => {}
    private readonly listeners = new Map<string, Array<(ev: any) => void>>()
    constructor(readonly url: string) {
      sockets.push(this)
      const behave = behaviours.shift()
      setTimeout(() => behave?.(this), 0)
    }
    addEventListener(type: string, fn: (ev: any) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
    }
    receive(frame: unknown) {
      for (const fn of this.listeners.get('message') ?? []) fn({ data: JSON.stringify(frame) })
    }
    send(data: string) {
      const frame = JSON.parse(data)
      frames.push(frame)
      this.onSend(frame)
    }
    end() {
      if (this.readyState === 3) return
      this.readyState = 3
      for (const fn of this.listeners.get('close') ?? []) fn({})
    }
    close() {
      setTimeout(() => this.end(), 0)
    }
  }
  return { WebSocket: Socket as unknown as typeof WebSocket, sockets, frames }
}

interface FakeSocket {
  readyState: number
  onSend: (frame: any) => void
  receive(frame: unknown): void
  end(): void
}

/** The relay cannot be reached: the socket closes before it opens. */
const relayDown = (ws: FakeSocket) => ws.end()

/**
 * The relay accepts this wallet and answers `turn` with `turn` (STUN servers otherwise), sending
 * `expiresAt` with it when given, as a relay with Cloudflare's TURN does. `unavailable` is how
 * many `turn` requests it first answers with `unavailable`, as when its TURN provider is down.
 */
const relayUp = (turn?: RTCIceServer, o: { expiresAt?: number; unavailable?: number } = {}) => (ws: FakeSocket) => {
  let unavailable = o.unavailable ?? 0
  ws.readyState = 1
  ws.onSend = frame => {
    if (frame.t === 'auth') {
      ws.receive({ t: 'ready', identityKey: frame.identityKey })
      ws.receive({ t: 'ice', iceServers: [{ urls: 'stun:stun.example.com:3478' }] })
    } else if (frame.t === 'turn') {
      if (unavailable > 0) {
        unavailable--
        ws.receive({ t: 'error', code: 'unavailable' })
        return
      }
      ws.receive({ t: 'ice', iceServers: [{ urls: 'stun:stun.example.com:3478' }, ...(turn ? [turn] : [])], ...(o.expiresAt !== undefined && { expiresAt: o.expiresAt }) })
    }
  }
  ws.receive({ t: 'challenge', nonce: 'nonce-1' })
}

/** The relay refuses the signature: its PUBLIC_URLS does not list the url this wallet signed. */
const relayRefuses = (ws: FakeSocket) => {
  ws.readyState = 1
  ws.onSend = frame => { if (frame.t === 'auth') ws.receive({ t: 'error', code: 'auth_failed' }) }
  ws.receive({ t: 'challenge', nonce: 'nonce-1' })
}

describe('vendored @bsv/webrtpay', () => {
  it('resolves the package root entry', () => {
    // The installed build is 0.2.0 (knock/ring presence, per-dial AbortSignal). Its VERSION
    // constant was not bumped in the 0.2.0 build, so check the package manifest instead.
    expect(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../node_modules/@bsv/webrtpay/package.json'), 'utf8')).version).toBe('0.2.0')
    expect(typeof VERSION).toBe('string')
    expect(typeof DirectPayClient).toBe('function')
  })

  // DirectPayManager shows receiving through a relay from the relay's connection state, and
  // relies on the signaler to reconnect by itself when the relay cannot be reached at first.
  // Check both on each re-vendor.
  it('starts receiving through a relay that is down, reports why, and goes online once it is back', async () => {
    const relayFake = fakeRelay([relayDown, relayUp()])
    const states: Array<[string, string | undefined]> = []
    const relay = new RelaySignaler({
      url: 'wss://relay.example.com',
      wallet,
      originator: 'admin.local',
      WebSocket: relayFake.WebSocket,
      random: () => 0, // reconnect at once
      onStateChange: (state, error) => { states.push([state, error?.code]) }
    })
    const client = new DirectPayClient({ wallet, originator: 'admin.local', chain: 'main', signaler: relay })
    try {
      await client.startReceiving({ onPayment: async () => 'accepted' as const })

      expect(client.receiving).toBe(true)
      expect(states.slice(0, 2)).toEqual([['connecting', undefined], ['offline', 'peer_unreachable']])
      await expect.poll(() => states.at(-1)).toEqual(['online', undefined])
      expect(states).toEqual([['connecting', undefined], ['offline', 'peer_unreachable'], ['connecting', undefined], ['online', undefined]])
      expect(relayFake.sockets).toHaveLength(2)
    } finally {
      await client.close()
      await relay.close()
    }
  })

  // DirectPayManager tells the two auth_failed cases apart by `cause`: the relay refusing the
  // signature has none, this wallet failing to sign carries the wallet's error.
  it('reports auth_failed without a cause when the relay refuses the url this wallet signed', async () => {
    const states: Array<[string, string | undefined, unknown]> = []
    const relay = new RelaySignaler({
      url: 'wss://relay.example.com',
      wallet,
      originator: 'admin.local',
      WebSocket: fakeRelay([relayRefuses]).WebSocket,
      random: () => 0.999, // the next try waits about a second; the test is done by then
      onStateChange: (state, error) => { states.push([state, error?.code, error?.cause]) }
    })
    try {
      await relay.listen(() => {})
      expect(states).toEqual([['connecting', undefined, undefined], ['offline', 'auth_failed', undefined]])
    } finally {
      await relay.close()
    }
  })

  it('reports auth_failed with the wallet error as its cause when this wallet cannot sign the challenge', async () => {
    const locked = new Error('User is not authenticated.')
    const states: Array<[string, string | undefined, unknown]> = []
    const relay = new RelaySignaler({
      url: 'wss://relay.example.com',
      wallet: { ...wallet, createSignature: async () => { throw locked } },
      originator: 'admin.local',
      WebSocket: fakeRelay([relayRefuses]).WebSocket,
      random: () => 0.999,
      onStateChange: (state, error) => { states.push([state, error?.code, error?.cause]) }
    })
    try {
      await relay.listen(() => {})
      expect(states).toEqual([['connecting', undefined, undefined], ['offline', 'auth_failed', locked]])
    } finally {
      await relay.close()
    }
  })

  // deliverDirect checks a payment with these before it broadcasts it, and the payee's
  // first-message window has to leave the payer time to make and broadcast it.
  it('has the payer-side checks and the first-message window desktop sending relies on', () => {
    expect(MAX_DIRECT_TRANSACTION_BYTES).toBe(12_579_840)
    const token = { transaction: [1, 2, 3], amount: 500, outputIndex: 0, customInstructions: { derivationPrefix: 'cHJlZml4', derivationSuffix: 'c3VmZml4' } }
    expect(() => validatePaymentToken(token)).toThrow(expect.objectContaining({ code: 'invalid_payment' }))
    expect(Object.getOwnPropertyDescriptor(AuthenticatedPeer.prototype, 'isOpen')?.get).toBeTypeOf('function')
    expect(DEFAULT_INBOUND_LIMITS.firstMessageTimeoutMs).toBe(60_000)
  })

  // DirectPayManager passes turnProvider() as the client's iceServersProvider. Every
  // requestTurn spends one of this address's TURN credentials (6 an hour), and a payee
  // gathers for every offer it admits, so the provider must reuse live credentials.
  it('asks the relay for TURN once and reuses the credentials while they are live', async () => {
    const expiry = Math.floor(Date.now() / 1000) + 600
    const turn = { urls: 'turn:turn.example.com:3478', username: `${expiry}:pseudonym`, credential: 'c3VwZXI=' }
    const relayFake = fakeRelay([relayUp(turn)])
    const relay = new RelaySignaler({ url: 'wss://relay.example.com', wallet, originator: 'admin.local', WebSocket: relayFake.WebSocket })
    const provider = relay.turnProvider()
    try {
      const [first, second] = await Promise.all([provider(), provider()])
      const third = await provider()

      for (const servers of [first, second, third]) expect(servers).toContainEqual(turn)
      expect(relayFake.frames.filter(frame => frame.t === 'turn')).toHaveLength(1)
    } finally {
      await relay.close()
    }
  })

  // Cloudflare's TURN usernames are random, so the only expiry a wallet has is the `expiresAt`
  // the relay sends with the servers. Without reading it, the wallet would keep dead credentials.
  describe('TURN credentials from a relay that sends expiresAt (Cloudflare)', () => {
    const cloudflare: RTCIceServer = {
      urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
      username: 'cf-opaque-username',
      credential: 'cf-opaque-credential'
    }
    const turnFrames = (relayFake: ReturnType<typeof fakeRelay>) => relayFake.frames.filter(frame => frame.t === 'turn')

    it('reuses credentials that stay valid, going by expiresAt', async () => {
      const relayFake = fakeRelay([relayUp(cloudflare, { expiresAt: Date.now() + 600_000 })])
      const relay = new RelaySignaler({ url: 'wss://relay.example.com', wallet, originator: 'admin.local', WebSocket: relayFake.WebSocket })
      const provider = relay.turnProvider()
      try {
        await relay.connect() // as a wallet that is receiving does: the socket stays open between requests
        await provider()
        const second = await provider()

        expect(second).toContainEqual(cloudflare)
        expect(relay.iceServers()).toContainEqual(cloudflare)
        expect(turnFrames(relayFake)).toHaveLength(1)
      } finally {
        await relay.close()
      }
    })

    it('asks again once they are within 30 seconds of expiring, and stops offering them from iceServers()', async () => {
      const relayFake = fakeRelay([relayUp(cloudflare, { expiresAt: Date.now() + 10_000 })])
      const relay = new RelaySignaler({ url: 'wss://relay.example.com', wallet, originator: 'admin.local', WebSocket: relayFake.WebSocket })
      const provider = relay.turnProvider()
      try {
        await relay.connect()
        await provider()
        expect(relay.iceServers()).not.toContainEqual(cloudflare)
        await provider()

        expect(turnFrames(relayFake)).toHaveLength(2)
      } finally {
        await relay.close()
      }
    })
  })

  // A relay whose TURN provider (Cloudflare) fails answers `unavailable`. That is "no TURN this
  // time": the request fails with its own code, the relay connection stays up, and nothing is
  // remembered, so the next gather asks again.
  it('fails a TURN request with `unavailable` when the relay cannot issue credentials, keeps the connection, and asks again next time', async () => {
    const turn: RTCIceServer = { urls: 'turn:turn.cloudflare.com:3478', username: 'cf-opaque-username', credential: 'cf-opaque-credential' }
    const relayFake = fakeRelay([relayUp(turn, { unavailable: 1, expiresAt: Date.now() + 600_000 })])
    const states: Array<[string, string | undefined]> = []
    const relay = new RelaySignaler({
      url: 'wss://relay.example.com',
      wallet,
      originator: 'admin.local',
      WebSocket: relayFake.WebSocket,
      onStateChange: (state, error) => { states.push([state, error?.code]) }
    })
    const provider = relay.turnProvider()
    try {
      await relay.connect() // as a wallet that is receiving does: the socket stays open between requests
      const failure = await provider().catch(e => e)
      expect(failure).toBeInstanceOf(WebRTPayError)
      expect(failure.code).toBe('unavailable')
      expect(relay.iceServers()).not.toContainEqual(turn)

      const retried = await provider()

      expect(retried).toContainEqual(turn)
      expect(relayFake.frames.filter(frame => frame.t === 'turn')).toHaveLength(2)
      // The one socket stayed open, and the failure never showed up as a connection problem.
      expect(relayFake.sockets).toHaveLength(1)
      expect(states).toEqual([['connecting', undefined], ['online', undefined]])
    } finally {
      await relay.close()
    }
  })

  // The same through a real client: a provider that fails never fails the dial. The payer
  // connects and authenticates on STUN alone, and is told why through onIceServersProviderError.
  it('connects without TURN when the relay answers a TURN request `unavailable`, telling onIceServersProviderError', async () => {
    const { RTCPeerConnection } = await import('node-datachannel/polyfill')
    const hub = createMemoryHub()
    const rtc = { RTCPeerConnection: RTCPeerConnection as unknown as typeof globalThis.RTCPeerConnection, iceServers: [], extraConfig: { bindAddress: '127.0.0.1' } }
    const party = async () => {
      const proto = new ProtoWallet(PrivateKey.fromRandom())
      const { publicKey } = await proto.getPublicKey({ identityKey: true })
      return { proto, identityKey: publicKey }
    }
    const [payee, payer] = [await party(), await party()]
    const relay = new RelaySignaler({
      url: 'wss://relay.example.com',
      wallet,
      originator: 'admin.local',
      WebSocket: fakeRelay([relayUp(undefined, { unavailable: 1 })]).WebSocket
    })
    const providerErrors: unknown[] = []
    const payeeClient = new DirectPayClient({ wallet: payee.proto, originator: 'admin.test', chain: 'main', signaler: hub.signaler(payee.identityKey), rtc, timeouts: { connectMs: 10_000 } })
    const payerClient = new DirectPayClient({
      wallet: payer.proto,
      originator: 'admin.test',
      chain: 'main',
      signaler: hub.signaler(payer.identityKey),
      rtc,
      timeouts: { connectMs: 10_000 },
      iceServersProvider: relay.turnProvider(),
      onIceServersProviderError: e => { providerErrors.push(e) }
    })
    try {
      await payeeClient.startReceiving({ onPayment: async () => 'accepted' as const })
      const peer = await payerClient.connect(payee.identityKey)

      expect(peer.isOpen).toBe(true)
      expect(providerErrors).toHaveLength(1)
      expect(providerErrors[0]).toBeInstanceOf(WebRTPayError)
      expect((providerErrors[0] as WebRTPayError).code).toBe('unavailable')
    } finally {
      await Promise.all([payerClient.close(), payeeClient.close(), relay.close()])
    }
  })

  // Desktop passes the wallet's chain to DirectPayClient, and deliverDirect names the network
  // when a recipient refuses for this reason (final review D2, Ruling 38).
  it('binds dials to the network: a payee on another network refuses before anything connects, saying why', async () => {
    const isSignalChain = (webrtpay as { isSignalChain?: (x: unknown) => boolean }).isSignalChain
    expect(isSignalChain).toBeTypeOf('function')
    for (const chain of ['main', 'test', 'ttn', 'tstn']) expect(isSignalChain!(chain)).toBe(true)

    const { RTCPeerConnection } = await import('node-datachannel/polyfill')
    const hub = createMemoryHub()
    const party = async (chain: string) => {
      const proto = new ProtoWallet(PrivateKey.fromRandom())
      const { publicKey } = await proto.getPublicKey({ identityKey: true })
      const client = new DirectPayClient({
        wallet: proto,
        originator: 'admin.test',
        chain,
        signaler: hub.signaler(publicKey),
        rtc: { RTCPeerConnection: RTCPeerConnection as unknown as typeof globalThis.RTCPeerConnection, iceServers: [], extraConfig: { bindAddress: '127.0.0.1' } },
        timeouts: { connectMs: 10_000 }
      })
      return { client, identityKey: publicKey }
    }
    const payee = await party('test'), payer = await party('main')
    try {
      await payee.client.startReceiving({ onPayment: async () => 'accepted' as const })
      const error = await payer.client.connect(payee.identityKey).catch(e => e)

      expect(error).toBeInstanceOf(WebRTPayError)
      expect(error.code).toBe('rejected')
      expect(error.reason).toBe('wrong_network')
    } finally {
      await Promise.all([payer.client.close(), payee.client.close()])
    }
  })
})

afterAll(async () => {
  (await import('node-datachannel')).cleanup()
})
