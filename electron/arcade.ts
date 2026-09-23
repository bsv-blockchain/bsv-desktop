/**
 * Arcade-backed transaction services for wallet-toolbox.
 *
 * ChainTracks is already pointed at the Arcade deployments (see endpoints.ts), but
 * broadcasting was left on the toolbox defaults, which resolve to TAAL ARC hosts
 * for a different network. A wallet configured that way verifies headers against
 * one chain and submits transactions to another, so every send is rejected as
 * `invalidTx` — the inputs genuinely do not exist on the chain being asked —
 * while the balance and block height look perfectly healthy. Receiving is
 * unaffected, because internalizeAction only consults ChainTracks, so the fault
 * stays hidden until the first attempt to spend.
 *
 * Pointing `options.arcUrl` at Arcade is not sufficient: Arcade serves
 * `POST /tx` and `GET /tx/{txid}`, whereas the toolbox ARC provider posts to
 * `{url}/v1/tx`. The two services are therefore adapted here.
 */

import { Beef, MerklePath } from '@bsv/sdk'
import { arcadeUrl, type EndpointChain } from './endpoints.js'

export interface ArcadeTxStatus {
  txid: string
  txStatus: string
  blockHash?: string
  blockHeight?: number
  merklePath?: string
  extraInfo?: string
}

export interface ArcadeBroadcastResult {
  /** Arcade accepted the transaction. */
  ok: boolean
  /** Arcade already held it; treat as success. */
  alreadyKnown: boolean
  /** At least one input was already spent. */
  doubleSpend: boolean
  /** Rejected on its merits — retrying will not help. */
  rejected: boolean
  txid?: string
  raw: Record<string, unknown>
}

/** Statuses Arcade reports for a transaction it has taken responsibility for. */
const ACCEPTED = new Set([
  'RECEIVED',
  'STORED',
  'ANNOUNCED_TO_NETWORK',
  'REQUESTED_BY_NETWORK',
  'SENT_TO_NETWORK',
  'ACCEPTED_BY_NETWORK',
  'SEEN_ON_NETWORK',
  'SEEN_MULTIPLE_NODES',
  'MINED',
  'CONFIRMED'
])

const MINED = new Set(['MINED', 'CONFIRMED'])

/** Submit one transaction to Arcade. Arcade requires extended format. */
export async function arcadeBroadcast(baseUrl: string, txHex: string): Promise<ArcadeBroadcastResult> {
  let resp: Response
  try {
    resp = await fetch(`${baseUrl}/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawTx: txHex })
    })
  } catch (e) {
    // A transport failure is not a verdict on the transaction. Reporting it as
    // one would permanently fail a perfectly good transaction over a dropped
    // connection, so it comes back as neither accepted nor rejected.
    return { ok: false, alreadyKnown: false, doubleSpend: false, rejected: false, raw: { error: String(e) } }
  }

  const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>
  const status = typeof body.txStatus === 'string' ? body.txStatus : ''
  const extraInfo = typeof body.extraInfo === 'string' ? body.extraInfo : ''
  const doubleSpend = /UTXO_SPENT|double spend/i.test(extraInfo)
  const accepted = resp.ok && ACCEPTED.has(status)

  return {
    ok: accepted,
    alreadyKnown: accepted && MINED.has(status),
    doubleSpend,
    rejected: status === 'REJECTED' && !doubleSpend,
    txid: typeof body.txid === 'string' ? body.txid : undefined,
    raw: body
  }
}

/** Ask Arcade about a transaction. Undefined when it has never seen it. */
export async function arcadeTxStatus(baseUrl: string, txid: string): Promise<ArcadeTxStatus | undefined> {
  let resp: Response
  try {
    resp = await fetch(`${baseUrl}/tx/${txid}`)
  } catch {
    return undefined
  }
  if (resp.status === 404) return undefined
  const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>
  if (typeof body.txid !== 'string') return undefined
  return {
    txid: body.txid,
    txStatus: typeof body.txStatus === 'string' ? body.txStatus : 'UNKNOWN',
    blockHash: typeof body.blockHash === 'string' ? body.blockHash : undefined,
    blockHeight: typeof body.blockHeight === 'number' ? body.blockHeight : undefined,
    merklePath:
      typeof body.merklePath === 'string' && body.merklePath.length > 0 ? body.merklePath : undefined,
    extraInfo: typeof body.extraInfo === 'string' ? body.extraInfo : undefined
  }
}

/**
 * A toolbox `postBeef` service backed by Arcade.
 *
 * The toolbox hands over a Beef and the txids inside it; Arcade wants one
 * transaction in extended format. Extended format needs every input's source
 * output, which the Beef carries, so `toHexEF()` normally succeeds — raw hex is a
 * last resort rather than an alternative, because Arcade rejects it.
 */
export function makeArcadePostBeefService(baseUrl: string) {
  return async (beef: Beef, txids: string[]) => {
    const subject = txids[txids.length - 1]
    const tx = beef.findAtomicTransaction(subject) ?? beef.findTxid(subject)?.tx

    if (!tx) {
      return {
        name: 'arcade',
        status: 'error' as const,
        txidResults: txids.map(txid => ({
          txid,
          status: 'error' as const,
          serviceError: true,
          data: { detail: 'subject transaction not found in beef' }
        }))
      }
    }

    let txHex: string
    try {
      txHex = tx.toHexEF()
    } catch {
      txHex = tx.toHex()
    }

    const r = await arcadeBroadcast(baseUrl, txHex)

    const txidResults = txids.map(txid => {
      // Only the subject transaction is submitted; its ancestors travel inside
      // the extended format and are accepted or rejected with it.
      if (txid !== subject) {
        return { txid, status: 'success' as const, alreadyKnown: true }
      }
      if (r.ok) {
        return { txid, status: 'success' as const, alreadyKnown: r.alreadyKnown, data: r.raw }
      }
      return {
        txid,
        status: 'error' as const,
        doubleSpend: r.doubleSpend || undefined,
        // Distinguish "the network says no" from "we could not ask it". The
        // toolbox retries a service error but abandons a rejection.
        serviceError: r.rejected || r.doubleSpend ? undefined : true,
        data: r.raw
      }
    })

    return {
      name: 'arcade',
      status: r.ok ? ('success' as const) : ('error' as const),
      txidResults,
      data: r.raw
    }
  }
}

/** A toolbox `getMerklePath` service backed by Arcade. */
export function makeArcadeMerklePathService(baseUrl: string) {
  return async (txid: string) => {
    const st = await arcadeTxStatus(baseUrl, txid)
    if (!st || !MINED.has(st.txStatus) || !st.merklePath) {
      return { name: 'arcade', notes: [] }
    }
    return { name: 'arcade', merklePath: MerklePath.fromHex(st.merklePath) }
  }
}

/**
 * Route a Services instance's broadcasting and proof lookup through Arcade.
 *
 * The defaults are replaced rather than appended to. They point at hosts serving
 * other chains, so leaving them in place would mean a rejection there could
 * decide the fate of a transaction that is valid here.
 */
export function installArcadeServices(services: unknown, chain: EndpointChain): string {
  const url = arcadeUrl(chain)
  const s = services as {
    postBeefServices: { services: unknown[] }
    getMerklePathServices: { services: unknown[] }
  }
  s.postBeefServices.services = [{ name: 'arcade', service: makeArcadePostBeefService(url) }]
  s.getMerklePathServices.services = [{ name: 'arcade', service: makeArcadeMerklePathService(url) }]
  return url
}
