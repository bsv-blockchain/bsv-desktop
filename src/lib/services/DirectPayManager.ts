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
 * The relay is the default. While receiving through it, a relay that cannot be reached (it
 * refuses or drops the connection, or this wallet is not online on it within
 * {@link RELAY_START_MS}) hands receiving to the message box, when this wallet has one
 * (`relayUnreachable` in the snapshot). The relay is then retried in the background, with
 * the relay signaler's own backoff, and receiving moves back to it once it accepts this
 * wallet. A user who chose the message box in Settings stays on it. Without receiving, the
 * relay is used only to send, and a payee it cannot reach already leads to the message box.
 *
 * While a wallet is open, the payments kept for it (acknowledged, but not yet in the wallet)
 * are retried in the background: when it opens, then on a backing-off timer and whenever the
 * network comes back, one wallet call at a time and never while the wallet is busy. A pass
 * stops between payments once 15 s have passed, and gives way to Lock, a switch or removal.
 *
 * React integration: subscribe to 'changed', like PeerPayManager.
 */

import { toast } from 'react-toastify'
import type { WalletInterface } from '@bsv/sdk'
import { DirectPayClient, MessageBoxSignaler, RelaySignaler } from '@bsv/webrtpay'
import type { IncomingPayment, MessageBoxLike, PaymentDecision, RelayConnectionState, Signaler, WebRTPayError } from '@bsv/webrtpay'
import { EventEmittable } from './EventEmittable'
import { activeHttpBridgeRequests, activeUserWalletOperations, beginBackgroundWalletOperation, beginUserWalletOperation, isHttpBridgePaused, walletChangeRequests } from './httpBridgeSession'
import { iceServersFrom, loadDirectPaySettings, subscribeDirectPaySettings, type DirectPaySettings } from '../utils/directPaySettings'
import { keepDirectPayment, receiveDirectPayment, retryReceivedDirectPayments, RetryStopped, type DirectReceipt, type KeptDirectPaymentInfo } from '../pages/Dashboard/Payments/directPayments'

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
  /**
   * The settings choose the relay, but it cannot be reached, so `via` is the message box
   * until it can (see the header). False otherwise.
   */
  relayUnreachable: boolean
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

const OFF: DirectPaySnapshot = { client: null, status: 'off', via: null, relayUnreachable: false, error: '', notice: '', received: 0 }

/**
 * How long receiving through the relay may take to come online before it falls back to the
 * message box (when there is one).
 */
export const RELAY_START_MS = 5000

/**
 * Kept payments (acknowledged, not yet in the wallet) are retried when a wallet opens, then
 * after 60 s, doubling to every 15 minutes while it stays open; at once when the network
 * comes back, and 60 s after a payment is newly kept.
 */
const RETRY_FIRST_MS = 60_000
const RETRY_MAX_MS = 15 * 60_000
/** How soon a retry skipped because the wallet was busy or paused is tried again. */
const RETRY_BUSY_MS = 1000
/**
 * A retry pass starts no payment after this long, so a pass of many payments does not hold off
 * Lock, a switch or removal for long. A payment already running is not cut short: its wallet
 * operation keeps storage open under it.
 */
const RETRY_PASS_MS = 15_000
/**
 * A retry's wallet call that takes longer ends the pass and releases its wallet operation, so
 * a stalled wallet or chain tracker cannot hold off Lock, a switch or removal for longer.
 */
const RETRY_CALL_MS = 15_000

/** Failed polls of the message box in a row before the status says it cannot be reached. */
const POLL_FAILURES_SHOWN = 2

const NO_RELAY = 'Enter a relay server address in Settings, or use the message box for direct payments.'
const NO_MESSAGE_BOX = 'Direct payments reach other wallets through the message box. Connect a message box in Settings, or use a relay server.'

type Started = {
  options: DirectPayStartOptions
  /** The client's signaler when it is a relay, or the relay being retried while on the message box. */
  relay: RelaySignaler | null
  unsubscribe: () => void
}

