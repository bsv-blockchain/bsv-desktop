/**
 * Arcade-first network services for wallet-toolbox, configured the way the
 * mobile wallet configures them (bsv-wallet, packages/expo-wallet-toolbox:
 * core/services/walletServiceConfig.ts and core/context/WalletContext.tsx), so
 * both apps broadcast to, prove against and hear status events from the same
 * services on every chain.
 *
 * Arcade goes through the toolbox's own `Arcade` provider (`options.arcadeUrl` /
 * `arcadeConfig`) rather than a hand-written client. That provider already
 * speaks Arcade's API — Extended Format to `POST /tx`, status and BUMP from
 * `GET /tx/{txid}`, no `/v1` prefix — and `arcadeUrl` is also the setting the
 * Monitor's TaskArcadeSSE keys off. Set any other way, Arcade can broadcast but
 * the wallet never hears back from it: the monitor logs "no arcadeUrl
 * configured; SSE disabled" and every status change waits for a polling task.
 */

import { createRequire } from 'module'
import type { Beef } from '@bsv/sdk'
import { ChaintracksServiceClient, Services, type sdk } from '@bsv/wallet-toolbox'
import {
  arcadeUrl,
  chaintracksUrl,
  GORILLAPOOL_ARC_URLS,
  TAAL_ARC_URLS,
  WHATSONCHAIN_URLS,
  type EndpointChain
} from './endpoints.js'

/*
 * The SDK ships separate ESM and CommonJS builds, and the toolbox (CommonJS)
 * uses the latter. It accepts a proof only if it is a plain object or ITS
 * MerklePath class, so one built from this ESM module's `import '@bsv/sdk'`
 * is refused. SDK classes handed to the toolbox therefore come from the copy
 * the toolbox itself resolves.
 */
const requireFromToolbox = createRequire(createRequire(import.meta.url).resolve('@bsv/wallet-toolbox'))
const { MerklePath, Transaction, Utils } = requireFromToolbox('@bsv/sdk') as typeof import('@bsv/sdk')

const IDENTITY_KEY = /^0[23][0-9a-fA-F]{64}$/

/** The toolbox's name for its Arcade broadcaster in `postBeefServices`. */
export const ARCADE_BROADCASTER = 'ArcadeBeef'

/**
 * The token Arcade scopes a wallet's status events by.
 *
 * Derived exactly as bsv-wallet derives it — the first 32 hex characters of the
 * identity key — so a wallet open on both devices shares one event stream, and
 * so the main process (which broadcasts) and the monitor worker (which
 * subscribes) agree on it without having to pass it between them.
 */
export function arcadeCallbackToken(identityKey: string): string {
  if (!IDENTITY_KEY.test(identityKey)) {
    throw new Error('An Arcade callback token is derived from a compressed identity key')
  }
  return identityKey.substring(0, 32)
}

/**
 * Sent with every Arcade submission. Without it Arcade streams only the final
 * status of a transaction, so SENT/SEEN transitions would still wait for polling.
 */
export const ARCADE_REQUEST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-FullStatusUpdates': 'true'
})

/** Services options for one wallet on one chain. */
export function createArcadeServiceOptions(
  chain: EndpointChain,
  identityKey: string
): sdk.WalletServicesOptions {
  const options = Services.createDefaultOptions(chain)
  // The toolbox defaults still resolve main/test ChainTracks to the retired
  // babbage.systems hosts.
  options.chaintracks = new ChaintracksServiceClient(chain, chaintracksUrl(chain))
  options.arcadeUrl = arcadeUrl(chain)
  options.arcadeConfig = {
    deploymentId: options.arcConfig?.deploymentId,
    callbackToken: arcadeCallbackToken(identityKey),
    headers: { ...ARCADE_REQUEST_HEADERS }
  }
  // Stated rather than inherited, so the fallback set cannot drift with a
  // toolbox upgrade. An empty arcUrl leaves TAAL out entirely.
  options.arcUrl = TAAL_ARC_URLS[chain] ?? ''
  options.arcGorillaPoolUrl = GORILLAPOOL_ARC_URLS[chain]
  return options
}

