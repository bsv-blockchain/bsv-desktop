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
import { verifyAndPersistOnReceive } from '../tokens/verifyOnReceive';
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

    // 1. Idempotency — skip outpoints that already live in stas_outputs.
    try {
      const existing = await this.stasQuery('findStasOutputByOutpoint', [txid, vout]);
      if (existing) {
        return {
          registered: false,
          txid,
          vout,
          outputId: existing.outputId,
          reason: 'already registered',
        };
      }
    } catch (err) {
      // Query channel missing (e.g. unit tests without IPC) — proceed cautiously.
      if (!isQueryUnavailable(err)) throw err;
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
    const customInstructions = JSON.stringify({
      tokenId: parsed.tokenId,
      brc42KeyId,
      flagsHex: parsed.flagsHex,
      serviceFields: parsed.serviceFields,
    });
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
                tags: [protocol.id],
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
    // Distinguish "the IPC query channel isn't there" (unit tests, no-IPC
    // contexts — proceed as before) from "the channel answered but there's no
    // local outputs row" (the real remote-storage failure — report it).
    let queryChannelAvailable = true;
    try {
      outputId = await this.stasQuery('findOutputIdByOutpoint', [txid, vout]);
      if (outputId) {
        const now = new Date().toISOString();
        await this.stasQuery('upsertStasToken', [
          {
            tokenId: parsed.tokenId,
            // Real ticker when the parser recovered it (classic STAS carries it
            // in the OP_RETURN tail); otherwise the protocol name — 'STAS' or
            // 'DSTAS' — never a blanket 'STAS' that mislabels DSTAS.
            symbol: (parsed as RichParsed).symbol ?? protocol.id.toUpperCase(),
            name: undefined,
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
      // The token is internalized regardless; the row insert itself is
      // best-effort. Log but don't fail — a transient insert error shouldn't make
      // a genuinely-linked output look unregistered. A missing IPC channel is the
      // benign no-IPC case: record it so we don't misreport it as remote-storage.
      if (isQueryUnavailable(err)) {
        queryChannelAvailable = false;
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[StasRegistration] satellite linkage failed for ${txid}:${vout}`, err);
      }
    }

    // The channel answered but there was no local outputs row to link — so the
    // token, though internalized into the basket, will NOT appear on the Assets
    // page (which renders from the satellite tables). Report this instead of the
    // old silent `registered: true`. The usual cause is remote ("cloud") storage:
    // the satellite tables are local-SQLite only, so `findOutputIdByOutpoint`
    // finds nothing in the local `outputs` table. (When the channel is absent
    // entirely — unit tests — we fall through and report success as before.)
    if (queryChannelAvailable && outputId === undefined) {
      return {
        registered: false,
        txid,
        vout,
        reason:
          'internalized into the basket, but no local outputs row was found to link the ' +
          'STAS/DSTAS satellite tables — so it will not show on the Assets page. This ' +
          'happens on remote ("cloud") storage (the satellite tables are local-SQLite only). ' +
          'Switch to local storage and re-register, or view it via the Baskets page.',
      };
    }

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
