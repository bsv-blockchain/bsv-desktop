/**
 * findCreateContractTxid — walk back the input[0] chain from a STAS UTXO until
 * the parent's source output is NOT a STAS script. That `current` tx is the
 * issuer's CreateContract — its txid is the canonical tokenId for the lineage.
 *
 * Classic STAS doesn't carry an explicit tokenId in the locking script. Every
 * UTXO in the same issuance lineage chains back to the same CreateContract,
 * so the contract txid is the natural identifier — stable across transfers
 * and identical for all UTXOs ever issued from that contract.
 *
 * Performance: each step is one rawTx fetch. For most demos chains are ≤ 5
 * deep so we stay under ~10 fetches. Falls back to WoC when wallet Services
 * doesn't have the rawTx (e.g., for ancestors the wallet never internalised).
 */

import { Transaction, type WalletInterface } from '@bsv/sdk';
import { wocFetch } from '../../utils/RateLimitedFetch';

const WOC_BASE = 'https://api.whatsonchain.com/v1/bsv/main';
const DEFAULT_MAX_DEPTH = 30;

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    out.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return out;
}

async function fetchRawTx(
  wallet: WalletInterface,
  txid: string
): Promise<number[] | null> {
  const services: any = (wallet as any).getServices?.();
  if (services) {
    try {
      const r = await services.getRawTx(txid);
      if (r?.rawTx) return r.rawTx as number[];
    } catch {
      /* fall through */
    }
  }
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

/**
 * Classic-STAS heuristic: P2PKH-like prefix (`76 a9 14 <20-byte pkh>`),
 * followed by `88 ac` (OP_EQUALVERIFY OP_CHECKSIG), then `69` (OP_VERIFY).
 * Real STAS engines extend far past this; we only need to detect the prefix.
 */
function isStasScript(scriptHex: string): boolean {
  if (typeof scriptHex !== 'string' || scriptHex.length < 56) return false;
  if (!scriptHex.startsWith('76a914')) return false;
  return scriptHex.substring(46, 52) === '88ac69';
}

export interface FindCreateContractArgs {
  wallet: WalletInterface;
  txid: string;
  maxDepth?: number;
}

export interface FindCreateContractResult {
  /** The CreateContract txid (canonical classic-STAS tokenId). */
  tokenId: string | null;
  /** Number of input-chain hops walked. 0 means `txid` IS the CreateContract. */
  depth: number;
  /** Reason `tokenId` is null, when it is. */
  reason?: string;
}

/**
 * Walk back input[0] until parent output is non-STAS. Returns the current tx's
 * txid as the CreateContract / tokenId. Caps at `maxDepth` (default 30).
 */
export async function findCreateContractTxid(
  args: FindCreateContractArgs
): Promise<FindCreateContractResult> {
  const maxDepth = args.maxDepth ?? DEFAULT_MAX_DEPTH;
  let currentTxid = args.txid;
  for (let i = 0; i < maxDepth; i++) {
    const rawTx = await fetchRawTx(args.wallet, currentTxid);
    if (!rawTx) {
      return { tokenId: null, depth: i, reason: `no rawTx for ${currentTxid}` };
    }
    let tx: Transaction;
    try {
      tx = Transaction.fromBinary(rawTx);
    } catch (err) {
      return {
        tokenId: null,
        depth: i,
        reason: `tx parse for ${currentTxid}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (tx.inputs.length === 0) {
      return { tokenId: null, depth: i, reason: `${currentTxid} has no inputs (coinbase?)` };
    }
    const input0 = tx.inputs[0];
    const parentTxid = (input0 as any).sourceTXID ?? (input0 as any).sourceTxId ?? null;
    if (!parentTxid) {
      return { tokenId: null, depth: i, reason: `${currentTxid} input[0] missing sourceTXID` };
    }
    const parentRaw = await fetchRawTx(args.wallet, parentTxid);
    if (!parentRaw) {
      // Can't see the parent — current tx is likely the CreateContract since
      // walletable ancestry stops. Best-effort: treat current as the tokenId.
      return {
        tokenId: currentTxid,
        depth: i,
        reason: `parent ${parentTxid} unreachable; treating ${currentTxid} as CreateContract`,
      };
    }
    let parentTx: Transaction;
    try {
      parentTx = Transaction.fromBinary(parentRaw);
    } catch {
      return { tokenId: currentTxid, depth: i };
    }
    const parentVout = (input0 as any).sourceOutputIndex ?? (input0 as any).vout ?? 0;
    const parentOutput = parentTx.outputs[parentVout];
    if (!parentOutput) {
      return { tokenId: currentTxid, depth: i };
    }
    const parentScriptHex = parentOutput.lockingScript.toHex();
    if (isStasScript(parentScriptHex)) {
      // Parent is also STAS — walk back.
      currentTxid = parentTxid;
      continue;
    }
    // Parent is non-STAS (BSV funding). `currentTxid` IS the CreateContract.
    return { tokenId: currentTxid, depth: i };
  }
  return { tokenId: null, depth: maxDepth, reason: 'maxDepth exceeded' };
}