type PostBeefService = (beef: Beef, txids: string[]) => Promise<sdk.PostBeefResult>
type MerklePathService = (txid: string, services: sdk.WalletServices) => Promise<sdk.GetMerklePathResult>
interface Entry<T> { name: string, service: T }

/**
 * Wraps a fallback broadcaster so that it can accept a transaction but never
 * condemn one.
 *
 * A fallback is only asked after Arcade could not accept a transaction, and a
 * node that has not yet seen a parent Arcade holds will answer "missing inputs"
 * for a perfectly good one. Counted as a rejection, that would fail the action
 * as invalidTx (`attemptToPostReqsToNetwork` fails a transaction when no
 * provider accepted it and any refused it). Reported as a service error, it is
 * retried instead. A double spend is kept: the toolbox confirms one against UTXO
 * state before acting on it.
 */
export function neverCondemns(service: PostBeefService): PostBeefService {
  return async (beef, txids) => {
    const r = await service(beef, txids)
    for (const tr of r.txidResults ?? []) {
      if (tr.status !== 'success' && tr.doubleSpend !== true) tr.serviceError = true
    }
    return r
  }
}

/**
 * WhatsOnChain broadcaster for a chain the toolbox has no WhatsOnChain provider
 * for (ttn). Posts each transaction as raw hex, in the order given, pausing
 * between them as the toolbox's own WhatsOnChain provider does so a child is not
 * sent before WhatsOnChain has taken its parent. It never reports anything but
 * acceptance or a service error, for the reason given on {@link neverCondemns}.
 */
export function makeWocPostBeefService(baseUrl: string, pauseMs = 3000): PostBeefService {
  const name = 'WhatsOnChain'
  return async (beef, txids) => {
    const r: sdk.PostBeefResult = { name, status: 'success', txidResults: [], notes: [] }
    for (const [i, txid] of txids.entries()) {
      if (i > 0 && pauseMs > 0) await new Promise(resolve => setTimeout(resolve, pauseMs))
      const tr: sdk.PostTxResultForTxid = { txid, status: 'error', serviceError: true, notes: [] }
      try {
        const tx = beef.findTxid(txid)?.tx ?? Transaction.fromBEEF(beef.toBinary(), txid)
        const resp = await fetch(`${baseUrl}/tx/raw`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
          body: JSON.stringify({ txhex: Utils.toHex(tx.toBinary()) }),
          signal: AbortSignal.timeout(30_000)
        })
        const body = await resp.text()
        // An identical rebroadcast is acceptance; a different transaction
        // spending the same inputs cannot produce this message.
        if (resp.ok || body.includes('already in the mempool')) {
          tr.status = 'success'
          tr.serviceError = false
        }
        tr.notes!.push({ what: 'wocPostRawTx', when: new Date().toISOString(), httpStatus: resp.status })
      } catch (e) {
        tr.notes!.push({ what: 'wocPostRawTxError', when: new Date().toISOString(), error: String(e) })
      }
      r.txidResults.push(tr)
    }
    if (r.txidResults.some(tr => tr.status !== 'success')) r.status = 'error'
    return r
  }
}

/**
 * WhatsOnChain merkle proof (BUMP) lookup for a chain the toolbox has no
 * WhatsOnChain provider for (ttn). The toolbox validates whatever this returns
 * against the chain tracker before a proof is stored, so a wrong answer can
 * only be discarded, never believed.
 */
