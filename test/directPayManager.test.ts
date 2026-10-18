/**
 * DirectPayManager owns the open wallet's DirectPayClient: it picks the signaler from the
 * device settings, receives only when the user turned receiving on, takes payments into the
 * wallet at once and is torn down with the wallet.
 *
 * @bsv/webrtpay's client and signalers are replaced (the rest of the package stays real),
 * like peerPayManager.test.ts replaces message-box-client. The payment flows are C3's and
 * have their own tests, so they are replaced too.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PeerPayClient } from '@bsv/message-box-client'
import type { MessageBoxLike } from '@bsv/webrtpay'
import { DEFAULT_DIRECT_PAY_SETTINGS, iceServersFrom, type DirectPaySettings } from '../src/lib/utils/directPaySettings'

// Type level (checked by tsc, not at run time): message-box-client's PeerPayClient carries
// signals for MessageBoxSignaler as it is, with no adapter.
export const peerPayClientIsMessageBoxLike = (client: PeerPayClient): MessageBoxLike => client

const h = vi.hoisted(() => {
  type Fn = (...args: any[]) => any
  return {
    /** What the replaced constructors made, in order; reset before each test. */
    made: { clients: [] as any[], messageBoxes: [] as any[], relays: [] as any[] },
    /** What every client's startReceiving does. */
    startReceiving: null as unknown as Fn,
    receive: null as unknown as Mock,
    retry: null as unknown as Mock,
    warning: null as unknown as Mock
  }
})

vi.mock('@bsv/webrtpay', async importOriginal => ({
  ...(await importOriginal<typeof import('@bsv/webrtpay')>()),
  DirectPayClient: vi.fn(function (options: any) {
    const client = {
      options,
      startReceiving: vi.fn((...args: unknown[]) => h.startReceiving(...args)),
      updateRtc: vi.fn(),
      close: vi.fn(async () => {})
    }
    h.made.clients.push(client)
    return client
  }),
  MessageBoxSignaler: vi.fn(function (client: unknown, options: unknown) {
    const signaler = { client, options }
    h.made.messageBoxes.push(signaler)
    return signaler
  }),
  RelaySignaler: vi.fn(function (options: any) {
    const signaler = { options, close: vi.fn(async () => {}) }
    h.made.relays.push(signaler)
    return signaler
  })
}))
vi.mock('../src/lib/pages/Dashboard/Payments/directPayments', () => ({
  receiveDirectPayment: (...args: unknown[]) => h.receive(...args),
  retryReceivedDirectPayments: (...args: unknown[]) => h.retry(...args)
}))
vi.mock('react-toastify', () => ({ toast: { warning: (...args: unknown[]) => h.warning(...args) } }))

import { DirectPayManager } from '../src/lib/services/DirectPayManager'
import { activeUserWalletOperations, setHttpBridgePaused } from '../src/lib/services/httpBridgeSession'

const HOST = 'https://messagebox.babbage.systems'
const IDENTITY = `02${'42'.repeat(32)}`
const SENDER = `03${'17'.repeat(32)}`
const RELAY = 'wss://relay.example.com'

const peerPayClient = { sendMessage: vi.fn(), listMessages: vi.fn(), acknowledgeMessage: vi.fn() }
const wallet = { name: 'permissions manager' } as any

const settings = (change: Partial<DirectPaySettings> = {}): DirectPaySettings => ({ ...DEFAULT_DIRECT_PAY_SETTINGS, ...change })
const startOptions = (change: Record<string, unknown> = {}) => ({
  wallet,
  originator: 'admin.local',
  identity: IDENTITY,
  chain: 'main',
  peerPayClient,
  messageBoxUrl: HOST,
  settings: settings(),
  ...change
}) as any

const payment = { messageId: 'p1', sender: SENDER, token: { amount: 1234, transaction: [1, 2, 3], customInstructions: { derivationPrefix: 'a', derivationSuffix: 'b' } } }

let events: Array<{ type: string; detail?: unknown }>
let settingsListeners: Array<() => void>
let stored: Record<string, string>
let manager: DirectPayManager

/** The handlers the manager passed to startReceiving on the nth client. */
const handlersOf = (n = 0) => h.made.clients[n].startReceiving.mock.calls[0][0]

