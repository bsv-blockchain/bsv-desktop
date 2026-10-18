/**
 * DirectPayManager — owns the open wallet's direct (peer-to-peer) payment client.
 *
 * WalletService starts it with the wallet, beside the PeerPay client, and stops it at
 * the same places. While a wallet is open there is always a client, so offer and answer
 * codes work. Dialing and receiving by identity key also need a signaler, chosen in the
 * device settings: the message box (this wallet's own host) or a relay server. Receiving
 * is on only when the user turned it on; payments are taken into the wallet at once.
 * Through a relay, receiving follows the relay connection, which reconnects by itself, and
 * every connection may use the short-lived TURN servers the relay hands out.
 *
 * React integration: subscribe to 'changed', like PeerPayManager.
 */

import { toast } from 'react-toastify'
import type { WalletInterface } from '@bsv/sdk'
import { DirectPayClient, MessageBoxSignaler, RelaySignaler } from '@bsv/webrtpay'
import type { IncomingPayment, MessageBoxLike, PaymentDecision, RelayConnectionState, Signaler, WebRTPayError } from '@bsv/webrtpay'
import { EventEmittable } from './EventEmittable'
import { beginUserWalletOperation } from './httpBridgeSession'
import { iceServersFrom, loadDirectPaySettings, subscribeDirectPaySettings, type DirectPaySettings } from '../utils/directPaySettings'
import { receiveDirectPayment, retryReceivedDirectPayments, type DirectReceipt, type DroppedDirectPayment } from '../pages/Dashboard/Payments/directPayments'

/**
 * `off`: not receiving (sending works if `via` is set; see `notice` when it is not);
 * `starting`: setting up receiving, or connecting to the relay; `online`: receiving;
 * `error`: see `error`.
 */
export type DirectPayStatus = 'off' | 'starting' | 'online' | 'error'

export interface DirectPaySnapshot {
  /** For sending and code exchange; null while no wallet is open. */
  client: DirectPayClient | null
  status: DirectPayStatus
  /** How this wallet reaches others by identity key; null when it cannot. */
  via: 'messagebox' | 'relay' | null
  /** Why `status` is `error`, for the user; empty otherwise. */
  error: string
  /**
   * Why direct payments by identity key are not set up, when that is not a failure: this
   * wallet has no message box to signal through. `status` is then `off`. Empty otherwise.
   */
  notice: string
  /** Direct payments received since the wallet opened. */
  received: number
}

export interface DirectPayStartOptions {
  wallet: WalletInterface
  originator: string
  /** This wallet's identity key. */
  identity: string
  chain: string
  /** Carries signals when the settings choose the message box; null without a message box. */
  peerPayClient: MessageBoxLike | null
  /**
   * The message box host to poll for signals. Without it every poll and acknowledgement
   * starts with an overlay lookup (audit F19).
   */
  messageBoxUrl?: string
  settings: DirectPaySettings
}

const OFF: DirectPaySnapshot = { client: null, status: 'off', via: null, error: '', notice: '', received: 0 }

/** How often a retry of kept payments checks whether a network switch has finished. */
const OPERATION_WAIT_MS = 1000

const NO_RELAY = 'Enter a relay server address in Settings, or use the message box for direct payments.'
const NO_MESSAGE_BOX = 'Direct payments reach other wallets through the message box. Connect a message box in Settings, or use a relay server.'

type Started = { options: DirectPayStartOptions; relay: RelaySignaler | null; unsubscribe: () => void }

export class DirectPayManager extends EventEmittable<{ changed: DirectPaySnapshot }> {
  private _snapshot: DirectPaySnapshot = OFF
  private _started: Started | null = null
  /** Settles when the current start has finished setting up receiving. */
  private _starting: Promise<void> = Promise.resolve()
  /** Bumped by every start and stop; a start that is no longer current changes nothing. */
  private _generation = 0
  /** `identity:chain` of wallets whose kept payments are being retried. */
  private readonly _retrying = new Set<string>()

  getSnapshot(): DirectPaySnapshot {
    return this._snapshot
  }

  /**
   * Starts direct payments for a wallet. Called again with the same inputs it does
   * nothing, unless receiving failed (say the relay is unreachable): then it starts over
   * at once instead of waiting for the relay signaler's next try. With different inputs
   * it replaces the client. Never rejects: problems show as `status: 'error'`. Resolves
   * once receiving is set up; a relay that could not be reached yet is retried by its
   * signaler, and the status follows it.
   */
  start(o: DirectPayStartOptions): Promise<void> {
    const previous = this._started?.options
    if (previous && sameInputs(previous, o) && !receiveFailed(this._snapshot)) return this._starting
    const sameWallet = previous !== undefined && isSameWallet(previous, o)
    const received = sameWallet ? this._snapshot.received : 0
    const closing = this._teardown()
    this._starting = this._launch(o, received, closing)
    if (!sameWallet) this._retryKeptPayments(o)
    return this._starting
  }

  /** Uses new settings for the open wallet (no-op when nothing changed or none is open). */
  async applySettings(s: DirectPaySettings): Promise<void> {
    if (!this._started) return
    await this.start({ ...this._started.options, settings: s })
  }

