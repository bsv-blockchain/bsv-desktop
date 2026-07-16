/**
 * BackToGenesisClient — WhatsOnChain token-provenance (Back-to-Genesis) reads.
 *
 * B2G answers one question about a token output: *does it provably descend from
 * its genesis mint, with token conservation preserved at every hop back?* The
 * endpoint walks raw transactions from bStore on demand — it does NOT use the
 * token index, so it verifies tokens the index hasn't caught up on (confirmed
 * against activation-pending BSV-21 that 404 on the UTXO endpoints).
 *
 *   GET /token/{std}/tx/{txid}/out/{index}/verify[?expectedGenesis=<txid>_<vout>]
 *   GET /token/{std}/tx/{txid}/out/{index}/trace[?maxDepth=N]
 *
 * `result` is TRI-STATE and the distinction is load-bearing:
 *   - `authentic`     — provably descends from a genesis, conservation held.
 *   - `not-authentic` — a provenance rule failed. This is the counterfeit
 *                       verdict (verified adversarially: an output cloning a
 *                       real token's tokenId+symbol but with no valid ancestor
 *                       returns not-authentic / no-genesis).
 *   - `undetermined`  — could NOT be decided (walk deeper than maxDepth, or a
 *                       source tx was unavailable). Fail-SAFE: treat as
 *                       "unknown", NEVER as counterfeit. A real token must never
 *                       be shown fake because a fetch failed.
 *
 * IDENTITY CAVEAT (see project notes): for classic STAS `assetKey.tokenId` is
 * the issuer PKH — every token an issuer ever minted shares it — and the
 * response omits `symbol`. So `authentic` proves the token is real, NOT which
 * token it is. The only stable identity is the resolved `genesis` outpoint;
 * pin trust with `expectedGenesis` and check `matchesExpectedGenesis`.
 *
 * Every call is fail-soft: a 404 / 5xx / network error yields `undetermined`
 * with a synthetic reason, never a throw. Verification degrading to "unknown"
 * must never break a receive.
 */

import { wocFetch } from '../../../utils/RateLimitedFetch';

const WOC_BASE = 'https://api.whatsonchain.com/v1/bsv';

/** Token standard discriminator, matching the endpoint path segment. */
export type TokenStd = 'stas' | 'dstas' | 'bsv21';

export type B2GResultState = 'authentic' | 'not-authentic' | 'undetermined';

/** A `<txid>_<vout>` genesis reference, or a structured outpoint. */
export interface B2GOutpoint {
  txid: string;
  index: number;
}

export interface B2GVerifyResult {
  outpoint: B2GOutpoint;
  result: B2GResultState;
  /** Present when not `authentic` — e.g. no-genesis, conservation-violation,
   *  genesis-malformed, not-a-token, source-unavailable, max-depth-exceeded. */
  reason?: string;
  /** Standard-specific identity: `tokenId` (STAS/DSTAS) or `id` (BSV-21). */
  assetKey?: { tokenId?: string; id?: string };
  /** The resolved genesis outpoint — the ONLY stable token identity. */
  genesis?: B2GOutpoint;
  /** Hops from the queried output back to genesis; 0 = the output IS genesis. */
  genesisDepth?: number;
  /** Token amount at the queried output (string — preserves big integers). */
  amount?: string;
  conservationOk?: boolean;
  /** Only present when `expectedGenesis` was supplied. */
  matchesExpectedGenesis?: boolean;
  /** Present on failure — the outpoint where the walk stopped. */
  failedAt?: B2GOutpoint;
}

export interface B2GTraceHop {
  txid: string;
  index: number;
  amount: string;
  op: 'genesis' | 'transfer' | 'split' | 'merge';
  parentOutpoint?: string;
}

export interface B2GTraceResult {
  outpoint: B2GOutpoint;
  result: B2GResultState;
  reason?: string;
  genesis?: B2GOutpoint;
  genesisDepth?: number;
  path?: B2GTraceHop[];
  maxDepth?: number;
  truncated?: boolean;
}

export interface BackToGenesisOptions {
  chain?: 'main' | 'test';
  /** Base URL override (tests). Defaults to `${WOC_BASE}/${chain}`. */
  baseUrl?: string;
}

/** Format a genesis outpoint as the `expectedGenesis` / `parentOutpoint` wire form. */
export function formatGenesisRef(g: B2GOutpoint): string {
  return `${g.txid}_${g.index}`;
}

export class BackToGenesisClient {
  private readonly base: string;

  constructor(opts: BackToGenesisOptions = {}) {
    const chain = opts.chain ?? 'main';
    this.base = (opts.baseUrl ?? `${WOC_BASE}/${chain}`).replace(/\/$/, '');
  }

  /**
   * Verify a token output's provenance. Never throws — a transport failure
   * returns `undetermined` (fail-safe), so a caller can always branch on
   * `result` without a try/catch.
   *
   * @param expectedGenesis optional `<txid>_<vout>` to assert the origin; adds
   *        `matchesExpectedGenesis` to the result.
   */
  async verify(
    std: TokenStd,
    txid: string,
    index: number,
    opts: { expectedGenesis?: string } = {}
  ): Promise<B2GVerifyResult> {
    const qs = opts.expectedGenesis
      ? `?expectedGenesis=${encodeURIComponent(opts.expectedGenesis)}`
      : '';
    const path = `/token/${std}/tx/${txid}/out/${index}/verify${qs}`;
    const json = await this.getJson<B2GVerifyResult>(path);
    if (!json) {
      return {
        outpoint: { txid, index },
        result: 'undetermined',
        reason: 'source-unavailable',
      };
    }
    return json;
  }

  /**
   * Trace the full provenance path back to genesis. Same fail-safe contract as
   * verify(). `maxDepth` is clamped server-side to 100.
   */
  async trace(
    std: TokenStd,
    txid: string,
    index: number,
    opts: { maxDepth?: number } = {}
  ): Promise<B2GTraceResult> {
    const qs = opts.maxDepth ? `?maxDepth=${opts.maxDepth}` : '';
    const path = `/token/${std}/tx/${txid}/out/${index}/trace${qs}`;
    const json = await this.getJson<B2GTraceResult>(path);
    if (!json) {
      return {
        outpoint: { txid, index },
        result: 'undetermined',
        reason: 'source-unavailable',
      };
    }
    return json;
  }

  private async getJson<T>(path: string): Promise<T | null> {
    try {
      const res = await wocFetch.fetch(`${this.base}${path}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null; // 400 (bad std/index) / 404 / 5xx → undetermined
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
}
