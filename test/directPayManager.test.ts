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
import { WebRTPayError } from '@bsv/webrtpay'
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
    keep: null as unknown as Mock,
    retry: null as unknown as Mock,
    warning: null as unknown as Mock
  }
})

vi.mock('@bsv/webrtpay', async importOriginal => ({
  ...(await importOriginal<typeof import('@bsv/webrtpay')>()),
  DirectPayClient: vi.fn(function (options: any) {
    const client: any = {
      options,
      startReceiving: vi.fn((...args: unknown[]) => h.startReceiving(client, ...args)),
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
    const provider = async () => []
    const signaler = { options, provider, turnProvider: vi.fn(() => provider), close: vi.fn(async () => {}) }
    h.made.relays.push(signaler)
    return signaler
  })
}))
vi.mock('../src/lib/pages/Dashboard/Payments/directPayments', () => ({
  receiveDirectPayment: (...args: unknown[]) => h.receive(...args),
  keepDirectPayment: (...args: unknown[]) => h.keep(...args),
  retryReceivedDirectPayments: (...args: unknown[]) => h.retry(...args),
  RetryStopped: class RetryStopped extends Error {}
}))
vi.mock('react-toastify', () => ({ toast: { warning: (...args: unknown[]) => h.warning(...args) } }))

import { DirectPayManager } from '../src/lib/services/DirectPayManager'
import { activeUserWalletOperations, beginUserWalletOperation, setHttpBridgePaused } from '../src/lib/services/httpBridgeSession'
import { RetryStopped } from '../src/lib/pages/Dashboard/Payments/directPayments'

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
let onlineListeners: Array<() => void>
let stored: Record<string, string>
let manager: DirectPayManager

/** The handlers the manager passed to startReceiving on the nth client. */
const handlersOf = (n = 0) => h.made.clients[n].startReceiving.mock.calls[0][0]

/** What a message box signaler does once it listens: it polls the box. */
const pollOnce = async (client: any) => { await client.options.signaler?.client?.listMessages?.({ messageBox: 'webrtpay_signals' }) }

beforeEach(() => {
  h.made = { clients: [], messageBoxes: [], relays: [] }
  h.startReceiving = pollOnce
  peerPayClient.listMessages.mockReset()
  h.receive = vi.fn(async () => ({ status: 'accepted', repeat: false, added: true }))
  h.keep = vi.fn(async () => ({ status: 'received', repeat: false, added: false }))
  h.retry = vi.fn(async () => 0)
  h.warning = vi.fn()
  events = []
  settingsListeners = []
  onlineListeners = []
  stored = {}
  vi.stubGlobal('CustomEvent', class { constructor(public type: string, init?: { detail?: unknown }) { this.detail = init?.detail } detail: unknown })
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn((event: { type: string; detail?: unknown }) => { events.push(event); return true }),
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === 'direct-pay-settings-changed') settingsListeners.push(fn)
      if (type === 'online') onlineListeners.push(fn)
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === 'direct-pay-settings-changed') settingsListeners = settingsListeners.filter(f => f !== fn)
      if (type === 'online') onlineListeners = onlineListeners.filter(f => f !== fn)
    })
  })
  vi.stubGlobal('localStorage', { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = v } })
  manager = new DirectPayManager()
})

