/**
 * basketOutpoints — storage-agnostic idempotency for token registration.
 *
 * The old idempotency check (`findStasOutputByOutpoint`) read the local-SQLite
 * satellite tables, which are empty on remote storage — so remote scans and
 * register calls never recognised tokens the wallet already held and redundantly
 * re-registered them. Reading the token basket via `listOutputs` works on any
 * storage backend (token baskets hold only a handful of outputs).
 */
import type { WalletInterface } from '@bsv/sdk';

/** Outpoints (`txid.vout`) currently tracked in `basket` on the ACTIVE store. */
export async function loadBasketOutpoints(
  wallet: WalletInterface,
  basket: string,
  originator?: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const res: any = await wallet.listOutputs({ basket, limit: 1000 } as any, originator);
    for (const o of res?.outputs ?? []) {
      if (o?.outpoint) set.add(o.outpoint);
    }
  } catch {
    /* best effort — on failure, fall through and let registration (re-)run */
  }
  return set;
}

/** True if `txid.vout` is already tracked in `basket` on the active store. */
export async function isOutpointInBasket(
  wallet: WalletInterface,
  basket: string,
  txid: string,
  vout: number,
  originator?: string,
): Promise<boolean> {
  return (await loadBasketOutpoints(wallet, basket, originator)).has(`${txid}.${vout}`);
}