beforeEach(() => {
  h.made = { clients: [], messageBoxes: [], relays: [] }
  h.startReceiving = async () => {}
  h.receive = vi.fn(async () => 'accepted')
  h.retry = vi.fn(async () => 0)
  h.warning = vi.fn()
  events = []
  settingsListeners = []
  stored = {}
  vi.stubGlobal('CustomEvent', class { constructor(public type: string, init?: { detail?: unknown }) { this.detail = init?.detail } detail: unknown })
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn((event: { type: string; detail?: unknown }) => { events.push(event); return true }),
    addEventListener: vi.fn((type: string, fn: () => void) => { if (type === 'direct-pay-settings-changed') settingsListeners.push(fn) }),
    removeEventListener: vi.fn((type: string, fn: () => void) => { settingsListeners = settingsListeners.filter(f => f !== fn) })
  })
  vi.stubGlobal('localStorage', { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = v } })
  manager = new DirectPayManager()
})

afterEach(async () => {
  await manager.stop()
  vi.unstubAllGlobals()
})

describe('DirectPayManager.start', () => {
  it('with receiving off creates a client for sending and reports off', async () => {
    await manager.start(startOptions())

    expect(h.made.clients).toHaveLength(1)
    const [client] = h.made.clients
    expect(client.options).toMatchObject({ wallet, originator: 'admin.local', chain: 'main', signaler: h.made.messageBoxes[0] })
    expect(client.options.rtc).toEqual({ iceServers: iceServersFrom(settings()) })
    expect(client.startReceiving).not.toHaveBeenCalled()
    expect(manager.getSnapshot()).toEqual({ client, status: 'off', via: 'messagebox', error: '', received: 0 })
  })

  it('with receiving on over the message box polls the wallet\'s own host and goes online', async () => {
    const changes: string[] = []
    manager.on('changed', snapshot => changes.push(snapshot.status))

    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))

    expect(h.made.messageBoxes).toHaveLength(1)
    // Audit F19: with a host, list and ack go straight to it instead of an overlay lookup per poll.
    expect(h.made.messageBoxes[0]).toEqual({ client: peerPayClient, options: { host: HOST } })
    expect(h.made.clients[0].startReceiving).toHaveBeenCalledOnce()
    expect(manager.getSnapshot()).toMatchObject({ status: 'online', via: 'messagebox', error: '' })
    expect(changes).toEqual(['starting', 'online'])
  })

  it('reports an error when receiving cannot start', async () => {
    h.startReceiving = async () => { throw new Error('The relay could not be reached') }

    await manager.start(startOptions({ settings: settings({ receiveEnabled: true, signaling: 'relay', relayUrl: RELAY }) }))

    expect(manager.getSnapshot()).toMatchObject({ status: 'error', via: 'relay', client: h.made.clients[0] })
    expect(manager.getSnapshot().error).toContain('The relay could not be reached')
  })

  it('reports an error with a message for relay signaling without a relay URL (Ruling 14)', async () => {
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true, signaling: 'relay', relayUrl: '' }) }))

    const snapshot = manager.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.via).toBeNull()
    expect(snapshot.error).toMatch(/relay/i)
    expect(h.made.relays).toHaveLength(0)
    // Code exchange needs no signaler, so the client is still there.
    expect(snapshot.client).toBe(h.made.clients[0])
    expect(h.made.clients[0].options.signaler).toBeUndefined()
    expect(h.made.clients[0].startReceiving).not.toHaveBeenCalled()
  })

  it('reports an error for message box signaling without a message box', async () => {
    await manager.start(startOptions({ peerPayClient: null, messageBoxUrl: undefined }))

    expect(manager.getSnapshot()).toMatchObject({ status: 'error', via: null, client: h.made.clients[0] })
    expect(manager.getSnapshot().error).toMatch(/message box/i)
    expect(h.made.messageBoxes).toHaveLength(0)
  })

  it('signals through the relay and adds the ICE servers the relay hands out', async () => {
    const relaySettings = settings({ receiveEnabled: true, signaling: 'relay', relayUrl: RELAY })
    await manager.start(startOptions({ settings: relaySettings }))

    const [relay] = h.made.relays
    expect(relay.options).toMatchObject({ url: RELAY, wallet, originator: 'admin.local' })
    expect(h.made.messageBoxes).toHaveLength(0)
    expect(h.made.clients[0].options.signaler).toBe(relay)
    expect(manager.getSnapshot()).toMatchObject({ status: 'online', via: 'relay' })

    const turn = { urls: 'turn:turn.example.com:3478', username: '1:abc', credential: 'secret' }
    relay.options.onIceServers([turn])
    expect(h.made.clients[0].updateRtc).toHaveBeenCalledWith({ iceServers: [...iceServersFrom(relaySettings), turn] })
  })

  it('creates one client when started twice with the same wallet and settings', async () => {
    const options = startOptions({ settings: settings({ receiveEnabled: true }) })
    await Promise.all([manager.start(options), manager.start(options)])
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))

    expect(h.made.clients).toHaveLength(1)
    expect(h.made.messageBoxes).toHaveLength(1)
    expect(h.made.clients[0].startReceiving).toHaveBeenCalledOnce()
    expect(manager.getSnapshot().status).toBe('online')
  })

  it('replaces the client when the message box client changes', async () => {
    await manager.start(startOptions())
    const replacement = { ...peerPayClient }
    await manager.start(startOptions({ peerPayClient: replacement, messageBoxUrl: 'https://other.example.com' }))

    expect(h.made.clients).toHaveLength(2)
    expect(h.made.clients[0].close).toHaveBeenCalledOnce()
    expect(h.made.messageBoxes[1]).toEqual({ client: replacement, options: { host: 'https://other.example.com' } })
    expect(manager.getSnapshot().client).toBe(h.made.clients[1])
  })

  it('retries kept payments when a wallet opens, not when its settings change', async () => {
    h.retry = vi.fn(async () => 2)
    await manager.start(startOptions())
    await vi.waitFor(() => expect(events.map(e => e.type)).toEqual(['balance-changed']))
    await new Promise(resolve => setTimeout(resolve, 0))

    await manager.applySettings(settings({ receiveEnabled: true }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(h.retry).toHaveBeenCalledOnce()
    expect(h.retry.mock.calls[0][0]).toMatchObject({ wallet, originator: 'admin.local', identity: IDENTITY, chain: 'main' })
  })

  it('never runs two retries for one wallet at once', async () => {
    h.retry = vi.fn(() => new Promise(() => {}))
    await manager.start(startOptions())
    await manager.stop()
    await manager.start(startOptions())

    expect(h.retry).toHaveBeenCalledOnce()
  })

  it('reports a kept payment the retry gives up on, without its transaction in the notice', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await manager.start(startOptions())
    const dropped = { reason: 'unverifiable', txid: 'ab'.repeat(32), sender: SENDER, amount: 500, payment: { token: { transaction: 'AQID' } } }

    h.retry.mock.calls[0][0].onDropped(dropped)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[DirectPayManager]'), dropped)
    expect(h.warning).toHaveBeenCalledOnce()
    expect(h.warning.mock.calls[0][0]).toContain('500')
    expect(h.warning.mock.calls[0][0]).not.toContain('AQID')
  })
})

