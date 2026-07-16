/**
 * WocTokenIndexerClient — single WhatsOnChain-backed discovery source for all
 * three token standards (STAS, DSTAS, BSV-21), replacing the previous
 * per-standard indexers (Bitails, the local relay, the 1Sat overlay).
 *
 * One host, one chain-selected base URL, one shared `wocFetch` rate budget,
 * one `?script=true` convention. Only the address format + path template
 * differ per standard:
 *
 *   STAS    GET /address/{base58}/tokens/unspent           (base58 address)
 *   DSTAS   GET /address/{ownerHash160}/tokens/dstas/unspent  (raw hash160!)
 *   BSV-21  GET /token/bsv21/{base58}/unspent               (base58 address)
 *
 * The methods are intentionally DUCK-TYPE COMPATIBLE with the clients they
 * replace so the discovery services swap in with a minimal diff:
 *   - `getUtxosForAddresses` matches `stas/IndexerClient` (STAS),
 *   - `getOwnedTxos`         matches `bsv21/OneSatIndexerClient` (BSV-21),
 *   - `getDstasUtxosForOwners` is new (DSTAS gained a real indexer).
 *
 * Every request is fail-soft: a 404 (e.g. WOC's DSTAS endpoint not yet on
 * mainnet, or an unactivated BSV-21) or a network error yields `[]`, never a
 * throw — discovery degrades to empty rather than breaking.
 *
 * DSTAS/STAS responses include the full locking `script` with `?script=true`
 * (surfaced as `WocUtxo.scriptHex`, letting the STAS scan skip a per-txid
 * getRawTx for parsing). BSV-21's unspent response carries only `scriptHash`,
 * so the BSV-21 scan still fetches the raw tx to parse the inscription.
 */

import { wocFetch } from '../../../utils/RateLimitedFetch';
import { wocApiBase, type Chain } from '../../../utils/woc';
import type { IndexedOutput } from '../bsv21/OneSatIndexerClient';

/**
 * Reports how far a per-address fan-out has got. WOC has no bulk token endpoint,
 * so a scan is one throttled request per derived address — tens of seconds for a
 * grown wallet. Without this the UI can only show an indeterminate spinner.
 */
export type ScanProgressFn = (done: number, total: number) => void;

/** A token UTXO as returned by WOC's per-address token endpoints. */
export interface WocUtxo {
  /** Transaction id (hex). */
  txid: string;
  /** Output index. */
  vout: number;
  /** Satoshis. For STAS/DSTAS this equals the token amount. */
  value: number;
  /** Block height. WOC's token endpoints omit it; we pass a mempool-safe sentinel. */
  height: number;
  /** Ticker, when the indexer decoded one. */
  symbol?: string;
  /** tokenId / issuer PKH hex, when present in the response. */
  redeemAddr?: string;
  /** Full locking script hex (`?script=true`) — lets the scan skip a getRawTx. */
  scriptHex?: string;
}

export interface WocTokenIndexerOptions {
  chain?: Chain;
  /** Base URL override (tests). Defaults to `wocApiBase(chain)`. */
  baseUrl?: string;
}

/** WOC's DSTAS/STAS per-address unspent shape (subset we consume). */
interface WocTokenUtxo {
  txid?: string;
  tx_hash?: string;
  index?: number;
  vout?: number;
  tx_pos?: number;
  satoshis?: number;
  amount?: number;
  value?: number;
  script?: string;
  symbol?: string;
  tokenId?: string;
  redeemAddr?: string;
}

export class WocTokenIndexerClient {
  private readonly base: string;

  constructor(opts: WocTokenIndexerOptions = {}) {
    const chain = opts.chain ?? 'main';
    this.base = (opts.baseUrl ?? wocApiBase(chain)).replace(/\/$/, '');
  }

