import { describe, expect, it } from 'vitest'
import { DirectPayClient, RelaySignaler, VERSION } from '@bsv/webrtpay'

describe('vendored @bsv/webrtpay', () => {
  it('resolves the package root entry', () => {
    expect(VERSION).toBe('0.1.0')
    expect(typeof DirectPayClient).toBe('function')
  })

  // DirectPayManager keeps trying to receive on the same client and relay signaler after a
  // failed try (a relay that cannot be reached when the wallet opens). That relies on a
  // failed startReceiving leaving both able to try again; check it on each re-vendor.
  it('lets a client start receiving through a relay signaler after a failed try', async () => {
    const identityKey = `02${'42'.repeat(32)}`
    const wallet = {
      getPublicKey: async () => ({ publicKey: identityKey }),
      createSignature: async () => ({ signature: [1, 2, 3] })
    } as any
    const sockets: FakeSocket[] = []
    const behaviours: Array<(ws: FakeSocket) => void> = [
      // The relay cannot be reached: the socket closes before it opens.
      ws => ws.end(),
      // The relay is up: challenge, auth, ready, ICE servers.
      ws => {
        ws.readyState = 1
        ws.onSend = frame => {
          if (frame.t !== 'auth') return
          ws.receive({ t: 'ready', identityKey: frame.identityKey })
          ws.receive({ t: 'ice', iceServers: [] })
        }
        ws.receive({ t: 'challenge', nonce: 'nonce-1' })
      }
    ]
    class FakeSocket {
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
        this.onSend(JSON.parse(data))
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

    const relay = new RelaySignaler({ url: 'wss://relay.example.com', wallet, originator: 'admin.local', WebSocket: FakeSocket as any })
    const client = new DirectPayClient({ wallet, originator: 'admin.local', chain: 'main', signaler: relay })
    const handlers = { onPayment: async () => 'accepted' as const }
    try {
      await expect(client.startReceiving(handlers)).rejects.toMatchObject({ code: 'peer_unreachable' })
      expect(client.receiving).toBe(false)

      await client.startReceiving(handlers)

      expect(client.receiving).toBe(true)
      expect(sockets).toHaveLength(2)
    } finally {
      await client.close()
      await relay.close()
    }
  })
})
