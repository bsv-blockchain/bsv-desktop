/**
 * Default overlay provider for profile-free 1Color assets (BRC-207).
 *
 * Lookups go to `ls_color_<assetId>` with the BRC-207 `color-spendability` /
 * `color-admission` query shapes (0207:743-775, contract §6); submits go to
 * the SHIP hosts of the requested topics. Mandala assets never reach this
 * provider: their required-profile handler routes them to the configured
 * Mandala overlay (contract §2.1 obligation 3).
 *
 * Fail closed: a chain with no SHIP network (`tstn`) answers lookups with an
 * empty output list (nothing is spendable) and refuses every submit, without
 * constructing a resolver or broadcaster (which would default to mainnet).
 *
 * The SDK's SHIP `broadcast()` returns a `BroadcastResponse`, not the host
 * STEAK, and its host discovery is private, so a per-call capturing
 * facilitator records each host's raw STEAK. The SDK validator accepts only
 * the three BRC-22 instruction fields, so the facilitator hands the SDK a
 * copy stripped to those fields and keeps the raw entry, which may carry the
 * BRC-175 `admissionSignature` / `admissionIdentityKey` the module verifies.
 *
 * Robustness: every capture is per submit (concurrent submits never see each
 * other's STEAK); every resolver, facilitator and broadcast failure is a
 * retryable transport `ColorProviderError`; refusals make no network call.
 */

import {
  HTTPSOverlayBroadcastFacilitator,
  LookupResolver,
  SHIPBroadcaster,
  Transaction,
  type LookupAnswer,
  type LookupNetworkPreset,
  type OverlayBroadcastFacilitator,
  type STEAK,
  type TaggedBEEF
} from '@bsv/sdk'
import {
  ColorProviderError,
  type AttestedSTEAK,
  type ColorOverlayProvider
} from '@bsv/color-permission-module'
import type { WalletNetwork } from '../../networkConfig'

export const DEFAULT_COLOR_LOOKUP_TIMEOUT_MS = 10_000

export interface ShipColorProviderOptions {
  chain: WalletNetwork
  /** Overrides the chain's preset. */
  networkPreset?: LookupNetworkPreset
  resolver?: Pick<LookupResolver, 'query'>
  facilitator?: OverlayBroadcastFacilitator
  /** Lookup timeout. Default 10 000 ms. */
  timeoutMs?: number
}

/** The SHIP network preset for a wallet network; `tstn` has none. */
export function colorNetworkPreset (chain: WalletNetwork): LookupNetworkPreset | undefined {
  switch (chain) {
    case 'main': return 'mainnet'
    case 'test': return 'testnet'
    case 'ttn': return 'teratestnet'
    default: return undefined
  }
}

const EMPTY_ANSWER = (): LookupAnswer => ({ type: 'output-list', outputs: [] })

function messageOf (error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  if (typeof error === 'string' && error !== '') return error
  return 'overlay request failed'
}

function unavailable (message: string): ColorProviderError {
  return new ColorProviderError('ERR_UNAVAILABLE', true, true, message)
}

