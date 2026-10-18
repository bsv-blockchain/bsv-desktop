import { describe, expect, it } from 'vitest'
import { AuthenticatedPeer, DEFAULT_INBOUND_LIMITS, DirectPayClient, MAX_DIRECT_TRANSACTION_BYTES, RelaySignaler, validatePaymentToken, VERSION } from '@bsv/webrtpay'

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

/** The relay accepts this wallet and answers `turn` with `turn` (STUN servers otherwise). */
const relayUp = (turn?: RTCIceServer) => (ws: FakeSocket) => {
  ws.readyState = 1
  ws.onSend = frame => {
    if (frame.t === 'auth') {
      ws.receive({ t: 'ready', identityKey: frame.identityKey })
      ws.receive({ t: 'ice', iceServers: [{ urls: 'stun:stun.example.com:3478' }] })
    } else if (frame.t === 'turn') {
      ws.receive({ t: 'ice', iceServers: [{ urls: 'stun:stun.example.com:3478' }, ...(turn ? [turn] : [])] })
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
    expect(VERSION).toBe('0.1.0')
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
})
