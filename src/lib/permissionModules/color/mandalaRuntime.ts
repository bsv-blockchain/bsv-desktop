/**
 * Host Mandala runtime (design §9 B7, contract Revision 3 §8.2): what the
 * desktop, as a wallet host, does for Mandala hand-overs. It lives next to the
 * color module in the wallet context and is never reachable over BRC-100.
 *
 * One `tick()`:
 * 1. receive: `receiveHandovers` on MessageBox `mandala-color` with the host
 *    ledger. Online it submits the chain and records `settled`; offline it runs
 *    COVER and records `pending`. Either way it internalizes the plain receipt
 *    through the permissions manager (so the color module and its issuer-v1
 *    handler admit it), then acknowledges.
 * 2. settle: `settleReceipts` submits every `pending` record and runs the
 *    module's host-only `markSettled(txid)` once the overlay admits it.
 *
 * The desktop has no token send screen (B8), so it never signs a hand-over;
 * sender-side `settleHandover` has no caller here and nothing is exposed to
 * apps.
 *
 * Robustness:
 * - single flight: overlapping ticks share one pass;
 * - a tick never rejects: receive and settle failures are reported and the
 *   other step still runs;
 * - the wallet and MessageBox client are read per tick (the client is built
 *   after the wallet and replaced when the MessageBox URL changes);
 * - `isActive()` false (remote storage, fail closed on any fault) skips both
 *   steps: the broadcast guard covers local storage only.
 */

import type { WalletInterface } from '@bsv/sdk'
import {
  receiveHandovers as libReceiveHandovers,
  settleReceipts as libSettleReceipts,
  type HostLedger,
  type MessageBoxLike,
  type ReceiptSettleResult
} from '@bsv/mandala'

export type MandalaTickReport = {
  /** Structurally the settle scheduler's report. */
  results: ReceiptSettleResult[]
  received: Array<{ txid: string, assetId: string, offline: boolean }>
  failed: Array<{ messageId: string, code?: string, exhausted?: true }>
}

export interface MandalaHostRuntimeOptions {
  ledger: HostLedger
  markSettled: (txid: string) => Promise<void>
  /** The permissions manager, bound to the admin originator; undefined until built. */
  wallet: () => WalletInterface | undefined
  /** The host's MessageBox client; undefined while MessageBox is off or not built yet. */
  messageBox: () => MessageBoxLike | undefined
  /** The configured overlay's K every σ is verified under. */
  overlayIdentityKey: string
  /** Local active storage right now; never rejects. */
  isActive: () => Promise<boolean>
  receiveHandovers?: typeof libReceiveHandovers
  settleReceipts?: typeof libSettleReceipts
  onError?: (step: 'receive' | 'settle', e: unknown) => void
}

export interface MandalaHostRuntime {
  tick(): Promise<MandalaTickReport>
}

function defaultOnError (step: 'receive' | 'settle', e: unknown): void {
  console.warn(`[mandala] ${step} failed`, e)
}

export function createMandalaHostRuntime (o: MandalaHostRuntimeOptions): MandalaHostRuntime {
  const receive = o.receiveHandovers ?? libReceiveHandovers
  const settle = o.settleReceipts ?? libSettleReceipts
  const onError = o.onError ?? defaultOnError
  const report = (step: 'receive' | 'settle', e: unknown): void => {
    try { onError(step, e) } catch { /* a failing logger must not break the tick */ }
  }
  // One per runtime: overlapping passes skip each other's messages (the lib
  // removes a message from it again whenever it is to be retried).
  const processed = new Set<string>()
  let inFlight: Promise<MandalaTickReport> | null = null

  const pass = async (): Promise<MandalaTickReport> => {
    const out: MandalaTickReport = { results: [], received: [], failed: [] }
    let active = false
    try { active = (await o.isActive()) === true } catch { active = false }
    if (!active) return out

    let wallet: WalletInterface | undefined
    let messageBoxClient: MessageBoxLike | undefined
    try {
      wallet = o.wallet()
      messageBoxClient = o.messageBox()
    } catch (e) {
      report('receive', e)
    }
    if (wallet !== undefined && messageBoxClient !== undefined) {
      try {
        const r = await receive({ wallet, messageBoxClient, ledger: o.ledger, markSettled: o.markSettled, processed })
        for (const a of r.accepted) out.received.push({ txid: a.txid, assetId: a.assetId, offline: a.offline })
        for (const f of r.failed) {
          out.failed.push({ messageId: f.messageId, ...(f.code !== undefined ? { code: f.code } : {}), ...(f.exhausted === true ? { exhausted: true as const } : {}) })
          report('receive', f.error)
        }
      } catch (e) {
        report('receive', e)
      }
    }

    try {
      out.results = await settle({ ledger: o.ledger, markSettled: o.markSettled, overlayIdentityKey: o.overlayIdentityKey })
    } catch (e) {
      report('settle', e)
    }
    return out
  }

  return {
    tick (): Promise<MandalaTickReport> {
      if (inFlight) return inFlight
      const p = pass().finally(() => {
        if (inFlight === p) inFlight = null
      })
      inFlight = p
      return p
    }
  }
}