  private async getJson<T>(path: string): Promise<T | null> {
    try {
      const res = await wocFetch.fetch(`${this.base}${path}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null; // 404 / 5xx → degrade to empty
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  /** Normalize a WOC STAS/DSTAS token utxo into the shared `WocUtxo` shape. */
  private toWocUtxo(u: WocTokenUtxo): WocUtxo {
    return {
      txid: (u.txid ?? u.tx_hash ?? '') as string,
      vout: (u.index ?? u.vout ?? u.tx_pos ?? 0) as number,
      value: (u.satoshis ?? u.amount ?? u.value ?? 0) as number,
      height: 1, // sentinel — WOC token endpoints don't return height; mempool OK
      symbol: u.symbol,
      redeemAddr: u.tokenId ?? u.redeemAddr,
      scriptHex: u.script,
    };
  }

  /**
   * Classic-STAS UTXOs across many base58 addresses.
   * Drop-in for `IndexerClient.getUtxosForAddresses` (same return shape).
   * WOC has no bulk STAS endpoint, so this fans out per-address through the
   * shared rate limiter (same budget the wallet's other WOC polling uses).
   */
  async getUtxosForAddresses(
    addresses: string[],
    opts: { onProgress?: ScanProgressFn } = {}
  ): Promise<Array<{ address: string; utxos: WocUtxo[] }>> {
    const out: Array<{ address: string; utxos: WocUtxo[] }> = [];
    for (const address of addresses) {
      opts.onProgress?.(out.length, addresses.length);
      const res = await this.getJson<{ utxos?: WocTokenUtxo[] | null }>(
        `/address/${encodeURIComponent(address)}/tokens/unspent?script=true`
      );
      const utxos = Array.isArray(res?.utxos) ? res!.utxos!.map((u) => this.toWocUtxo(u)) : [];
      out.push({ address, utxos });
    }
    return out;
  }

  /**
   * DSTAS UTXOs across many owner HASH160s. NB: WOC's DSTAS address endpoint
   * keys on the raw owner hash160, not a base58 address. Returns the same
   * `WocUtxo` shape so the STAS discovery loop can consume it uniformly.
   */
  async getDstasUtxosForOwners(
    ownerHash160s: string[],
    opts: { onProgress?: ScanProgressFn } = {}
  ): Promise<Array<{ ownerHash160: string; utxos: WocUtxo[] }>> {
    const out: Array<{ ownerHash160: string; utxos: WocUtxo[] }> = [];
    for (const ownerHash160 of ownerHash160s) {
      opts.onProgress?.(out.length, ownerHash160s.length);
      const res = await this.getJson<{ utxos?: WocTokenUtxo[] | null }>(
        `/address/${encodeURIComponent(ownerHash160)}/tokens/dstas/unspent?script=true`
      );
      const utxos = Array.isArray(res?.utxos) ? res!.utxos!.map((u) => this.toWocUtxo(u)) : [];
      out.push({ ownerHash160, utxos });
    }
    return out;
  }

  /**
   * BSV-21 unspent outputs at a single base58 address, mapped to the
   * `IndexedOutput` shape so `BSV21DiscoveryService.scan()` consumes it
   * unchanged (drop-in for `OneSatIndexerClient.getOwnedTxos`).
   *
   * WOC returns `{ tokens: [{ outpoint: "<txid>_<vout>", data:{ bsv20:{id,sym,amt},
   * insc:{json:{dec}} } }] }`. We emit `events:['bsv21']` + `id` so the scan's
   * BSV-21 filter admits every row (the endpoint is already BSV-21-only).
   */
  async getOwnedTxos(address: string): Promise<IndexedOutput[]> {
    const res = await this.getJson<{ tokens?: WocBsv21Unspent[] | null }>(
      `/token/bsv21/${encodeURIComponent(address)}/unspent?script=true`
    );
    if (!Array.isArray(res?.tokens)) return [];
    return res!.tokens!.map((t) => {
      const bsv20 = t.data?.bsv20 ?? {};
      const insc = t.data?.insc?.json ?? {};
      const decStr = insc.dec;
      const dec = decStr !== undefined && decStr !== '' ? Number(decStr) : undefined;
      return {
        outpoint: t.outpoint ?? (t.vout !== undefined && t.current?.txid ? `${t.current.txid}_${t.vout}` : ''),
        id: (bsv20.id ?? insc.id ?? t.outpoint) as string | undefined,
        amt: bsv20.amt !== undefined ? String(bsv20.amt) : insc.amt,
        dec: Number.isFinite(dec as number) ? (dec as number) : undefined,
        // WOC names it `symbol` on the decoded `bsv20` object but `sym` inside
        // the raw inscription JSON. Transfers carry neither — the parsed
        // locking script is the caller's fallback.
        sym: bsv20.symbol ?? bsv20.sym ?? insc.sym,
        icon: bsv20.icon,
        events: ['bsv21'],
      } as IndexedOutput;
    });
  }
}

/** WOC's BSV-21 per-address unspent row (subset we consume). */
interface WocBsv21Unspent {
  outpoint?: string;
  vout?: number;
  current?: { txid?: string };
  data?: {
    bsv20?: {
      id?: string;
      amt?: string | number;
      /** WOC's decoded field name. `sym` is the raw-inscription spelling. */
      symbol?: string;
      sym?: string;
      icon?: string;
    };
    insc?: { json?: { id?: string; amt?: string; dec?: string; sym?: string } };
  };
}