/**
 * Which way a launch signals: as the settings say, or (`fallback`) through the message box
 * while the relay the settings choose is retried.
 */
type Carrier = 'settings' | 'fallback'

/** The open wallet's kept-payment retries: the next pass, its wait, and what it includes. */
type RetrySchedule = {
  options: DirectPayStartOptions
  /** The wait before the next timed pass; doubles after each, up to {@link RETRY_MAX_MS}. */
  delay: number
  timer?: ReturnType<typeof setTimeout>
  /** When `timer` fires (ms since the epoch). */
  due?: number
  /**
   * The next pass also offers payments that need attention: when the wallet opens, the network
   * is back, or a pass that offered them was cut short by other wallet work or a wallet change.
   */
  withAttention: boolean
  /** Asked for while a pass was running: run another as soon as it ends. */
  again: boolean
  onOnline: () => void
}

/**
 * How a retry pass ended: `done` (it went through the list), `busy` (other wallet work holds the
 * wallet), `yielded` (Lock, a switch or removal was asked for) or `stopped` (its time was up, or
 * a call stalled). See DirectPayManager._runRetry.
 */
type RetryOutcome = 'done' | 'busy' | 'yielded' | 'stopped'

export class DirectPayManager extends EventEmittable<{ changed: DirectPaySnapshot }> {
  private _snapshot: DirectPaySnapshot = OFF
  private _started: Started | null = null
  /** Settles when the current start has finished setting up receiving. */
  private _starting: Promise<void> = Promise.resolve()
  /** Bumped by every start and stop; a start that is no longer current changes nothing. */
  private _generation = 0
  /** `identity:chain` of wallets whose kept payments are being retried. */
  private readonly _retrying = new Set<string>()
  /** Retries of the open wallet's kept payments; null while none is open. */
  private _retry: RetrySchedule | null = null

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
    this._starting = this._launch(o, received, closing, 'settings')
    if (!sameWallet) this._startRetries(o)
    return this._starting
  }

  /** Uses new settings for the open wallet (no-op when nothing changed or none is open). */
  async applySettings(s: DirectPaySettings): Promise<void> {
    if (!this._started) return
    await this.start({ ...this._started.options, settings: s })
  }

  /** Closes the client and signaler. The snapshot clears at once; never rejects. */
  async stop(): Promise<void> {
    this._stopRetries()
    const closing = this._teardown()
    if (this._snapshot !== OFF) this._set(OFF)
    await closing
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /** Sets up a client synchronously (so the snapshot has it at once), then receiving. */
  private async _launch(o: DirectPayStartOptions, received: number, closing: Promise<void>, carrier: Carrier): Promise<void> {
    const generation = this._generation
    let client: DirectPayClient | null = null
    let relay: RelaySignaler | null = null
    let signaler: Signaler | undefined
    let via: DirectPaySnapshot['via'] = null
    let error = ''
    let notice = ''
    const fallback = carrier === 'fallback'
    try {
      if (fallback) {
        // Retries the relay: listening keeps it trying (with its backoff) until it accepts this wallet.
        relay = new RelaySignaler({
          url: o.settings.relayUrl,
          wallet: o.wallet,
          originator: o.originator,
          onStateChange: (state, e) => this._relayRetried(generation, o, state, e)
        })
        relay.listen(() => {
          // Signals that reach the retry before receiving moves back to the relay: payers dial again.
        }).catch(() => { /* closed */ })
      }
      if (o.settings.signaling === 'relay' && !fallback) {
        if (!o.settings.relayUrl) {
          error = NO_RELAY
        } else {
          const url = o.settings.relayUrl
          relay = new RelaySignaler({
            url,
            wallet: o.wallet,
            originator: o.originator,
            onStateChange: (state, e) => this._relayChanged(generation, o, url, state, e)
          })
          signaler = relay
          via = 'relay'
        }
      } else if (!o.peerPayClient) {
        notice = NO_MESSAGE_BOX
      } else {
        let failures = 0
        const polled = (error?: unknown) => {
          failures = error === undefined ? 0 : failures + 1
          this._messageBoxPolled(generation, o.settings.receiveEnabled, failures, error)
        }
        signaler = new MessageBoxSignaler(watchingPolls(o.peerPayClient, polled), { host: o.messageBoxUrl || undefined, messageBox: signalBox(o.chain) })
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
        ...(relay && !fallback && {
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
    this._set({ client, status: error ? 'error' : receive ? 'starting' : 'off', via, relayUnreachable: fallback, error, notice, received })
    if (!receive || !client) return
    if (relay && !fallback && o.peerPayClient) {
      // Not online through the relay in time: receive through the message box meanwhile.
      const timer = setTimeout(() => {
        if (generation === this._generation && this._snapshot.status !== 'online') this._fallBack(generation, o, 'it did not accept this wallet in time')
      }, RELAY_START_MS)
      const unsubscribe = this._started.unsubscribe
      this._started.unsubscribe = () => { clearTimeout(timer); unsubscribe() }
    }

    // The previous client stops listening first, so two never answer the same offer.
    await closing
    if (generation !== this._generation) return
    try {
      await client.startReceiving({
        onPayment: p => this._onPayment(o, p),
        onError: e => console.warn('[DirectPayManager] Inbound direct payment session failed:', e)
      })
      // The status follows the relay's connection (see _relayChanged), or the message box's
      // polls (see _messageBoxPolled), so it says online only once receiving works.
    } catch (e) {
      // Neither signaler fails to listen while it is open; this is a client that cannot receive.
      if (generation === this._generation) this._update({ status: 'error', error: `Direct payments cannot be received: ${messageOf(e)}` })
    }
  }

  /**
   * Receiving through the relay failed: receive through the message box, retrying the relay
   * (see the header). Only while receiving through the relay with a message box to use.
   */
  private _fallBack(generation: number, o: DirectPayStartOptions, why: string): void {
    if (generation !== this._generation) return
    console.warn(`[DirectPayManager] Receiving through the message box: the relay cannot be reached (${why}).`)
    const received = this._snapshot.received
    const closing = this._teardown()
    this._starting = this._launch(o, received, closing, 'fallback')
  }

  /**
   * The relay being retried while receiving through the message box: once it accepts this
   * wallet, receiving moves back to it (a new relay connection; this one closes).
   */
  private _relayRetried(generation: number, o: DirectPayStartOptions, state: RelayConnectionState, e?: WebRTPayError): void {
    if (generation !== this._generation) return
    if (state === 'offline' && e) console.warn('[DirectPayManager] The relay still cannot be reached:', e.code, e.message)
    if (state !== 'online') return
    const received = this._snapshot.received
    const closing = this._teardown()
    this._starting = this._launch(o, received, closing, 'settings')
  }

  /**
   * While receiving through a relay, the status follows its connection: `starting` while it
   * connects, `online` once the relay accepted this wallet, and `error` with the reason
   * while it is offline (the signaler keeps trying, and the status recovers by itself). With
   * a message box, a relay gone offline hands receiving to it instead (see _fallBack).
   * While not receiving, the relay connects only for payments, and the status stays `off`.
   */
  private _relayChanged(generation: number, o: DirectPayStartOptions, url: string, state: RelayConnectionState, e?: WebRTPayError): void {
    if (generation !== this._generation || !o.settings.receiveEnabled) return
    if (state === 'online') this._update({ status: 'online', error: '' })
    // With a message box to use, a relay that cannot be reached hands receiving to it.
    else if (state === 'offline' && e && o.peerPayClient) this._fallBack(generation, o, `${e.code}: ${e.message}`)
    else if (state === 'offline' && e) this._update({ status: 'error', error: `Direct payments cannot be received: ${relayProblem(e, url)}` })
    // Connecting again: keep showing why the last try failed until one succeeds.
    else if (this._snapshot.status !== 'error') this._update({ status: 'starting', error: '' })
  }

  /**
   * While receiving through the message box, the status follows its polls (final review M13):
   * `online` once a poll worked, and `error` with the reason after
   * {@link POLL_FAILURES_SHOWN} failures in a row (the signaler keeps polling, and the status
   * recovers by itself). While not receiving, polls are a payment's, and the status stays `off`.
   */
  private _messageBoxPolled(generation: number, receiving: boolean, failures: number, error: unknown): void {
    if (generation !== this._generation || !receiving) return
    if (failures === 0) this._update({ status: 'online', error: '' })
    else if (failures >= POLL_FAILURES_SHOWN) this._update({ status: 'error', error: `Direct payments cannot be received: the message box cannot be reached (${messageOf(error)}). Trying again…` })
  }

  /** Takes a payment into the wallet; a throw becomes a `rejected` ack for the payer. */
  private async _onPayment(o: DirectPayStartOptions, p: IncomingPayment): Promise<PaymentDecision> {
    let release: (() => void) | undefined
    try {
      release = beginUserWalletOperation()
    } catch {
      // A network or profile switch holds wallet work off. The payer has broadcast by now, so
      // the payment is kept for a retry rather than refused (final review M10).
    }
    let receipt: DirectReceipt
    try {
      const args = { wallet: o.wallet, originator: o.originator, identity: o.identity, chain: o.chain, payment: p }
      receipt = release ? await receiveDirectPayment(args) : await keepDirectPayment(args)
    } finally {
      release?.()
    }
    // The payment is taken: nothing below may turn the ack into a rejection.
    try {
      if (receipt.status === 'received' && !receipt.repeat) this._retrySoon(o)
      // In the wallet now, even when it is a redelivery of a payment kept earlier.
      if (receipt.added) window.dispatchEvent(new CustomEvent('balance-changed'))
      // Delivered again after a lost ack: it was announced the first time.
      if (!receipt.repeat) {
        const current = this._started?.options
        if (current && isSameWallet(current, o)) this._set({ ...this._snapshot, received: this._snapshot.received + 1 })
        // `status` tells the page whether the wallet took it or only kept it (final review D6).
        window.dispatchEvent(new CustomEvent('direct-payment-received', { detail: { amount: p.token.amount, sender: p.sender, status: receipt.status } }))
      }
    } catch (e) {
      console.warn('[DirectPayManager] Could not announce a received direct payment:', e)
    }
    return receipt.status
  }

  /** Retries the kept payments of a wallet that just opened, now and while it stays open. */
  private _startRetries(o: DirectPayStartOptions): void {
    this._stopRetries()
    const s: RetrySchedule = {
      options: o,
      delay: RETRY_FIRST_MS,
      withAttention: true,
      again: false,
      onOnline: () => { s.delay = RETRY_FIRST_MS; this._retryNow(s, true) }
    }
    this._retry = s
    window.addEventListener('online', s.onOnline)
    this._retryNow(s, true)
  }

  /** The wallet closed: no more passes (one already running ends at its next payment). */
  private _stopRetries(): void {
    const s = this._retry
    if (!s) return
    this._retry = null
    clearTimeout(s.timer)
    window.removeEventListener('online', s.onOnline)
  }

  /** A payment was just kept: the next pass comes after the first wait at the latest. */
  private _retrySoon(o: DirectPayStartOptions): void {
    const s = this._retry
    if (!s || !isSameWallet(s.options, o)) return
    s.delay = RETRY_FIRST_MS
    if (s.timer === undefined) return // a pass is running; it schedules the next one
    // A sooner pass (say one waiting for a network switch to end) stays as it is.
    if (s.due !== undefined && s.due <= Date.now() + RETRY_FIRST_MS) return
    this._retryIn(s, RETRY_FIRST_MS)
  }

  /** Runs the next pass `ms` from now, replacing any pass already waiting. */
  private _retryIn(s: RetrySchedule, ms: number): void {
    clearTimeout(s.timer)
    s.due = Date.now() + ms
    s.timer = setTimeout(() => this._retryNow(s, false), ms)
  }

  /**
   * Runs a pass now, unless the wallet is paused or busy (then a second later), and never
   * two for one wallet at once (then as soon as the running one ends).
   */
  private _retryNow(s: RetrySchedule, withAttention: boolean): void {
    if (this._retry !== s) return
    clearTimeout(s.timer)
    s.timer = undefined
    s.due = undefined
    s.withAttention ||= withAttention
    const key = `${s.options.identity}:${s.options.chain}`
    if (this._retrying.has(key)) {
      s.again = true
      return
    }
    if (walletBusy()) {
      this._retryIn(s, RETRY_BUSY_MS)
      return
    }
    const withAttentionNow = s.withAttention
    s.withAttention = false
    this._retrying.add(key)
    void this._runRetry(s, withAttentionNow).then(outcome => {
      this._retrying.delete(key)
      // The wallet may have closed, or closed and opened again, while the pass ran.
      const current = this._retry
      if (!current || `${current.options.identity}:${current.options.chain}` !== key) return
      // Only a pass cut short from outside hands the payments that need attention on to the next.
      // One that ran out of time, or whose call stalled, does not: those payments are usually the
      // oldest, so they come first, and carrying them would start every pass on the same ones and
      // never reach the payments behind them. They are offered again when the wallet opens or
      // the network comes back.
      if (outcome === 'busy' || outcome === 'yielded') current.withAttention ||= withAttentionNow
      // A pass that stopped or gave way is not run again at once, even when asked for meanwhile:
      // that would hold the wallet again.
      if (current !== s || (current.again && (outcome === 'done' || outcome === 'busy'))) {
        current.again = false
        this._retryNow(current, false)
      } else if (outcome === 'busy') {
        this._retryIn(current, RETRY_BUSY_MS)
      } else {
        current.again = false
        this._retryIn(current, current.delay)
        current.delay = Math.min(current.delay * 2, RETRY_MAX_MS)
      }
    })
  }

  /**
   * One pass over the wallet's kept payments. Each payment's wallet calls run inside their own
   * background wallet operation, so a network switch or wallet removal cannot cut storage off
   * under them, and none is held between payments or across waits. The pass ends early when:
   * - the wallet closes;
   * - it is paused or busy with other work (`busy`: tried again a second later);
   * - at the next payment once Lock, a switch or removal is asked for (`yielded`; see
   *   walletChangeBlocker);
   * - at the next payment once {@link RETRY_PASS_MS} have passed, or when a call takes longer
   *   than {@link RETRY_CALL_MS}, which releases its operation (`stopped`).
   * After `yielded` or `stopped` the next pass comes after the usual wait, so the user's change
   * gets the wallet. After `busy` or `yielded` it also offers the payments that need attention
   * if this one did; after `stopped` it does not (see _retryNow).
   * Never rejects.
   */
  private async _runRetry(s: RetrySchedule, includeNeedsAttention: boolean): Promise<RetryOutcome> {
    const o = s.options
    const deadline = Date.now() + RETRY_PASS_MS
    const changes = walletChangeRequests()
    let outcome: RetryOutcome = 'done'
    const stop = (why: Exclude<RetryOutcome, 'done'>, message: string): never => {
      outcome = why
      throw new RetryStopped(message)
    }
    const run = async <T>(call: () => Promise<T>): Promise<T> => {
      if (this._retry !== s) throw new RetryStopped('The wallet closed')
      if (walletChangeRequests() !== changes) stop('yielded', 'Lock, a switch or removal was asked for')
      if (Date.now() >= deadline) stop('stopped', 'The pass took its time')
      let release: () => void
      try {
        if (walletBusy()) throw new Error('busy')
        release = beginBackgroundWalletOperation()
      } catch {
        return stop('busy', 'The wallet is busy')
      }
      try {
        return await withDeadline(call(), RETRY_CALL_MS, () => { outcome = 'stopped' })
      } finally {
        release()
      }
    }
    try {
      const added = await retryReceivedDirectPayments({
        wallet: o.wallet,
        originator: o.originator,
        identity: o.identity,
        chain: o.chain,
        includeNeedsAttention,
        onNeedsAttention: kept => this._reportNeedsAttention(kept),
        run
      })
      if (added > 0) window.dispatchEvent(new CustomEvent('balance-changed'))
    } catch (e) {
      console.warn('[DirectPayManager] Retrying kept direct payments failed:', e)
    }
    return outcome
  }

  /**
   * The payer will not send a kept payment again, so its details stay in the kept list, where
   * the Payments page offers them for recovery by hand.
   */
  private _reportNeedsAttention(p: KeptDirectPaymentInfo): void {
    toast.warning(`A direct payment of ${p.amount.toLocaleString()} satoshis from ${p.sender.slice(0, 12)}… needs attention: your wallet could not add it. It stays on this device; open Payments to copy its recovery details.`)
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

/**
 * The message box that carries this network's signals. An identity key is the same on every
 * network, so one identity open on two networks (or two devices) would otherwise take the
 * other network's dials (final review D2). Mainnet keeps the package's default box, where
 * other wallets dial; the client also refuses a dial that names another network.
 */
const signalBox = (chain: string) => (chain === 'main' ? 'webrtpay_signals' : `webrtpay_signals_${chain}`)

/**
 * What the signaler may use of the message box client: webrtpay's MessageBoxLike, plus the
 * recipient's host lookup (`resolveHostForRecipient`, public on message-box-client's
 * MessageBoxClient), which webrtpay is adding as optional.
 */
type SignalClient = MessageBoxLike & { resolveHostForRecipient?(recipient: string): Promise<string> }

/**
 * The message box client as the signaler sees it: the same calls, with each listing (a poll)
 * reported to `polled`, with its error when it failed. The live websocket calls and the host
 * lookup are passed on, bound to the client, when it has them: without them the signaler only
 * polls, which is too slow for its presence window (desktop review finding 1).
 */
function watchingPolls(client: SignalClient, polled: (error?: unknown) => void): SignalClient {
  // The status is only shown: reporting it must never fail a poll (its messages would be lost).
  const report = (error?: unknown) => { try { polled(error) } catch (e) { console.warn('[DirectPayManager] Could not show the message box status:', e) } }
  return {
    sendMessage: (a, host) => client.sendMessage(a, host),
    listMessages: async a => {
      let messages: Awaited<ReturnType<MessageBoxLike['listMessages']>>
      try {
        messages = await client.listMessages(a)
      } catch (e) {
        report(e ?? new Error('The message box could not be listed'))
        throw e
      }
      report()
      return messages
    },
    acknowledgeMessage: a => client.acknowledgeMessage(a),
    ...(typeof client.sendLiveMessage === 'function' && { sendLiveMessage: (a: Parameters<NonNullable<MessageBoxLike['sendLiveMessage']>>[0], host?: string) => client.sendLiveMessage!(a, host) }),
    ...(typeof client.listenForLiveMessages === 'function' && { listenForLiveMessages: (a: Parameters<NonNullable<MessageBoxLike['listenForLiveMessages']>>[0]) => client.listenForLiveMessages!(a) }),
    ...(typeof client.joinRoom === 'function' && { joinRoom: (box: string, host?: string) => client.joinRoom!(box, host) }),
    ...(typeof client.leaveRoom === 'function' && { leaveRoom: (box: string) => client.leaveRoom!(box) }),
    ...(typeof client.resolveHostForRecipient === 'function' && { resolveHostForRecipient: (recipient: string) => client.resolveHostForRecipient!(recipient) })
  }
}

/** Another payment, app request or a network switch is using the wallet. */
const walletBusy = () => isHttpBridgePaused() || activeUserWalletOperations() > 0 || activeHttpBridgeRequests() > 0

/** `p`, or a {@link RetryStopped} after `ms`, calling `onLate` first (the call goes on, unobserved). */
function withDeadline<T>(p: Promise<T>, ms: number, onLate: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => { onLate(); reject(new RetryStopped('The wallet took too long')) }, ms) })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
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