export function makeWocMerklePathService(baseUrl: string): MerklePathService {
  const name = 'WhatsOnChain'
  return async (txid, services) => {
    const r: sdk.GetMerklePathResult = { name, notes: [] }
    try {
      const resp = await fetch(`${baseUrl}/tx/${txid}/proof/bump`, { signal: AbortSignal.timeout(30_000) })
      if (!resp.ok) {
        r.notes!.push({ what: 'getMerklePathNoData', when: new Date().toISOString(), httpStatus: resp.status })
        return r
      }
      r.merklePath = MerklePath.fromHex((await resp.text()).trim())
    } catch (e) {
      r.notes!.push({ what: 'getMerklePathError', when: new Date().toISOString(), error: String(e) })
      return r
    }
    // The toolbox passes its Services instance, whose options carry the chain's
    // ChainTracks client. A failed header lookup leaves the proof in place.
    try {
      const chaintracks = (services as unknown as Services | undefined)?.options?.chaintracks
      const header = await chaintracks?.findHeaderForHeight(r.merklePath.blockHeight)
      if (header) r.header = { ...header, height: r.merklePath.blockHeight }
      r.notes!.push({ what: 'getMerklePathSuccess', when: new Date().toISOString() })
    } catch (e) {
      r.notes!.push({ what: 'getMerklePathHeaderError', when: new Date().toISOString(), error: String(e) })
    }
    return r
  }
}

/**
 * Broadcast order, as in bsv-wallet: Arcade, then TAAL, GorillaPool (main),
 * WhatsOnChain and Bitails. The toolbox posts in `UntilSuccess` mode, so the
 * first provider to accept ends the walk and the rest are never asked. Every
 * fallback is wrapped in {@link neverCondemns}.
 *
 * Arcade is also pinned first. On a service error the toolbox moves a provider
 * to the back of the list for the life of the Services instance, so a single
 * dropped connection would otherwise route every later send to a fallback — and
 * those carry no callback token, so none of them would ever produce an SSE event.
 */
export function installBroadcastFallbacks(services: Services, chain: EndpointChain): void {
  const collection = services.postBeefServices
  const byName = new Map(collection.services.map(e => [e.name, e] as const))
  const arcade = byName.get(ARCADE_BROADCASTER)
  if (!arcade) throw new Error(`Services has no ${ARCADE_BROADCASTER} provider; is arcadeUrl set?`)

  const fallbacks: Array<Entry<PostBeefService>> = []
  for (const name of ['TaalArcBeef', 'GorillaPoolArcBeef', 'WhatsOnChain', 'Bitails']) {
    const entry = byName.get(name)
    if (entry) fallbacks.push(entry)
    else if (name === 'WhatsOnChain' && chain === 'ttn') {
      fallbacks.push({ name, service: makeWocPostBeefService(WHATSONCHAIN_URLS.ttn) })
    }
  }
  collection.services = [arcade, ...fallbacks.map(e => ({ name: e.name, service: neverCondemns(e.service) }))]

  const moveServiceToLast = collection.moveServiceToLast.bind(collection)
  collection.moveServiceToLast = stc => {
    if (stc.providerName !== ARCADE_BROADCASTER) moveServiceToLast(stc)
  }
}

/**
 * Proof lookup order, as in bsv-wallet: Arcade first (it can answer the moment a
 * transaction it broadcast is mined), then WhatsOnChain and Bitails. The toolbox
 * builds that order itself on main and test; ttn only needs WhatsOnChain added.
 */
export function installMerklePathFallbacks(services: Services, chain: EndpointChain): void {
  if (chain !== 'ttn') return
  const collection = services.getMerklePathServices
  if (collection.services.some(e => e.name === 'WhatsOnChain')) return
  collection.add({ name: 'WhatsOnChain', service: makeWocMerklePathService(WHATSONCHAIN_URLS.ttn) })
}

/** A Services instance for one wallet on one chain, Arcade first throughout. */
export function createArcadeServices(chain: EndpointChain, identityKey: string): Services {
  const services = new Services(createArcadeServiceOptions(chain, identityKey))
  installBroadcastFallbacks(services, chain)
  installMerklePathFallbacks(services, chain)
  return services
}