afterEach(async () => {
  await manager.stop()
  vi.useRealTimers()
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
    expect(manager.getSnapshot()).toEqual({ client, status: 'off', via: 'messagebox', error: '', notice: '', received: 0 })
  })

  it('with receiving on over the message box polls the wallet\'s own host and goes online', async () => {
    const changes: string[] = []
    manager.on('changed', snapshot => changes.push(snapshot.status))

    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))

    expect(h.made.messageBoxes).toHaveLength(1)
    // Audit F19: with a host, list and ack go straight to it instead of an overlay lookup per poll.
    expect(h.made.messageBoxes[0].options).toEqual({ host: HOST, messageBox: 'webrtpay_signals' })
    expect(h.made.clients[0].startReceiving).toHaveBeenCalledOnce()
    expect(manager.getSnapshot()).toMatchObject({ status: 'online', via: 'messagebox', error: '' })
    expect(changes).toEqual(['starting', 'online'])
  })

  it('hands the signaler the wallet\'s message box client, only watching its polls', async () => {
    const box = { sendMessage: vi.fn(async function (this: unknown) { return this }), listMessages: vi.fn(async function (this: unknown) { return [this] }), acknowledgeMessage: vi.fn(async function (this: unknown) { return this }) }
    await manager.start(startOptions({ peerPayClient: box }))
    const { client } = h.made.messageBoxes[0]

    await expect(client.sendMessage({ recipient: SENDER, messageBox: 'b', body: 'x' }, 'https://their.host')).resolves.toBe(box)
    await expect(client.listMessages({ messageBox: 'b', host: HOST })).resolves.toEqual([box])
    await expect(client.acknowledgeMessage({ messageIds: ['1'], host: HOST })).resolves.toBe(box)
    expect(box.sendMessage).toHaveBeenCalledWith({ recipient: SENDER, messageBox: 'b', body: 'x' }, 'https://their.host')
    expect(box.listMessages).toHaveBeenCalledWith({ messageBox: 'b', host: HOST })
    expect(box.acknowledgeMessage).toHaveBeenCalledWith({ messageIds: ['1'], host: HOST })
  })

  // Final review M13: an unreachable host, or a sign-in the host refuses, must not read "Online".
  it('says online through the message box only once a poll of the box has worked', async () => {
    h.startReceiving = async () => {}
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))
    expect(manager.getSnapshot().status).toBe('starting')

    await h.made.messageBoxes[0].client.listMessages({ messageBox: 'webrtpay_signals' })

    expect(manager.getSnapshot()).toMatchObject({ status: 'online', via: 'messagebox', error: '' })
  })

  it('says why after two failed polls in a row, keeps saying it while they fail, and recovers by itself', async () => {
    h.startReceiving = async () => {}
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))
    const box = h.made.messageBoxes[0].client
    peerPayClient.listMessages.mockRejectedValue(new Error('fetch failed'))

    await expect(box.listMessages({ messageBox: 'webrtpay_signals' })).rejects.toThrow('fetch failed')
    expect(manager.getSnapshot().status).toBe('starting') // one failure can be a blip
    await expect(box.listMessages({ messageBox: 'webrtpay_signals' })).rejects.toThrow('fetch failed')
    expect(manager.getSnapshot()).toMatchObject({ status: 'error', via: 'messagebox', error: 'Direct payments cannot be received: the message box cannot be reached (fetch failed). Trying again…' })

    peerPayClient.listMessages.mockResolvedValue([])
    await box.listMessages({ messageBox: 'webrtpay_signals' })
    expect(manager.getSnapshot()).toMatchObject({ status: 'online', error: '' })
    peerPayClient.listMessages.mockRejectedValue(new Error('fetch failed'))
    await expect(box.listMessages({ messageBox: 'webrtpay_signals' })).rejects.toThrow()
    expect(manager.getSnapshot().status).toBe('online') // the count starts over after a success
  })

  it('never fails a poll because showing the status failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.startReceiving = async () => {}
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))
    const failing = () => { throw new Error('listener failed') }
    manager.on('changed', failing)
    peerPayClient.listMessages.mockResolvedValue([{ messageId: 'm1', sender: SENDER, body: '{}' }])

    await expect(h.made.messageBoxes[0].client.listMessages({ messageBox: 'webrtpay_signals' })).resolves.toEqual([{ messageId: 'm1', sender: SENDER, body: '{}' }])
    expect(warn).toHaveBeenCalled()
    manager.off('changed', failing)
  })

  it('leaves the status off while not receiving, whatever the polls of a payment being sent do', async () => {
    await manager.start(startOptions())
    peerPayClient.listMessages.mockRejectedValue(new Error('fetch failed'))
    for (let i = 0; i < 3; i++) await expect(h.made.messageBoxes[0].client.listMessages({ messageBox: 'webrtpay_signals' })).rejects.toThrow()

    expect(manager.getSnapshot()).toMatchObject({ status: 'off', via: 'messagebox', error: '' })
  })

  // Final review D2: one identity on two networks must not take the other network's dials.
  // Mainnet keeps the package's default box, so it still meets other wallets there.
  it.each([['main', 'webrtpay_signals'], ['test', 'webrtpay_signals_test'], ['ttn', 'webrtpay_signals_ttn'], ['tstn', 'webrtpay_signals_tstn']])('signals on %s through the message box %s, and binds the client to that network', async (chain, box) => {
    await manager.start(startOptions({ chain, settings: settings({ receiveEnabled: true }) }))

    expect(h.made.messageBoxes[0].options).toEqual({ host: HOST, messageBox: box })
    expect(h.made.clients[0].options.chain).toBe(chain)
  })

  it('reports an error when receiving cannot start', async () => {
    h.startReceiving = async () => { throw new Error('The relay could not be reached') }

    await manager.start(startOptions({ settings: settings({ receiveEnabled: true, signaling: 'relay', relayUrl: RELAY }) }))

    expect(manager.getSnapshot()).toMatchObject({ status: 'error', via: 'relay', client: h.made.clients[0] })
    expect(manager.getSnapshot().error).toContain('The relay could not be reached')
  })

  it('shows receiving through a relay from its connection: why it is offline, until it is online', async () => {
    const changes: Array<[string, string]> = []
    manager.on('changed', snapshot => changes.push([snapshot.status, snapshot.error]))
    // The relay cannot be reached at first: listen resolves anyway and keeps trying.
    h.startReceiving = async () => {
      const { onStateChange } = h.made.relays[0].options
      onStateChange('connecting')
      onStateChange('offline', new WebRTPayError('peer_unreachable', 'Could not connect to the relay'))
    }

    await manager.start(startOptions({ settings: settings({ receiveEnabled: true, signaling: 'relay', relayUrl: RELAY }) }))
    const [relay] = h.made.relays
    expect(manager.getSnapshot()).toMatchObject({ status: 'error', via: 'relay', client: h.made.clients[0] })
    expect(manager.getSnapshot().error).toMatch(/relay server cannot be reached.*trying again/i)

    // Between tries the reason stays up, rather than flickering to "starting".
    relay.options.onStateChange('connecting')
    expect(manager.getSnapshot().status).toBe('error')
    relay.options.onStateChange('online')
    expect(manager.getSnapshot()).toMatchObject({ status: 'online', error: '' })
    // A dropped connection shows again until the relay is back.
    relay.options.onStateChange('offline', new WebRTPayError('peer_unreachable', 'Relay connection closed'))
    expect(manager.getSnapshot().status).toBe('error')

    expect(changes.map(([status]) => status)).toEqual(['starting', 'error', 'online', 'error'])
    expect(h.made.clients).toHaveLength(1)
    expect(h.made.relays).toHaveLength(1)
  })

  it('goes online through a relay only once the relay has accepted this wallet', async () => {
    let connected!: () => void
    h.startReceiving = async () => { h.made.relays[0].options.onStateChange('connecting'); await new Promise<void>(resolve => { connected = resolve }) }
    const started = manager.start(startOptions({ settings: settings({ receiveEnabled: true, signaling: 'relay', relayUrl: RELAY }) }))
    await vi.waitFor(() => expect(h.made.clients[0].startReceiving).toHaveBeenCalledOnce())
    expect(manager.getSnapshot().status).toBe('starting')

    h.made.relays[0].options.onStateChange('online')
    connected()
    await started

    expect(manager.getSnapshot()).toMatchObject({ status: 'online', via: 'relay', error: '' })
  })

  it('says the relay does not accept this wallet\'s address when it refuses the sign-in (its PUBLIC_URLS)', async () => {
    h.startReceiving = async () => {
      h.made.relays[0].options.onStateChange('offline', new WebRTPayError('auth_failed', 'Relay refused authentication'))
    }

    await manager.start(startOptions({ settings: settings({ receiveEnabled: true, signaling: 'relay', relayUrl: RELAY }) }))

    const { status, error } = manager.getSnapshot()
    expect(status).toBe('error')
    expect(error).toContain(RELAY)
    expect(error).toMatch(/PUBLIC_URLS/)
    expect(error).not.toMatch(/could not sign/)
  })

  // The signaler reports both as auth_failed; only this wallet's own failure carries a cause.
  it('says this wallet could not sign in, not that the relay refused it, when signing the challenge fails', async () => {
    h.startReceiving = async () => {
      h.made.relays[0].options.onStateChange('offline', new WebRTPayError('auth_failed', 'Could not sign the relay challenge', { cause: new Error('User is not authenticated.') }))
    }

    await manager.start(startOptions({ settings: settings({ receiveEnabled: true, signaling: 'relay', relayUrl: RELAY }) }))

    const { status, error } = manager.getSnapshot()
    expect(status).toBe('error')
    expect(error).toBe('Direct payments cannot be received: this wallet could not sign in to the relay server. The wallet said: User is not authenticated. Trying again…')
    expect(error).not.toMatch(/PUBLIC_URLS|did not accept/)
  })

  it('leaves the status off while not receiving, whatever the relay connection does during a payment', async () => {
    await manager.start(startOptions({ settings: settings({ signaling: 'relay', relayUrl: RELAY }) }))
    const [relay] = h.made.relays

    relay.options.onStateChange('connecting')
    relay.options.onStateChange('offline', new WebRTPayError('peer_unreachable', 'Could not connect to the relay'))

    expect(manager.getSnapshot()).toMatchObject({ status: 'off', via: 'relay', error: '' })
  })

  it('ignores a replaced relay', async () => {
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true, signaling: 'relay', relayUrl: RELAY }) }))
    const [old] = h.made.relays
    await manager.applySettings(settings({ receiveEnabled: true }))

    old.options.onStateChange('offline', new WebRTPayError('peer_unreachable', 'Relay connection closed'))

    expect(manager.getSnapshot()).toMatchObject({ status: 'online', via: 'messagebox', error: '' })
  })

  it('starts over at once when the same settings are applied while the relay is unreachable', async () => {
    let down = true
    h.startReceiving = async () => {
      const relay = h.made.relays.at(-1)
      relay.options.onStateChange(down ? 'offline' : 'online', down ? new WebRTPayError('peer_unreachable', 'Could not connect to the relay') : undefined)
    }
    const relaySettings = settings({ receiveEnabled: true, signaling: 'relay', relayUrl: RELAY })
    await manager.start(startOptions({ settings: relaySettings }))
    expect(manager.getSnapshot().status).toBe('error')

    down = false
    // Saving settings applies them twice (the saved-settings event, then C5's explicit apply).
    await Promise.all([manager.applySettings(relaySettings), manager.applySettings(relaySettings)])

    expect(h.made.clients).toHaveLength(2)
    expect(h.made.clients[0].close).toHaveBeenCalledOnce()
    expect(h.made.clients[1].startReceiving).toHaveBeenCalledOnce()
    expect(manager.getSnapshot()).toMatchObject({ client: h.made.clients[1], status: 'online', via: 'relay', error: '' })
    expect(h.retry).toHaveBeenCalledOnce()
  })

  it('does not rebuild for the same settings when they cannot work', async () => {
    const noRelay = settings({ receiveEnabled: true, signaling: 'relay', relayUrl: '' })
    await manager.start(startOptions({ settings: noRelay }))
    await manager.applySettings(noRelay)

    expect(h.made.clients).toHaveLength(1)
    expect(manager.getSnapshot()).toMatchObject({ status: 'error', via: null })
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

  it.each([false, true])('reports "not set up", not an error, for message box signaling without a message box (receiving %s)', async receiveEnabled => {
    await manager.start(startOptions({ peerPayClient: null, messageBoxUrl: undefined, settings: settings({ receiveEnabled }) }))

    expect(manager.getSnapshot()).toMatchObject({ status: 'off', via: null, error: '', client: h.made.clients[0] })
    expect(manager.getSnapshot().notice).toMatch(/message box/i)
    expect(h.made.messageBoxes).toHaveLength(0)
    expect(h.made.clients[0].startReceiving).not.toHaveBeenCalled()
  })

  it('signals through the relay and gathers with the relay\'s TURN servers, asked for through its caching provider (Ruling 27)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const relaySettings = settings({ receiveEnabled: true, signaling: 'relay', relayUrl: RELAY })
    await manager.start(startOptions({ settings: relaySettings }))

    const [relay] = h.made.relays
    const [client] = h.made.clients
    expect(relay.options).toMatchObject({ url: RELAY, wallet, originator: 'admin.local' })
    expect(h.made.messageBoxes).toHaveLength(0)
    expect(client.options.signaler).toBe(relay)
    expect(client.options.rtc).toEqual({ iceServers: iceServersFrom(relaySettings) })
    // One provider for the client's life: it reuses live credentials instead of asking the
    // relay (and spending this address's TURN budget) on every gather.
    expect(relay.turnProvider).toHaveBeenCalledOnce()
    expect(client.options.iceServersProvider).toBe(relay.provider)
    // The provider's servers replace the relay's per-connection ones; nothing else updates the client.
    expect(relay.options.onIceServers).toBeUndefined()
    expect(client.updateRtc).not.toHaveBeenCalled()

    const failure = new WebRTPayError('rate_limited', 'TURN budget spent')
    client.options.onIceServersProviderError(failure)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[DirectPayManager]'), failure)
  })

  it('asks no provider for ICE servers when signaling through the message box', async () => {
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))

    expect(h.made.clients[0].options.iceServersProvider).toBeUndefined()
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
    const replacement = { ...peerPayClient, listMessages: vi.fn() }
    await manager.start(startOptions({ peerPayClient: replacement, messageBoxUrl: 'https://other.example.com' }))

    expect(h.made.clients).toHaveLength(2)
    expect(h.made.clients[0].close).toHaveBeenCalledOnce()
    expect(h.made.messageBoxes[1].options).toEqual({ host: 'https://other.example.com', messageBox: 'webrtpay_signals' })
    await h.made.messageBoxes[1].client.listMessages({ messageBox: 'webrtpay_signals' })
    expect(replacement.listMessages).toHaveBeenCalledOnce()
    expect(manager.getSnapshot().client).toBe(h.made.clients[1])
  })

  it('retries kept payments when a wallet opens, those that need attention too, and not when its settings change', async () => {
    h.retry = vi.fn(async () => 2)
    await manager.start(startOptions())
    await vi.waitFor(() => expect(events.map(e => e.type)).toEqual(['balance-changed']))
    await new Promise(resolve => setTimeout(resolve, 0))

    await manager.applySettings(settings({ receiveEnabled: true }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(h.retry).toHaveBeenCalledOnce()
    expect(h.retry.mock.calls[0][0]).toMatchObject({ wallet, originator: 'admin.local', identity: IDENTITY, chain: 'main', includeNeedsAttention: true })
  })

  // Final review D3/D5: a desktop wallet stays open for days; "retrying automatically" must be true.
  it('keeps retrying while the wallet is open: after 60 s, backing off to 15 minutes, without those that need attention', async () => {
    vi.useFakeTimers()
    await manager.start(startOptions())
    await vi.advanceTimersByTimeAsync(0)
    expect(h.retry).toHaveBeenCalledTimes(1)

    const calls: number[] = []
    for (const wait of [60, 120, 240, 480, 900, 900].map(s => s * 1000)) {
      await vi.advanceTimersByTimeAsync(wait - 1)
      calls.push(h.retry.mock.calls.length)
      await vi.advanceTimersByTimeAsync(1)
      calls.push(h.retry.mock.calls.length)
    }
    expect(calls).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7])
    expect(h.retry.mock.calls.slice(1).map(([o]) => o.includeNeedsAttention)).toEqual([false, false, false, false, false, false])
  })

  it('retries at once, those that need attention too, when the network comes back, and starts the back-off over', async () => {
    vi.useFakeTimers()
    await manager.start(startOptions())
    await vi.advanceTimersByTimeAsync(60_000 + 120_000)
    expect(h.retry).toHaveBeenCalledTimes(3)

    expect(onlineListeners).toHaveLength(1)
    onlineListeners[0]()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.retry).toHaveBeenCalledTimes(4)
    expect(h.retry.mock.calls[3][0]).toMatchObject({ includeNeedsAttention: true })

    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.retry).toHaveBeenCalledTimes(5)
  })

  it('brings the next retry forward to 60 s when a payment is newly kept', async () => {
    vi.useFakeTimers()
    h.receive = vi.fn(async () => ({ status: 'received', repeat: false, added: false }))
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))
    await vi.advanceTimersByTimeAsync(60_000 + 120_000 + 240_000)
    expect(h.retry).toHaveBeenCalledTimes(4) // the next one is 480 s away

    await handlersOf().onPayment(payment, { txid: 'ab'.repeat(32) })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(h.retry).toHaveBeenCalledTimes(5)
  })

  it('takes a wallet operation for each wallet call of a retry, never across the waits between them', async () => {
    const held: number[] = []
    h.retry = vi.fn(async (o: any) => {
      held.push(activeUserWalletOperations())
      await o.run(async () => { held.push(activeUserWalletOperations()) })
      held.push(activeUserWalletOperations())
      await o.run(async () => { held.push(activeUserWalletOperations()) })
      return 0
    })
    await manager.start(startOptions())
    await vi.waitFor(() => expect(held).toHaveLength(4))

    expect(held).toEqual([0, 1, 0, 1])
    expect(activeUserWalletOperations()).toBe(0)
  })

  // Final review M12: a stalled wallet call must not hold off Lock, a switch or removal for long.
  it('ends a pass whose wallet call stalls, releasing its operation, and tries again later', async () => {
    vi.useFakeTimers()
    let stopped: unknown
    h.retry = vi.fn().mockImplementationOnce(async (o: any) => {
      try { await o.run(() => new Promise(() => {})) } catch (e) { stopped = e }
      return 0
    }).mockResolvedValue(0)
    await manager.start(startOptions())
    await vi.advanceTimersByTimeAsync(0)
    expect(activeUserWalletOperations()).toBe(1)

    await vi.advanceTimersByTimeAsync(15_000)

    expect(stopped).toBeInstanceOf(RetryStopped)
    expect(activeUserWalletOperations()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.retry).toHaveBeenCalledTimes(2)
  })

  it('skips a retry while the wallet is paused or busy, and tries again a second after it is free', async () => {
    vi.useFakeTimers()
    let held = -1
    h.retry = vi.fn(async (o: any) => { await o.run(async () => { held = activeUserWalletOperations() }); return 0 })
    setHttpBridgePaused(true)
    try {
      await manager.start(startOptions())
      await vi.advanceTimersByTimeAsync(5000)
      expect(h.retry).not.toHaveBeenCalled()
    } finally {
      setHttpBridgePaused(false)
    }
    const release = beginUserWalletOperation() // a payment in progress
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.retry).not.toHaveBeenCalled()
    release()

    await vi.advanceTimersByTimeAsync(1000)

    expect(h.retry).toHaveBeenCalledOnce()
    expect(h.retry.mock.calls[0][0]).toMatchObject({ includeNeedsAttention: true })
    expect(held).toBe(1)
    expect(activeUserWalletOperations()).toBe(0)
  })

  it('stops a pass between payments when the wallet becomes busy, and goes on a second after it is free', async () => {
    vi.useFakeTimers()
    let other: (() => void) | undefined
    const outcomes: string[] = []
    h.retry = vi.fn(async (o: any) => {
      for (const n of [1, 2]) {
        try {
          await o.run(async () => { if (n === 1 && !other) other = beginUserWalletOperation() })
          outcomes.push(`ran ${n}`)
        } catch (e) {
          outcomes.push(e instanceof RetryStopped ? `stopped at ${n}` : 'other')
          break
        }
      }
      return 0
    })
    await manager.start(startOptions())
    await vi.advanceTimersByTimeAsync(0)
    expect(outcomes).toEqual(['ran 1', 'stopped at 2'])
    other!()

    await vi.advanceTimersByTimeAsync(1000)

    expect(h.retry).toHaveBeenCalledTimes(2)
    expect(h.retry.mock.calls[1][0]).toMatchObject({ includeNeedsAttention: true }) // that pass did not get to them
    expect(outcomes).toEqual(['ran 1', 'stopped at 2', 'ran 1', 'ran 2'])
    expect(activeUserWalletOperations()).toBe(0)
  })

  it('stops retrying when the wallet closes, and retries when it opens again', async () => {
    vi.useFakeTimers()
    setHttpBridgePaused(true)
    try {
      await manager.start(startOptions())
      await manager.stop()
    } finally {
      setHttpBridgePaused(false)
    }
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.retry).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(onlineListeners).toHaveLength(0)

    await manager.start(startOptions())
    await vi.advanceTimersByTimeAsync(0)

    expect(h.retry).toHaveBeenCalledOnce()
    await manager.stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(onlineListeners).toHaveLength(0)
  })

  it('never runs two retries for one wallet at once, and runs the reopened wallet\'s once the first ends', async () => {
    let finish!: (added: number) => void
    h.retry = vi.fn().mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve })).mockResolvedValue(0)
    await manager.start(startOptions())
    await vi.waitFor(() => expect(h.retry).toHaveBeenCalledOnce())
    await manager.stop()
    await manager.start(startOptions())
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(h.retry).toHaveBeenCalledOnce()
    finish(0)
    await vi.waitFor(() => expect(h.retry).toHaveBeenCalledTimes(2))
    expect(activeUserWalletOperations()).toBe(0)
  })

  // Final review D4: the details stay in the kept list (and its Copy recovery details), not in
  // a console nobody keeps. The notice names the payer, so the user knows whom it came from.
  it('tells the user when a kept payment needs attention, naming its amount and sender, and logs nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await manager.start(startOptions())
    await vi.waitFor(() => expect(h.retry).toHaveBeenCalledOnce())
    expect(h.retry.mock.calls[0][0]).toMatchObject({ includeNeedsAttention: true })
    const kept = { needsAttention: { since: 1, reason: 'unverifiable' }, txid: 'ab'.repeat(32), sender: SENDER, amount: 1500, payment: { token: { transaction: 'AQID' } } }

    h.retry.mock.calls[0][0].onNeedsAttention(kept)

    expect(warn).not.toHaveBeenCalled()
    expect(h.warning).toHaveBeenCalledOnce()
    const notice = h.warning.mock.calls[0][0]
    expect(notice).toContain('1,500 satoshis')
    expect(notice).toContain(SENDER.slice(0, 12))
    expect(notice).toMatch(/needs attention/)
    expect(notice).toMatch(/Payments/)
    expect(notice).not.toContain('AQID')
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
    expect(manager.getSnapshot()).toEqual({ client: null, status: 'off', via: null, error: '', notice: '', received: 0 })
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
    expect(manager.getSnapshot()).toEqual({ client: null, status: 'off', via: null, error: '', notice: '', received: 0 })
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
    expect(events[1].detail).toEqual({ amount: 1234, sender: SENDER, status: 'accepted' })
    expect(manager.getSnapshot().received).toBe(1)
  })

  it('acks a payment kept for a retry as received, and announces it without a balance change', async () => {
    h.receive = vi.fn(async () => ({ status: 'received', repeat: false, added: false }))
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))

    await expect(handlersOf().onPayment(payment, { txid: 'ab'.repeat(32) })).resolves.toBe('received')
    expect(manager.getSnapshot().received).toBe(1)
    expect(events.map(e => e.type)).toEqual(['direct-payment-received'])
    // Final review D6/M11: the page must not announce it as added.
    expect(events[0].detail).toEqual({ amount: 1234, sender: SENDER, status: 'received' })
  })

  it('holds off a network switch while it takes the payment', async () => {
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))
    await vi.waitFor(() => expect(activeUserWalletOperations()).toBe(0)) // the kept-payment retry is done
    h.receive = vi.fn(async () => { expect(activeUserWalletOperations()).toBe(1); return { status: 'accepted', repeat: false, added: true } })

    await handlersOf().onPayment(payment, { txid: 'ab'.repeat(32) })
    expect(h.receive).toHaveBeenCalledOnce()
    expect(activeUserWalletOperations()).toBe(0)
  })

  // Final review M10: by then the payer has broadcast it; refusing would strand it until a redelivery.
  it('keeps, rather than refuses, a payment that arrives while a network or profile switch holds wallet work off', async () => {
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))
    await vi.waitFor(() => expect(h.retry).toHaveBeenCalledOnce())

    setHttpBridgePaused(true)
    try {
      await expect(handlersOf().onPayment(payment, { txid: 'ab'.repeat(32) })).resolves.toBe('received')
    } finally {
      setHttpBridgePaused(false)
    }
    expect(h.receive).not.toHaveBeenCalled()
    expect(h.keep).toHaveBeenCalledWith({ wallet, originator: 'admin.local', identity: IDENTITY, chain: 'main', payment })
    expect(events.map(e => e.type)).toEqual(['direct-payment-received'])
  })

  it.each(['accepted', 'received'] as const)('announces a payment once: a redelivery after a lost ack is acked %s, not announced again', async status => {
    h.receive = vi.fn(async () => ({ status, repeat: true, added: false }))
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))

    await expect(handlersOf().onPayment(payment, { txid: 'ab'.repeat(32) })).resolves.toBe(status)

    expect(events).toEqual([])
    expect(manager.getSnapshot().received).toBe(0)
  })

  it('reports the balance change when a redelivery is what the wallet finally adds, without announcing it again', async () => {
    // Kept earlier (announced then); the payer delivered it again and this time the wallet took it.
    h.receive = vi.fn(async () => ({ status: 'accepted', repeat: true, added: true }))
    await manager.start(startOptions({ settings: settings({ receiveEnabled: true }) }))

    await expect(handlersOf().onPayment(payment, { txid: 'ab'.repeat(32) })).resolves.toBe('accepted')

    expect(events.map(e => e.type)).toEqual(['balance-changed'])
    expect(manager.getSnapshot().received).toBe(0)
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