describe('DirectPayManager.stop', () => {
  it('closes the client and the relay and clears the snapshot', async () => {
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true, signaling: 'relay', relayUrl: RELAY }) }))
    const [client] = h.made.clients
    const [relay] = h.made.relays

    await manager.stop()

    expect(client.close).toHaveBeenCalledOnce()
    expect(relay.close).toHaveBeenCalledOnce()
    expect(manager.getSnapshot()).toEqual({ client: null, status: 'off', via: null, error: '', received: 0 })
  })

  it('clears the snapshot before the client has finished closing', async () => {
    await manager.start(startOptions())
    h.made.clients[0].close.mockReturnValueOnce(new Promise(() => {}))

    void manager.stop()

    expect(manager.getSnapshot().client).toBeNull()
  })

  it('wins over a start that is still waiting to receive', async () => {
    let listening!: () => void
    h.startReceiving = () => new Promise<void>(resolve => { listening = resolve })
    const pending = manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))
    const [client] = h.made.clients
    expect(manager.getSnapshot()).toMatchObject({ client, status: 'starting' })
    await vi.waitFor(() => expect(client.startReceiving).toHaveBeenCalledOnce())

    await manager.stop()
    listening()
    await pending

    expect(client.close).toHaveBeenCalledOnce()
    expect(manager.getSnapshot()).toEqual({ client: null, status: 'off', via: null, error: '', received: 0 })
  })

  it('stops following settings changes', async () => {
    await manager.start(startOptions())
    expect(settingsListeners).toHaveLength(1)

    await manager.stop()

    expect(settingsListeners).toHaveLength(0)
  })
})

