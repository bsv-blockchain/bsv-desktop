/**
 * TokenVerificationService — Back-to-Genesis provenance for held tokens.
 *
 * Wraps BackToGenesisClient with the two things the UI needs on top of the raw
 * endpoint:
 *
 *  1. A per-outpoint session cache. An outpoint's provenance is immutable
 *     (barring a reorg), so we verify each `(std, txid, vout)` at most once per
 *     session. Durable persistence across sessions lives in the wallet DB
 *     (`token_verifications`, migration 0004), seeded by the caller — this
 *     in-memory map is only the same-session accelerator on top of it.
 *
 *  2. A per-token aggregate. A token card groups several UTXOs; its badge is the
 *     worst verdict among them — one counterfeit output taints the card, and an
 *     `undetermined` (unknown) never masquerades as verified.
 *
 * Why the wallet needs this at all: for classic STAS `assetKey.tokenId` is the
 * issuer PKH, shared by every token that issuer minted, and B2G omits `symbol`.
 * So `authentic` alone cannot tell EXSTAS1 from EXSTAS2 — the resolved `genesis`
 * outpoint is the only stable identity. Callers should group/trust on genesis,
 * which this service surfaces per outpoint.
 *
 * Fail-safe throughout: a transport failure is `undetermined`, never a throw and
 * never a false counterfeit.
 */

import {
  BackToGenesisClient,
  formatGenesisRef,
  type B2GVerifyResult,
  type TokenStd,
} from './woc/BackToGenesisClient';
import type { TokenProtocolId } from './TokenProtocolAdapter';

/** UI-facing rollup of a token card's provenance. */
export type VerificationBadge = 'verified' | 'counterfeit' | 'unknown';

export interface OutpointVerification {
  outpoint: string; // `${txid}_${vout}`
  result: B2GVerifyResult['result'];
  reason?: string;
  /** `${txid}_${vout}` of the resolved genesis — the stable token identity. */
  genesis?: string;
  genesisDepth?: number;
}

/** The minimum an item must expose to be verifiable. */
export interface VerifiableOutput {
  txid: string;
  vout: number;
  protocol: TokenProtocolId;
}

const PROTOCOL_TO_STD: Record<TokenProtocolId, TokenStd> = {
  stas: 'stas',
  dstas: 'dstas',
  'bsv-21': 'bsv21',
};

/** Roll a set of per-outpoint verdicts into one card badge (worst wins). */
export function aggregateBadge(verdicts: OutpointVerification[]): VerificationBadge {
  if (verdicts.length === 0) return 'unknown';
  if (verdicts.some((v) => v.result === 'not-authentic')) return 'counterfeit';
  if (verdicts.every((v) => v.result === 'authentic')) return 'verified';
  return 'unknown'; // at least one undetermined, none counterfeit
}

export class TokenVerificationService {
  private readonly client: BackToGenesisClient;
  private readonly chain: 'main' | 'test';
  /** Same-session cache. Durable persistence is the wallet DB (see class doc). */
  private readonly cache = new Map<string, OutpointVerification>();

  constructor(opts: { chain?: 'main' | 'test'; client?: BackToGenesisClient } = {}) {
    this.chain = opts.chain ?? 'main';
    this.client = opts.client ?? new BackToGenesisClient({ chain: this.chain });
  }

  private key(std: TokenStd, txid: string, vout: number): string {
    return `${std}:${txid}_${vout}`;
  }

  /**
   * Seed the session cache from durable storage (the wallet DB). Lets a card's
   * badge render from a prior session's verdict before any network call. Only
   * settled verdicts should be seeded — an `undetermined` must be re-verified.
   */
  seed(entries: Array<{ output: VerifiableOutput; verdict: OutpointVerification }>): void {
    for (const { output, verdict } of entries) {
      if (verdict.result === 'undetermined') continue;
      const std = PROTOCOL_TO_STD[output.protocol];
      this.cache.set(this.key(std, output.txid, output.vout), verdict);
    }
  }

  /** Cached verdict for one outpoint, or undefined if never verified. */
  peek(output: VerifiableOutput): OutpointVerification | undefined {
    const std = PROTOCOL_TO_STD[output.protocol];
    return this.cache.get(this.key(std, output.txid, output.vout));
  }

  /**
   * Verify one outpoint, using the cache unless `force`. A settled verdict
   * (authentic / not-authentic) is never re-fetched; an `undetermined` one is
   * retried, since it means "couldn't decide yet", not "decided: unknown".
   */
  async verifyOutput(
    output: VerifiableOutput,
    opts: { expectedGenesis?: string; force?: boolean } = {}
  ): Promise<OutpointVerification> {
    const std = PROTOCOL_TO_STD[output.protocol];
    const k = this.key(std, output.txid, output.vout);
    const cached = this.cache.get(k);
    if (!opts.force && cached && cached.result !== 'undetermined') return cached;

    const res = await this.client.verify(std, output.txid, output.vout, {
      expectedGenesis: opts.expectedGenesis,
    });
    const verdict: OutpointVerification = {
      outpoint: `${output.txid}_${output.vout}`,
      result: res.result,
      reason: res.reason,
      genesis: res.genesis ? formatGenesisRef(res.genesis) : undefined,
      genesisDepth: res.genesisDepth,
    };
    this.cache.set(k, verdict);
    return verdict;
  }

  /**
   * Verify many outpoints. Returns a map keyed by `${txid}_${vout}`. Requests
   * go through the shared WOC rate limiter, so passing the whole wallet at once
   * is safe — they queue rather than burst. Cached outpoints resolve instantly.
   */
  async verifyOutputs(
    outputs: VerifiableOutput[],
    opts: { force?: boolean } = {}
  ): Promise<Map<string, OutpointVerification>> {
    const results = await Promise.all(
      outputs.map((o) => this.verifyOutput(o, { force: opts.force }))
    );
    const map = new Map<string, OutpointVerification>();
    results.forEach((v) => map.set(v.outpoint, v));
    return map;
  }
}
