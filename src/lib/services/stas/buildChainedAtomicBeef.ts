/**
 * buildChainedAtomicBeef — assemble an AtomicBEEF for a target txid even when
 * the target itself is unconfirmed (mempool).
 *
 * Why this exists. `wallet.internalizeAction(...)` ultimately calls
 * `Beef.verify(chainTracker, false)` from `@bsv/sdk`. That validator does NOT
 * require every tx in the BEEF to have its own merkle proof — a tx with full
 * rawTx but no proof is accepted **as long as its inputs chain back to a
 * confirmed bump somewhere in the BEEF**. The hardcoded `allowTxidOnly: false`
 * in wallet-toolbox only rejects txid-only entries (hash-only, no bytes), not
 * proof-less full rawTx entries.
 *
 * Net: to internalize a mempool STAS, we need to bundle the target tx PLUS its
 * input ancestry recursively until every leaf input has a merkle proof (or is
 * coinbase). For a typical Issue tx still in mempool the chain is short:
 *   Issue (mempool) → Contract (mempool) → Funding (confirmed, has proof).
 *
 * Recursion is capped (default 10 hops) — STAS chains stay short in practice,
 * the cap protects against pathological inputs.
 */

import { Beef, MerklePath, Transaction, type WalletInterface } from '@bsv/sdk';
import { wocFetch } from '../../utils/RateLimitedFetch';

const WOC_BASE = 'https://api.whatsonchain.com/v1/bsv/main';

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    out.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return out;
}

async function fetchRawTxFromWoc(txid: string): Promise<number[] | null> {
  try {
    const res = await wocFetch.fetch(`${WOC_BASE}/tx/${txid}/hex`);
    if (!res.ok) return null;
    const hex = (await res.text()).trim();
    if (!/^[0-9a-f]+$/i.test(hex)) return null;
    return hexToBytes(hex);
  } catch {
    return null;
  }
}

async function fetchMerklePathFromWoc(txid: string): Promise<MerklePath | null> {
  try {
    // WoC's "tsc" proof variant; we convert to BUMP via the SDK.
    const res = await wocFetch.fetch(`${WOC_BASE}/tx/${txid}/proof/tsc`);
    if (!res.ok) return null;
    const arr = await res.json();
    const tsc = Array.isArray(arr) ? arr[0] : arr;
    if (!tsc || typeof tsc.index !== 'number' || !Array.isArray(tsc.nodes)) return null;
    // Build a minimal BUMP path: 1 level if a single coinbase, otherwise
    // walk the nodes from leaf upward. The SDK provides no TSC->BUMP
    // helper, so we construct the path[]] structure by hand: level 0 has
    // the txid at `index`; each subsequent level walks up halving the
    // index. The tsc.nodes give us the sibling hashes per level.
    const path: any[] = [
      [{ offset: tsc.index, hash: txid, txid: true }],
    ];
    let idx = tsc.index;
    for (const node of tsc.nodes) {
      const siblingOffset = idx ^ 1;
      const hashHex = typeof node === 'string' ? node : node?.hash;
      // '*' means "duplicate the other side" — we omit then.
      if (hashHex && hashHex !== '*') {
        path.push([{ offset: siblingOffset, hash: hashHex }]);
      }
      idx >>= 1;
    }
    const blockHeight =
      typeof tsc.blockHeight === 'number'
        ? tsc.blockHeight
        : typeof tsc.height === 'number'
          ? tsc.height
          : 0;
    return new MerklePath(blockHeight, path as any);
  } catch {
    return null;
  }
}

const COINBASE_TXID =
  '0000000000000000000000000000000000000000000000000000000000000000';

export interface BuildChainedBeefArgs {
  wallet: WalletInterface;
  /** Target txid to internalize. */
  txid: string;
  /** Max input-chain hops to walk back before giving up. Default 10. */
  maxDepth?: number;
}

export interface BuildChainedBeefResult {
  /** AtomicBEEF bytes ready for `internalizeAction(tx: ...)`. */
  atomicBeef: number[];
  /**
   * Plain BEEF bytes (no AtomicBEEF prefix) ready for `createAction(inputBEEF: ...)`.
   * Same payload as `atomicBeef` minus the BRC-95 prefix + atomic txid.
   */
  beef: number[];
  /** Total txs included in the BEEF (target + ancestors). */
  txCount: number;
  /**
   * Number of input-chain hops walked. `0` = target tx had its own merkle path.
   * Useful for telemetry and detecting "this took a while".
   */
  depth: number;
}

/**
 * Build an AtomicBEEF for `txid`. Walks the input chain backwards as needed
 * until every leaf has a merkle proof. Throws if the chain exceeds `maxDepth`
 * or any required tx cannot be fetched.
 */
export async function buildChainedAtomicBeef(
  args: BuildChainedBeefArgs
): Promise<BuildChainedBeefResult> {
  const maxDepth = args.maxDepth ?? 10;
  const services: any = (args.wallet as any).getServices?.();
  if (!services) {
    throw new Error('wallet.getServices() unavailable');
  }

  const beef = new Beef();
  const seen = new Set<string>();
  let maxDepthSeen = 0;

  async function walk(currentTxid: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      throw new Error(
        `chained BEEF: input-chain depth exceeded ${maxDepth} hops at ${currentTxid}`
      );
    }
    if (seen.has(currentTxid)) return;
    seen.add(currentTxid);
    if (depth > maxDepthSeen) maxDepthSeen = depth;

    // 1. fetch rawTx — Services first, then WoC fallback. Some txs the
    //    wallet has touched via internalize don't reappear through
    //    Services.getRawTx; WoC has them as long as they're on chain.
    let rawTxBytes: number[] | null = null;
    try {
      const r = await services.getRawTx(currentTxid);
      if (r?.rawTx) rawTxBytes = r.rawTx as number[];
    } catch {
      /* fall through to WoC */
    }
    if (!rawTxBytes) {
      rawTxBytes = await fetchRawTxFromWoc(currentTxid);
    }
    if (!rawTxBytes) {
      throw new Error(
        `chained BEEF: no rawTx for ${currentTxid} (neither Services nor WoC returned bytes)`
      );
    }

    const tx = Transaction.fromBinary(rawTxBytes);

    // 2. try to get a merkle proof — Services first, then WoC.
    let mp: MerklePath | undefined;
    try {
      const mpRes: any = await services.getMerklePath(currentTxid);
      if (mpRes?.merklePath) {
        mp = mpRes.merklePath as MerklePath;
      }
    } catch {
      /* fall through */
    }
    if (!mp) {
      const fallback = await fetchMerklePathFromWoc(currentTxid);
      if (fallback) mp = fallback;
    }

    if (mp) {
      // Confirmed leaf: attach the proof and stop recursion on this branch.
      tx.merklePath = mp;
      beef.mergeTransaction(tx);
      return;
    }

    // Mempool: add the rawTx with no proof, then chain back through inputs.
    beef.mergeTransaction(tx);

    for (const input of tx.inputs) {
      const sourceTxid: string | undefined =
        (input as any).sourceTXID ?? input.sourceTransaction?.id('hex');
      if (!sourceTxid) {
        throw new Error(
          `chained BEEF: input on ${currentTxid} has no source txid`
        );
      }
      if (sourceTxid === COINBASE_TXID) continue;
      await walk(sourceTxid, depth + 1);
    }
  }

  await walk(args.txid, 0);

  return {
    atomicBeef: beef.toBinaryAtomic(args.txid),
    beef: beef.toBinary(),
    txCount: seen.size,
    depth: maxDepthSeen,
  };
}