function isPlainRecord (value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isIndexList (value: unknown): value is number[] {
  return Array.isArray(value) && value.every(i => Number.isSafeInteger(i) && i >= 0 && i <= 0xffffffff)
}

/** The STEAK with each topic entry reduced to the BRC-22 fields the SDK validator accepts. */
function strippedForSdk (steak: unknown): STEAK {
  if (!isPlainRecord(steak)) return steak as STEAK
  const out: Record<string, unknown> = {}
  for (const [topic, entry] of Object.entries(steak)) {
    if (!isPlainRecord(entry)) { out[topic] = entry; continue }
    out[topic] = {
      outputsToAdmit: entry.outputsToAdmit,
      coinsToRetain: entry.coinsToRetain,
      ...(entry.coinsRemoved === undefined ? {} : { coinsRemoved: entry.coinsRemoved })
    }
  }
  return out as STEAK
}

/** True when the host acknowledged every requested topic with well-formed instructions (the SDK's success rule). */
function acknowledgesAll (steak: unknown, sentTopics: string[], topics: string[]): steak is AttestedSTEAK {
  if (!isPlainRecord(steak)) return false
  if (Object.keys(steak).some(topic => !sentTopics.includes(topic))) return false
  return topics.every(topic => {
    const entry = steak[topic]
    if (!isPlainRecord(entry)) return false
    if (!isIndexList(entry.outputsToAdmit) || !isIndexList(entry.coinsToRetain)) return false
    if (entry.coinsRemoved !== undefined && !isIndexList(entry.coinsRemoved)) return false
    const removed = (entry.coinsRemoved as number[] | undefined)?.length ?? 0
    return entry.outputsToAdmit.length > 0 || entry.coinsToRetain.length > 0 || removed > 0
  })
}

export function createShipColorProvider (o: ShipColorProviderOptions): ColorOverlayProvider {
  const networkPreset = o.networkPreset ?? colorNetworkPreset(o.chain)
  const timeoutMs = o.timeoutMs ?? DEFAULT_COLOR_LOOKUP_TIMEOUT_MS

  let sharedResolver: Pick<LookupResolver, 'query'> | undefined = o.resolver
  const resolver = (preset: LookupNetworkPreset): Pick<LookupResolver, 'query'> => {
    sharedResolver ??= new LookupResolver({ networkPreset: preset })
    return sharedResolver
  }

  const lookup = async (
    type: 'color-spendability' | 'color-admission',
    assetId: string,
    outpoints: string[]
  ): Promise<LookupAnswer> => {
    if (networkPreset === undefined) return EMPTY_ANSWER()
    try {
      return await resolver(networkPreset).query({
        service: `ls_color_${assetId}`,
        query: { type, version: 1, assetId, topic: `tm_color_${assetId}`, outpoints: [...outpoints] }
      }, timeoutMs)
    } catch (error) {
      throw unavailable(messageOf(error))
    }
  }

  return {
    spendability: async (assetId, outpoints) => await lookup('color-spendability', assetId, outpoints),
    admission: async (assetId, outpoints) => await lookup('color-admission', assetId, outpoints),

    submit: async (topics, beef, offChainValues) => {
      if (offChainValues !== undefined && offChainValues.length > 0) {
        throw new ColorProviderError('ERR_UNSUPPORTED', false, false, 'Off-chain values need a profile provider')
      }
      if (networkPreset === undefined) {
        throw new ColorProviderError('ERR_UNAVAILABLE', false, true, 'No 1Color overlay network for this chain')
      }
      const tx = Transaction.fromAtomicBEEF(beef)

      // Per call: concurrent submits never share captures.
      const inner = o.facilitator ?? new HTTPSOverlayBroadcastFacilitator(undefined, networkPreset === 'local')
      const captured: Array<{ topics: string[], steak: unknown }> = []
      const capturing: OverlayBroadcastFacilitator = {
        send: async (url: string, tagged: TaggedBEEF): Promise<STEAK> => {
          const steak: unknown = await inner.send(url, tagged)
          captured.push({ topics: [...tagged.topics], steak })
          return strippedForSdk(steak)
        }
      }

      let response: Awaited<ReturnType<SHIPBroadcaster['broadcast']>>
      try {
        response = await new SHIPBroadcaster(topics, {
          networkPreset,
          resolver: resolver(networkPreset) as LookupResolver,
          facilitator: capturing,
          requireAcknowledgmentFromAnyHostForTopics: 'all'
        }).broadcast(tx)
      } catch (error) {
        throw unavailable(messageOf(error))
      }
      if (response.status !== 'success') {
        throw unavailable(response.description ?? response.code ?? 'overlay broadcast failed')
      }
      const hit = captured.find(c => acknowledgesAll(c.steak, c.topics, topics))
      if (hit === undefined) throw unavailable('No overlay host acknowledged every topic')
      return hit.steak as AttestedSTEAK
    }
  }
}
