/**
 * DirectPayManager — owns the open wallet's direct (peer-to-peer) payment client.
 *
 * WalletService starts it with the wallet, beside the PeerPay client, and stops it at
 * the same places. While a wallet is open there is always a client, so offer and answer
 * codes work. Dialing and receiving by identity key also need a signaler, chosen in the
 * device settings: the message box (this wallet's own host) or a relay server. Receiving
 * is on only when the user turned it on; payments are taken into the wallet at once.
 *
 * React integration: subscribe to 'changed', like PeerPayManager.
 */

import { toast } from 'react-toastify'
import type { WalletInterface } from '@bsv/sdk'
import { DirectPayClient, MessageBoxSignaler, RelaySignaler } from '@bsv/webrtpay'
import type { IncomingPayment, MessageBoxLike, PaymentDecision, Signaler } from '@bsv/webrtpay'
import { EventEmittable } from './EventEmittable'
import { beginUserWalletOperation } from './httpBridgeSession'
import { iceServersFrom, loadDirectPaySettings, subscribeDirectPaySettings, type DirectPaySettings } from '../utils/directPaySettings'
import { receiveDirectPayment, retryReceivedDirectPayments, type DroppedDirectPayment } from '../pages/Dashboard/Payments/directPayments'

/**
 * `off`: not receiving (sending works if `via` is set); `starting`: setting up receiving;
 * `online`: receiving; `error`: see `error`.
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

const OFF: DirectPaySnapshot = { client: null, status: 'off', via: null, error: '', received: 0 }

/** First pause before trying to receive again after a failure; doubles with each failure. */
const RECEIVE_RETRY_MIN_MS = 1000
/** Longest pause between tries to receive. */
const RECEIVE_RETRY_MAX_MS = 30000

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
  /** The next try to receive after a failure; cleared by every start and stop. */
  private _receiveRetry: ReturnType<typeof setTimeout> | undefined

  getSnapshot(): DirectPaySnapshot {
    return this._snapshot
  }

  /**
   * Starts direct payments for a wallet. Called again with the same inputs it does
   * nothing, unless receiving failed: then it starts over at once. With different inputs
   * it replaces the client. Never rejects: problems show as `status: 'error'`. Resolves
   * once the first try to receive has finished; a failed one is tried again later.
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
    const iceServers = iceServersFrom(o.settings)
    let client: DirectPayClient | null = null
    let relay: RelaySignaler | null = null
    let signaler: Signaler | undefined
    let via: DirectPaySnapshot['via'] = null
    let error = ''
    try {
      if (o.settings.signaling === 'relay') {
        if (!o.settings.relayUrl) {
          error = NO_RELAY
        } else {
          relay = new RelaySignaler({
            url: o.settings.relayUrl,
            wallet: o.wallet,
            originator: o.originator,
            // The relay may hand out STUN/TURN servers of its own; use them as well.
            onIceServers: servers => client?.updateRtc({ iceServers: [...iceServers, ...servers] })
          })
          signaler = relay
          via = 'relay'
        }
      } else if (!o.peerPayClient) {
        error = NO_MESSAGE_BOX
      } else {
        signaler = new MessageBoxSignaler(o.peerPayClient, { host: o.messageBoxUrl || undefined })
        via = 'messagebox'
      }
      client = new DirectPayClient({ wallet: o.wallet, originator: o.originator, chain: o.chain, signaler, rtc: { iceServers } })
    } catch (e) {
      void relay?.close().catch(() => {})
      relay = null
      via = null
      error = `Direct payments could not be set up: ${messageOf(e)}`
    }

    const receive = !error && o.settings.receiveEnabled
    this._started = {
      options: o,
      relay,
      unsubscribe: subscribeDirectPaySettings(() => { void this.applySettings(loadDirectPaySettings()) })
    }
    this._set({ client, status: error ? 'error' : receive ? 'starting' : 'off', via, error, received })
    if (!receive || !client) return

    // The previous client stops listening first, so two never answer the same offer.
    await closing
    if (generation !== this._generation) return
    await this._receive(o, client, generation, 0)
  }

  /**
   * Tries once to start receiving on `client`. After a failure (say, the relay cannot be
   * reached yet) the status is `error` and the same client tries again after a pause that
   * doubles up to 30 s, for as long as this start is current. The spec's service "keeps
   * listening while the wallet is unlocked", and a relay down at unlock must not end that.
   */
  private async _receive(o: DirectPayStartOptions, client: DirectPayClient, generation: number, failures: number): Promise<void> {
    try {
      await client.startReceiving({
        onPayment: p => this._onPayment(o, p),
        onError: e => console.warn('[DirectPayManager] Inbound direct payment session failed:', e)
      })
      if (generation === this._generation) this._set({ ...this._snapshot, status: 'online', error: '' })
    } catch (e) {
      if (generation !== this._generation) return
      const error = `Direct payments cannot be received: ${messageOf(e)}`
      if (this._snapshot.status !== 'error' || this._snapshot.error !== error) this._set({ ...this._snapshot, status: 'error', error })
      const pause = Math.min(RECEIVE_RETRY_MIN_MS * 2 ** failures, RECEIVE_RETRY_MAX_MS)
      this._receiveRetry = setTimeout(() => {
        this._receiveRetry = undefined
        if (generation === this._generation) void this._receive(o, client, generation, failures + 1)
      }, pause)
    }
  }

  /** Takes a payment into the wallet; a throw becomes a `rejected` ack for the payer. */
  private async _onPayment(o: DirectPayStartOptions, p: IncomingPayment): Promise<PaymentDecision> {
    // Throws while the network is changing: the payer keeps the payment and can retry.
    const release = beginUserWalletOperation()
    let decision: 'accepted' | 'received'
    try {
      decision = await receiveDirectPayment({ wallet: o.wallet, originator: o.originator, identity: o.identity, chain: o.chain, payment: p })
    } finally {
      release()
    }
    // The payment is taken: nothing below may turn the ack into a rejection.
    try {
      const current = this._started?.options
      if (current && isSameWallet(current, o)) this._set({ ...this._snapshot, received: this._snapshot.received + 1 })
      window.dispatchEvent(new CustomEvent('balance-changed'))
      window.dispatchEvent(new CustomEvent('direct-payment-received', { detail: { amount: p.token.amount, sender: p.sender } }))
    } catch (e) {
      console.warn('[DirectPayManager] Could not announce a received direct payment:', e)
    }
    return decision
  }

  /**
   * Offers payments kept for a retry (acknowledged as received while the wallet could not
   * take them) to the wallet again, once per wallet opening and never twice at once.
   */
  private _retryKeptPayments(o: DirectPayStartOptions): void {
    const key = `${o.identity}:${o.chain}`
    if (this._retrying.has(key)) return
    this._retrying.add(key)
    retryReceivedDirectPayments({
      wallet: o.wallet,
      originator: o.originator,
      identity: o.identity,
      chain: o.chain,
      onDropped: dropped => this._reportDropped(dropped)
    })
      .then(added => { if (added > 0) window.dispatchEvent(new CustomEvent('balance-changed')) })
      .catch(e => console.warn('[DirectPayManager] Retrying kept direct payments failed:', e))
      .finally(() => this._retrying.delete(key))
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
    clearTimeout(this._receiveRetry)
    this._receiveRetry = undefined
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
}

function isSameWallet(a: DirectPayStartOptions, b: DirectPayStartOptions): boolean {
  return a.wallet === b.wallet && a.identity === b.identity && a.chain === b.chain
}

/**
 * Receiving was set up and failed. A setup problem (no relay address, no message box)
 * leaves `via` null instead, and starting over with the same inputs would not fix it.
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

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
