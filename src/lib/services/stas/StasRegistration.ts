/**
 * StasRegistration — turn a discovered STAS UTXO into a wallet-recognised
 * output via `internalizeAction` (basket insertion).
 *
 * Flow:
 *   1. defensive idempotency check via stas:query findStasOutputByOutpoint
 *   2. build a chained AtomicBEEF that walks back through inputs until every
 *      leaf has a merkle proof — so mempool txs work too (see OQ-8 in
 *      notes/OPEN-QUESTIONS.md for the rationale)
 *   3. `wallet.internalizeAction({ outputs: [{ protocol: 'basket insertion', ... }] })`
 *   4. link the satellite rows (stas_tokens + stas_outputs) to the new
 *      wallet-toolbox `outputs.outputId`
 */

import type { AtomicBEEF, WalletInterface } from '@bsv/sdk';
import { STAS_BASKET } from '../../constants/baskets';
import { buildChainedAtomicBeef } from './buildChainedAtomicBeef';
import { isOutpointInBasket } from './basketOutpoints';
import { verifyAndPersistOnReceive } from '../tokens/verifyOnReceive';
import { encodeStasOutputMetadata } from './stasOutputMetadata';
import type { ParsedDstas } from './dstasParser';

/** Classic-STAS parsed payload extends ParsedDstas with optional symbol. */
type RichParsed = ParsedDstas & { symbol?: string };

/**
 * Minimal protocol descriptor consumed by registration. Defined as a
 * primitive shape (id + basketName) rather than importing the full
 * `TokenProtocolAdapter` so the stas/ layer doesn't depend on the
 * tokens/ layer that wraps it.
 */
export interface RegistrationProtocol {
  id: 'stas' | 'dstas' | 'bsv-21';
  basketName: string;
}

const DEFAULT_PROTOCOL: RegistrationProtocol = {
  id: 'stas',
  basketName: STAS_BASKET,
};

export interface RegisterStasArgs {
  txid: string;
  vout: number;
  /** Satoshis on the UTXO (from the indexer scan). */
  tokenSatoshis: number;
  /** hash160 of the BRC-42-derived owner key, hex. */
  ownerFieldHash160: string;
  /** BRC-42 keyID, e.g. `"recv 7"`. */
  brc42KeyId: string;
  /** Parsed DSTAS fields. Classic STAS also carries an optional `symbol`. */
  parsed: RichParsed;
  /**
   * Protocol descriptor — chooses the destination basket and stamps
   * `protocol` on the satellite rows. Defaults to classic STAS for
   * legacy callers that haven't been wired through the registry yet.
   */
  protocol?: RegistrationProtocol;
  /**
   * Optional pre-built AtomicBEEF to internalize. Used by the peer-receive
   * path, which already holds the signed transfer BEEF and must NOT re-fetch
   * a possibly-unpropagated tx from the network. When omitted, a chained
   * AtomicBEEF is assembled from `txid` (the discovery default).
   */
  atomicBeef?: AtomicBEEF;
  /**
   * Skip the internalizeAction step and only link the satellite tables. Used
   * when the output's basket was already declared at createAction time (a
   * sender's own token-change), so the wallet-toolbox output row already exists.
   */
  skipInternalize?: boolean;
  /**
   * Caller-supplied friendly label for a token the chain doesn't carry one for
   * (DSTAS especially). Overrides the parsed symbol when present; stored in the
   * output's customInstructions so it renders portably.
   */
  symbol?: string;
  name?: string;
}

export interface RegisterStasResult {
  registered: boolean;
  txid: string;
  vout: number;
  outputId?: number;
  /** Set when registered=false: human-readable reason. */
  reason?: string;
}

const ORIGINATOR = 'admin.stas-discovery';

export class StasRegistration {
  constructor(
    private readonly wallet: WalletInterface,
    private readonly identityKey: string,
    private readonly chain: 'main' | 'test'
  ) {}

