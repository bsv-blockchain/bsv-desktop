/**
 * Renderer side of the 1Color broadcast guard (contract §8.2).
 *
 * The main process and the monitor worker hold every unreleased transaction
 * with a BRC-162 output (electron/colorBroadcastGuard.ts). This drain asks the
 * color module, which lives in the renderer, whether each held txid is settled
 * (`isSettled`, a verified overlay attestation), and releases only those. A
 * `false`, a throw or a non-boolean answer keeps the txid held; a failed release
 * IPC is retried on the next drain. Every settle tick (scheduler) ends with a
 * drain, and a `color-guard:held` event triggers a tick.
 *
 * Single flight: overlapping drains share one pass. `drain()` never rejects.
 */

import type { WalletNetwork } from '../../networkConfig'

export type ColorGuardBridge = {
  held(identityKey: string, chain: WalletNetwork): Promise<string[]>
  release(identityKey: string, chain: WalletNetwork, txid: string): Promise<void>
  onHeld(cb: (txid: string) => void): () => void
}

export interface ColorReleaseDrainOptions {
  isSettled(txid: string): Promise<boolean>
  api: Pick<ColorGuardBridge, 'held' | 'release'>
  identityKey: string
  chain: WalletNetwork
  onError?: (e: unknown, txid?: string) => void
}

export interface ColorReleaseDrain {
  drain(): Promise<{ released: string[] }>
}

const TXID_RE = /^[0-9a-f]{64}$/

function defaultOnError (e: unknown, txid?: string): void {
  console.warn('[color] release drain', txid ?? '', e)
}

export function createColorReleaseDrain (o: ColorReleaseDrainOptions): ColorReleaseDrain {
  const onError = o.onError ?? defaultOnError
  const report = (e: unknown, txid?: string): void => {
    try { onError(e, txid) } catch { /* a failing logger must not break the drain */ }
  }
  let inFlight: Promise<{ released: string[] }> | null = null

  const pass = async (): Promise<{ released: string[] }> => {
    const released: string[] = []
    let held: string[]
    try {
      held = await o.api.held(o.identityKey, o.chain)
    } catch (e) {
      report(e)
      return { released }
    }
    if (!Array.isArray(held)) return { released }
    for (const txid of held) {
      if (typeof txid !== 'string' || !TXID_RE.test(txid)) continue
      let settled: unknown
      try {
        settled = await o.isSettled(txid)
      } catch (e) {
        report(e, txid)
        continue
      }
      if (settled !== true) continue
      try {
        await o.api.release(o.identityKey, o.chain, txid)
        released.push(txid)
      } catch (e) {
        report(e, txid)
      }
    }
    return { released }
  }

  return {
    drain (): Promise<{ released: string[] }> {
      if (inFlight) return inFlight
      const p = pass().finally(() => {
        if (inFlight === p) inFlight = null
      })
      inFlight = p
      return p
    }
  }
}