describe('DirectPayManager.applySettings', () => {
  it('starts receiving when receiving is turned on, and does nothing for the same settings', async () => {
    await manager.start(startOptions())
    await manager.applySettings(settings({ receiveEnabled: true }))
    await manager.applySettings(settings({ receiveEnabled: true }))

    expect(h.made.clients).toHaveLength(2)
    expect(h.made.clients[0].close).toHaveBeenCalledOnce()
    expect(h.made.clients[1].startReceiving).toHaveBeenCalledOnce()
    expect(manager.getSnapshot()).toMatchObject({ client: h.made.clients[1], status: 'online' })
  })

  it('does nothing while no wallet is open', async () => {
    await manager.applySettings(settings({ receiveEnabled: true }))

    expect(h.made.clients).toHaveLength(0)
    expect(manager.getSnapshot().status).toBe('off')
  })

  it('follows settings saved on this device', async () => {
    await manager.start(startOptions())
    stored['bsv-desktop-direct-pay-v1'] = JSON.stringify(settings({ receiveEnabled: true }))

    settingsListeners.forEach(fn => fn())
    await vi.waitFor(() => expect(manager.getSnapshot().status).toBe('online'))

    expect(h.made.clients).toHaveLength(2)
  })
})

describe('receiving a payment', () => {
  it('takes it into the wallet, then announces it', async () => {
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))

    const decision = await handlersOf().onPayment(payment, { txid: 'ab'.repeat(32) })

    expect(decision).toBe('accepted')
    expect(h.receive).toHaveBeenCalledWith({ wallet, originator: 'admin.local', identity: IDENTITY, chain: 'main', payment })
    expect(events.map(e => e.type)).toEqual(['balance-changed', 'direct-payment-received'])
    expect(events[1].detail).toEqual({ amount: 1234, sender: SENDER })
    expect(manager.getSnapshot().received).toBe(1)
  })

  it('acks a payment kept for a retry as received', async () => {
    h.receive = vi.fn(async () => 'received')
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))

    await expect(handlersOf().onPayment(payment, { txid: 'ab'.repeat(32) })).resolves.toBe('received')
    expect(manager.getSnapshot().received).toBe(1)
  })

  it('holds off a network switch while it takes the payment, and refuses during one', async () => {
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))
    h.receive = vi.fn(async () => { expect(activeUserWalletOperations()).toBe(1); return 'accepted' })

    await handlersOf().onPayment(payment, { txid: 'ab'.repeat(32) })
    expect(h.receive).toHaveBeenCalledOnce()
    expect(activeUserWalletOperations()).toBe(0)

    setHttpBridgePaused(true)
    try {
      await expect(handlersOf().onPayment(payment, { txid: 'ab'.repeat(32) })).rejects.toThrow(/network is changing/)
    } finally {
      setHttpBridgePaused(false)
    }
    expect(h.receive).toHaveBeenCalledOnce()
  })

  it('passes a refusal back to the client and announces nothing', async () => {
    const refusal = new Error('The wallet could not verify or record this payment')
    h.receive = vi.fn(async () => { throw refusal })
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))

    await expect(handlersOf().onPayment(payment, { txid: 'ab'.repeat(32) })).rejects.toBe(refusal)
    expect(events).toEqual([])
    expect(manager.getSnapshot().received).toBe(0)
  })

  it('still accepts a payment it took when announcing it fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))
    vi.mocked(window.dispatchEvent).mockImplementation(() => { throw new Error('listener failed') })

    await expect(handlersOf().onPayment(payment, { txid: 'ab'.repeat(32) })).resolves.toBe('accepted')
    expect(warn).toHaveBeenCalled()
  })
})