  async register(args: RegisterStasArgs): Promise<RegisterStasResult> {
    const { txid, vout, parsed, brc42KeyId, ownerFieldHash160, tokenSatoshis } = args;
    const protocol = args.protocol ?? DEFAULT_PROTOCOL;

    // 1. Idempotency — skip outpoints already tracked in the token basket.
    //    Storage-agnostic (listOutputs on the ACTIVE store); the old
    //    satellite check (findStasOutputByOutpoint) was local-SQLite only, so
    //    on remote it never recognised a held token and re-registered it.
    if (await isOutpointInBasket(this.wallet, protocol.basketName, txid, vout, ORIGINATOR)) {
      return { registered: false, txid, vout, reason: 'already registered' };
    }

    // 2. Build a chained AtomicBEEF. Walks back through inputs until every
    //    leaf input has a merkle proof; lets us internalize mempool STAS by
    //    chaining the target tx + its parents to a confirmed source.
    //    Peer-receive supplies the BEEF directly (already delivered) so we
    //    don't re-fetch a possibly-unpropagated tx.
    //    When skipInternalize is set, the BEEF is never used (we don't
    //    internalize), so DON'T build it — building it would re-fetch the
    //    just-broadcast tx from WoC and 404, failing the whole registration.
    let atomicBeef: AtomicBEEF = args.atomicBeef ?? [];
    if (args.skipInternalize !== true && atomicBeef.length === 0) {
      try {
        const built = await buildChainedAtomicBeef({ wallet: this.wallet, txid });
        atomicBeef = built.atomicBeef;
      } catch (err) {
        return {
          registered: false,
          txid,
          vout,
          reason: `chained BEEF assembly failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // 4. internalizeAction (basket insertion). Skipped when the caller already
    //    declared the output's basket at createAction time (e.g. a sender's own
    //    token-change) — internalizing it again would conflict; we only need the
    //    satellite linkage below.
    // Encode the FULL token metadata onto the standard output record so the read
    // paths can render + spend STAS/DSTAS from listOutputs alone — no local-only
    // satellite tables. This is what makes these tokens survive remote storage,
    // the same way BSV-21 already does. (Satellite rows are still written below
    // during the transition; they become redundant once every reader is cut over.)
    const richParsed = parsed as RichParsed;
    // Prefer the on-chain/parsed symbol (classic STAS); fall back to a
    // caller-supplied one (DSTAS, whose symbol isn't on-chain).
    const effectiveSymbol = richParsed.symbol ?? args.symbol;
    const encoded = encodeStasOutputMetadata({
      kind: protocol.id === 'dstas' ? 'dstas' : 'stas',
      tokenId: parsed.tokenId,
      brc42KeyId,
      ownerFieldHash160,
      symbol: effectiveSymbol,
      name: args.name ?? null,
      flagsHex: parsed.flagsHex,
      freezeEnabled: parsed.freezeEnabled,
      confiscationEnabled: parsed.confiscationEnabled,
      redemptionPkh: parsed.tokenId === '' ? undefined : parsed.tokenId,
      satoshisPerToken: 1,
      serviceFields: parsed.serviceFields,
      frozen: false,
      confiscated: false,
    });
    const customInstructions = encoded.customInstructions;
    if (args.skipInternalize !== true) {
    try {
      await this.wallet.internalizeAction(
        {
          tx: atomicBeef,
          outputs: [
            {
              outputIndex: vout,
              protocol: 'basket insertion',
              insertionRemittance: {
                basket: protocol.basketName,
                customInstructions,
                tags: encoded.tags,
              },
            },
          ],
          // Display-cased label — preserves the original "STAS discovery"
          // wording for STAS while staying protocol-aware for the others.
          description: `${
            protocol.id === 'bsv-21'
              ? 'BSV-21'
              : protocol.id.toUpperCase()
          } discovery`,
          seekPermission: false,
        },
        ORIGINATOR
      );
    } catch (err) {
      return {
        registered: false,
        txid,
        vout,
        reason: `internalizeAction failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    }

    // 5. Link satellite tables. The wallet-toolbox `outputs` row was created
    //    inside internalizeAction (or by the caller's createAction basket
    //    declaration when skipInternalize); we look it up by outpoint to populate ours.
    let outputId: number | undefined;
    try {
      outputId = await this.stasQuery('findOutputIdByOutpoint', [txid, vout]);
      if (outputId) {
        const now = new Date().toISOString();
        await this.stasQuery('upsertStasToken', [
          {
            tokenId: parsed.tokenId,
            // Parsed ticker (classic STAS, from the OP_RETURN tail), else a
            // caller-supplied one (DSTAS), else the protocol name — never a
            // blanket 'STAS' that mislabels DSTAS.
            symbol: effectiveSymbol ?? protocol.id.toUpperCase(),
            name: args.name,
            satoshisPerToken: 1,
            freezeEnabled: parsed.freezeEnabled,
            confiscationEnabled: parsed.confiscationEnabled,
            // redemptionPkh remains the parsed value for DSTAS; classic STAS
            // doesn't carry one in the engine, so we leave it null-ish.
            redemptionPkh: parsed.tokenId === '' ? undefined : parsed.tokenId,
            issuerIdentityKey: undefined,
            flagsHex: parsed.flagsHex,
            createdAt: now,
            protocol: protocol.id,
          },
        ]);
        await this.stasQuery('insertStasOutput', [
          {
            outputId,
            tokenId: parsed.tokenId,
            brc42KeyId,
            ownerFieldHash160,
            tokenSatoshis,
            frozen: false,
            confiscated: false,
            serviceFieldsJson: JSON.stringify(parsed.serviceFields),
            createdAt: now,
            updatedAt: now,
            protocol: protocol.id,
          },
        ]);
        // STAS outputs land with `spendable=false` because wallet-toolbox
        // can't recognise the custom script as one it knows how to unlock.
        // We sign externally via the BRC-42 path, so the flag is a false
        // negative — flip it now so the user can transfer the UTXO without
        // an extra preflight step at send-time.
        await this.stasQuery('setOutputSpendable', [outputId, true]);
      }
    } catch (err) {
      // Satellite linkage is a best-effort LOCAL optimization. The token is
      // internalized into the basket regardless and renders from the basket read
      // (Assets page, since the render unification). Log real failures; stay quiet
      // on the benign no-IPC case (unit tests / no Electron bridge).
      if (!isQueryUnavailable(err)) {
        // eslint-disable-next-line no-console
        console.warn(`[StasRegistration] satellite linkage failed for ${txid}:${vout}`, err);
      }
    }

    // NOTE: a missing local `outputs` row (remote/"cloud" storage — the satellite
    // tables are local-SQLite only) is NOT a failure. The token is internalized
    // into the basket and renders from the basket read; the satellite link is a
    // local optimization we simply skip on remote. Reporting `registered:false`
    // here used to make the peer-accept flow throw even though the token arrived.

    // Verify provenance the moment the token is ours — covers both the discovery
    // scan and peer-accept paths (both land here). Fire-and-forget; never blocks
    // the receive. `protocol.id` is 'stas' | 'dstas' | 'bsv-21'.
    verifyAndPersistOnReceive(this.identityKey, this.chain, { txid, vout, protocol: protocol.id });

    return { registered: true, txid, vout, outputId };
  }

  private async stasQuery(method: string, args: any[]): Promise<any> {
    const api =
      typeof window !== 'undefined' ? (window as any).electronAPI?.stas : undefined;
    if (!api) {
      throw new QueryUnavailableError('STAS query channel unavailable');
    }
    const res = await api.query(this.identityKey, this.chain, method, args);
    if (!res || !res.success) {
      throw new Error(`stas:query ${method} failed: ${res && res.error}`);
    }
    return res.result;
  }
}

class QueryUnavailableError extends Error {
  readonly _queryUnavailable = true;
}

function isQueryUnavailable(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as any)._queryUnavailable === true;
}