  /** Closes the client and signaler. The snapshot clears at once; never rejects. */
  async stop(): Promise<void> {
    const closing = this._teardown()
    if (this._snapshot !== OFF) this._set(OFF)
    await closing
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /** Sets up a client synchronously (so the snapshot has it at once), then receiving. */
  private async _launch(o: DirectPayStartOptions, received: number, closing: Promise<void>): Promise<void> {
    const generation = this._generation
    let client: DirectPayClient | null = null
    let relay: RelaySignaler | null = null
    let signaler: Signaler | undefined
    let via: DirectPaySnapshot['via'] = null
    let error = ''
    let notice = ''
    try {
      if (o.settings.signaling === 'relay') {
        if (!o.settings.relayUrl) {
          error = NO_RELAY
        } else {
          const url = o.settings.relayUrl
          relay = new RelaySignaler({
            url,
            wallet: o.wallet,
            originator: o.originator,
            onStateChange: (state, e) => this._relayChanged(generation, o.settings.receiveEnabled, url, state, e)
          })
          signaler = relay
          via = 'relay'
        }
      } else if (!o.peerPayClient) {
        notice = NO_MESSAGE_BOX
      } else {
        signaler = new MessageBoxSignaler(o.peerPayClient, { host: o.messageBoxUrl || undefined })
        via = 'messagebox'
      }
      client = new DirectPayClient({
        wallet: o.wallet,
        originator: o.originator,
        chain: o.chain,
        signaler,
        rtc: { iceServers: iceServersFrom(o.settings) },
        // The relay's TURN servers, asked for before each ICE gather (Ruling 27). One provider
        // for the client's life: it reuses live credentials, because each request spends one
        // of this address's few an hour and strangers can make a payee gather.
        ...(relay && {
          iceServersProvider: relay.turnProvider(),
          onIceServersProviderError: (e: unknown) => console.warn("[DirectPayManager] Connecting without the relay's TURN servers:", e)
        })
      })
    } catch (e) {
      void relay?.close().catch(() => {})
      relay = null
      via = null
      notice = ''
      error = `Direct payments could not be set up: ${messageOf(e)}`
    }

    const receive = !error && !notice && o.settings.receiveEnabled
    this._started = {
      options: o,
      relay,
      unsubscribe: subscribeDirectPaySettings(() => { void this.applySettings(loadDirectPaySettings()) })
    }
    this._set({ client, status: error ? 'error' : receive ? 'starting' : 'off', via, error, notice, received })
    if (!receive || !client) return

    // The previous client stops listening first, so two never answer the same offer.
    await closing
    if (generation !== this._generation) return
    try {
      await client.startReceiving({
        onPayment: p => this._onPayment(o, p),
        onError: e => console.warn('[DirectPayManager] Inbound direct payment session failed:', e)
      })
      // Through a relay the status follows its connection (see _relayChanged).
      if (generation === this._generation && !relay) this._update({ status: 'online', error: '' })
    } catch (e) {
      // Neither signaler fails to listen while it is open; this is a client that cannot receive.
      if (generation === this._generation) this._update({ status: 'error', error: `Direct payments cannot be received: ${messageOf(e)}` })
    }
  }

  /**
   * While receiving through a relay, the status follows its connection: `starting` while it
   * connects, `online` once the relay accepted this wallet, and `error` with the reason
   * while it is offline (the signaler keeps trying, and the status recovers by itself).
   * While not receiving, the relay connects only for payments, and the status stays `off`.
   */
  private _relayChanged(generation: number, receiving: boolean, url: string, state: RelayConnectionState, e?: WebRTPayError): void {
    if (generation !== this._generation || !receiving) return
    if (state === 'online') this._update({ status: 'online', error: '' })
    else if (state === 'offline' && e) this._update({ status: 'error', error: `Direct payments cannot be received: ${relayProblem(e, url)}` })
    // Connecting again: keep showing why the last try failed until one succeeds.
    else if (this._snapshot.status !== 'error') this._update({ status: 'starting', error: '' })
  }

  /** Takes a payment into the wallet; a throw becomes a `rejected` ack for the payer. */
  private async _onPayment(o: DirectPayStartOptions, p: IncomingPayment): Promise<PaymentDecision> {
    // Throws while the network is changing: the payer keeps the payment and can retry.
    const release = beginUserWalletOperation()
    let receipt: DirectReceipt
    try {
      receipt = await receiveDirectPayment({ wallet: o.wallet, originator: o.originator, identity: o.identity, chain: o.chain, payment: p })
    } finally {
      release()
    }
    // The payment is taken: nothing below may turn the ack into a rejection.
    try {
      // In the wallet now, even when it is a redelivery of a payment kept earlier.
      if (receipt.added) window.dispatchEvent(new CustomEvent('balance-changed'))
      // Delivered again after a lost ack: it was announced the first time.
      if (!receipt.repeat) {
        const current = this._started?.options
        if (current && isSameWallet(current, o)) this._set({ ...this._snapshot, received: this._snapshot.received + 1 })
        window.dispatchEvent(new CustomEvent('direct-payment-received', { detail: { amount: p.token.amount, sender: p.sender } }))
      }
    } catch (e) {
      console.warn('[DirectPayManager] Could not announce a received direct payment:', e)
    }
    return receipt.status
  }

  /**
   * Offers payments kept for a retry (acknowledged as received while the wallet could not
   * take them) to the wallet again, once per wallet opening and never twice at once.
   */
  private _retryKeptPayments(o: DirectPayStartOptions): void {
    const key = `${o.identity}:${o.chain}`
    if (this._retrying.has(key)) return
    this._retrying.add(key)
    void this._runRetry(o).finally(() => this._retrying.delete(key))
  }

  /**
   * Runs the retry inside a user wallet operation, so a network switch or wallet removal
   * cannot cut storage off while a payment is being taken. A wallet opened by a network
   * switch opens while the switch still holds wallet work off: the retry waits for the
   * switch to finish, and is dropped if that wallet closes first. Never rejects.
   */
  private async _runRetry(o: DirectPayStartOptions): Promise<void> {
    let release: () => void
    for (;;) {
      if (!this._started || !isSameWallet(this._started.options, o)) return
      try {
        release = beginUserWalletOperation()
        break
      } catch {
        await new Promise(resolve => setTimeout(resolve, OPERATION_WAIT_MS))
      }
    }
    try {
      const added = await retryReceivedDirectPayments({
        wallet: o.wallet,
        originator: o.originator,
        identity: o.identity,
        chain: o.chain,
        onDropped: dropped => this._reportDropped(dropped)
      })
      if (added > 0) window.dispatchEvent(new CustomEvent('balance-changed'))
    } catch (e) {
      console.warn('[DirectPayManager] Retrying kept direct payments failed:', e)
    } finally {
      release()
    }
  }

  /** The payer will not send a dropped payment again, so keep its details for recovery. */
  private _reportDropped(d: DroppedDirectPayment): void {
    console.warn('[DirectPayManager] Gave up on a kept direct payment; its transaction and derivation are kept here for manual recovery:', d)
    const why = d.reason === 'refused' ? 'was refused by your wallet' : 'still could not be verified after repeated tries'
    toast.warning(`A direct payment of ${d.amount} satoshis ${why} and was not added to your wallet.`)
  }

  /** Detaches the current client and signaler; returns their closing (never rejects). */
  private _teardown(): Promise<void> {
    this._generation++
    const started = this._started
    const client = this._snapshot.client
    this._started = null
    this._starting = Promise.resolve()
    if (!started) return Promise.resolve()
    started.unsubscribe()
    // Close the relay too, so a listen still connecting cannot hold the client's close.
    return Promise.allSettled([client?.close(), started.relay?.close()]).then(results => {
      for (const r of results) if (r.status === 'rejected') console.warn('[DirectPayManager] Close failed:', r.reason)
    })
  }

  private _set(snapshot: DirectPaySnapshot) {
    this._snapshot = snapshot
    this.emit('changed', snapshot)
  }

  /** Changes the status and its message; emits only when they change. */
  private _update(change: Pick<DirectPaySnapshot, 'status' | 'error'>) {
    if (change.status !== this._snapshot.status || change.error !== this._snapshot.error) this._set({ ...this._snapshot, ...change })
  }
}

function isSameWallet(a: DirectPayStartOptions, b: DirectPayStartOptions): boolean {
  return a.wallet === b.wallet && a.identity === b.identity && a.chain === b.chain
}

/**
 * Receiving was set up and failed (the relay is offline). A setup problem (no relay
 * address, no message box) leaves `via` null instead, and starting over with the same
 * inputs would not fix it.
 */
function receiveFailed(s: DirectPaySnapshot): boolean {
  return s.status === 'error' && s.via !== null
}

function sameInputs(a: DirectPayStartOptions, b: DirectPayStartOptions): boolean {
  return isSameWallet(a, b) &&
    a.originator === b.originator &&
    a.peerPayClient === b.peerPayClient &&
    (a.messageBoxUrl || '') === (b.messageBoxUrl || '') &&
    JSON.stringify(a.settings) === JSON.stringify(b.settings)
}

/** Why the relay connection is down, for the user. */
function relayProblem(e: WebRTPayError, url: string): string {
  switch (e.code) {
    case 'auth_failed': {
      // The signaler gives a cause (the wallet's error) only when this wallet could not sign
      // the relay's challenge; a relay that refused the signature sends no reason.
      const { cause } = e as WebRTPayError & { cause?: unknown }
      if (cause !== undefined) return `this wallet could not sign in to the relay server. The wallet said: ${messageOf(cause).replace(/\.$/, '')}. Trying again…`
      return `the relay server did not accept this wallet at ${url}. The address in Settings must be exactly one the relay serves (its PUBLIC_URLS). Trying again…`
    }
    case 'rate_limited':
      return 'the relay server is limiting connections from this network. Trying again…'
    case 'peer_unreachable':
      return 'the relay server cannot be reached. Trying again…'
    default:
      return `${e.message}. Trying again…`
  }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
