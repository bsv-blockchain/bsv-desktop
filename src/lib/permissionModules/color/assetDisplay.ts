/**
 * Host-resolved display metadata (`dec`, `sym`, `label`) for 1Color assets,
 * attached to the color module's consent messages as `hostDisplay` so the
 * prompt can render exact decimal amounts (contract §2.5: display metadata is
 * host-resolved via `color-admission` + `readDeploy`, untrusted, and the full
 * asset id is always shown).
 *
 * For each distinct, well-formed asset id `<txid>_<vout>` the providers are
 * asked in order for `color-admission` of the deploy outpoint. An answer is
 * used only when its BEEF yields a transaction that hashes to `txid` and
 * `readDeploy` of its output `vout` confirms exactly this asset id. A provider
 * error, timeout, mismatch or non-deploy moves on to the next provider; when
 * none resolves, the id is omitted and the prompt shows exact base units.
 *
 * Robustness:
 * - resolved deploys are cached (deploys are immutable; the txid hash check
 *   makes the content authentic), insertion-bounded to `maxEntries`;
 *   unresolved assets are never cached, so a later prompt asks again;
 * - concurrent resolves of one asset (several windows / prompts) share one
 *   in-flight lookup, dropped when it settles;
 * - every provider call is raced against `timeoutMs`; a late rejection is
 *   swallowed and the timer is always cleared;
 * - `providers()` is read on every resolve (settings changes apply at once);
 * - nothing here throws to the caller: display is best-effort.
 */

import { Transaction } from '@bsv/sdk'
import { readDeploy } from '@bsv/mandala'
import type { ColorOverlayProvider } from '@bsv/color-permission-module'
import type { AssetDisplay } from './consentView'

export const DEFAULT_ASSET_DISPLAY_TIMEOUT_MS = 3_000
export const DEFAULT_ASSET_DISPLAY_MAX_ENTRIES = 256

const ASSET_ID = /^([0-9a-f]{64})_(0|[1-9][0-9]{0,9})$/

export interface AssetDisplayResolver {
  resolve: (assetIds: readonly string[]) => Promise<Record<string, AssetDisplay>>
}

export interface AssetDisplayResolverOptions {
  providers: () => ColorOverlayProvider[]
  /** Per-provider lookup timeout. Default 3 000 ms. */
  timeoutMs?: number
  /** Cache bound. Default 256. */
  maxEntries?: number
}

const TIMED_OUT = Symbol('timed out')

async function withTimeout<T> (work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  work.catch(() => {}) // a rejection after the timeout must not surface as unhandled
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), ms) })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** The display of `assetId` from one provider's `color-admission` answer, or null. */
async function fromProvider (
  provider: ColorOverlayProvider,
  assetId: string,
  txid: string,
  vout: number,
  timeoutMs: number
): Promise<AssetDisplay | null> {
  try {
    const answer = await withTimeout(
      Promise.resolve().then(async () => await provider.admission(assetId, [`${txid}.${vout}`])),
      timeoutMs
    )
    if (answer === TIMED_OUT || answer?.type !== 'output-list' || !Array.isArray(answer.outputs)) return null
    for (const out of answer.outputs) {
      // The txid label is only a hint; the hash check below is the guard.
      if (out?.outputIndex !== vout || (out.txid !== undefined && out.txid !== txid)) continue
      try {
        const tx = Transaction.fromBEEF(out.beef, txid)
        if (tx.id('hex') !== txid) continue
        const script = tx.outputs[vout]?.lockingScript
        if (script === undefined) continue
        // Hex, not the object: @bsv/mandala's types may resolve a different
        // @bsv/sdk entry (ESM vs CJS) than this file.
        const deploy = readDeploy(script.toHex(), txid)
        // readDeploy reads output 0 of txid: anything else is not this asset.
        if (deploy === null || deploy.assetId !== assetId) continue
        return {
          assetId,
          ...(deploy.sym === undefined ? {} : { sym: deploy.sym }),
          ...(deploy.label === undefined ? {} : { label: deploy.label }),
          dec: deploy.dec,
          mandala: deploy.mandalaKey !== undefined
        }
      } catch {
        continue
      }
    }
    return null
  } catch {
    return null
  }
}

export function createAssetDisplayResolver (o: AssetDisplayResolverOptions): AssetDisplayResolver {
  const timeoutMs = o.timeoutMs ?? DEFAULT_ASSET_DISPLAY_TIMEOUT_MS
  const maxEntries = Math.max(1, o.maxEntries ?? DEFAULT_ASSET_DISPLAY_MAX_ENTRIES)
  const cache = new Map<string, AssetDisplay>()
  const inFlight = new Map<string, Promise<AssetDisplay | null>>()

  const remember = (display: AssetDisplay): void => {
    cache.delete(display.assetId)
    cache.set(display.assetId, display)
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }

  const lookup = async (assetId: string, providers: ColorOverlayProvider[]): Promise<AssetDisplay | null> => {
    const m = ASSET_ID.exec(assetId)
    if (m === null) return null
    const txid = m[1]
    const vout = Number(m[2]) // an output index, never a token amount
    for (const provider of providers) {
      const display = await fromProvider(provider, assetId, txid, vout, timeoutMs)
      if (display !== null) {
        remember(display)
        return display
      }
    }
    return null
  }

  const one = async (assetId: string, providers: () => ColorOverlayProvider[]): Promise<AssetDisplay | null> => {
    const cached = cache.get(assetId)
    if (cached !== undefined) return cached
    let pending = inFlight.get(assetId)
    if (pending === undefined) {
      let list: ColorOverlayProvider[]
      try {
        list = providers()
      } catch {
        return null
      }
      pending = lookup(assetId, Array.isArray(list) ? list : [])
        .catch(() => null)
        .finally(() => inFlight.delete(assetId))
      inFlight.set(assetId, pending)
    }
    return await pending
  }

  return {
    resolve: async (assetIds) => {
      const ids = [...new Set(assetIds)].filter(id => typeof id === 'string' && ASSET_ID.test(id))
      let snapshot: ColorOverlayProvider[] | undefined
      const providers = (): ColorOverlayProvider[] => (snapshot ??= o.providers())
      const displays = await Promise.all(ids.map(async id => await one(id, providers)))
      const out: Record<string, AssetDisplay> = {}
      ids.forEach((id, i) => {
        const d = displays[i]
        if (d !== null) out[id] = d
      })
      return out
    }
  }
}

function isPlainObject (v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function assetIdsOf (m: Record<string, unknown>): string[] {
  const ids: string[] = []
  const add = (v: unknown): void => { if (typeof v === 'string' && v !== 'ISSUE') ids.push(v) }
  for (const list of [m.assets, m.destinations]) {
    if (!Array.isArray(list)) continue
    for (const item of list) if (isPlainObject(item)) add(item.assetId)
  }
  add(m.assetId)
  return ids
}

/**
 * The consent message with a host-resolved `hostDisplay` member added (it
 * replaces any `hostDisplay` already present: display is the host's call).
 * Module members are never removed or altered. A message that is not a JSON
 * object, or a resolver failure, returns the message unchanged.
 */
export async function enrichConsentMessage (
  message: string,
  resolver: Pick<AssetDisplayResolver, 'resolve'>
): Promise<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(message)
  } catch {
    return message
  }
  if (!isPlainObject(parsed)) return message
  const ids = assetIdsOf(parsed)
  let hostDisplay: Record<string, AssetDisplay>
  try {
    hostDisplay = ids.length === 0 ? {} : await resolver.resolve(ids)
  } catch {
    return message
  }
  return JSON.stringify({ ...parsed, hostDisplay })
}
