/**
 * BSV21Registration — internalize a discovered BSV-21 UTXO into the
 * `bsv-21-tokens` basket via `wallet.internalizeAction`.
 *
 * BSV-21 keeps every token-level metadata field on the wallet-toolbox
 * basket TAGS (per 1sat-wallet-toolbox convention), so there's no
 * satellite-table linkage step like STAS does. The only durable artefacts
 * are:
 *   - wallet-toolbox's `outputs` row (created by internalizeAction)
 *   - the basket tags carrying `id`, `amt`, `dec`, `sym`, `icon`
 *   - `customInstructions` JSON that lets `wallet.signAction` recover the
 *      BRC-42 derivation context at spend time (BSV-21 inputs are P2PKH;
 *      the protocolID + keyID + counterparty are the unlock recipe)
 *
 * `outputs.spendable` is flipped to true after internalize — the wallet-
 * toolbox conservatively marks non-stock-template outputs `false`, but
 * our adapter knows how to unlock them and the flag would otherwise
 * block `createAction` from referencing the UTXO as input.
 */

import type { WalletInterface } from '@bsv/sdk';
import { BSV21_BASKET } from '../../../constants/baskets';
import { BSV21_PROTOCOL_ID, BSV21_COUNTERPARTY } from './constants';
import { buildChainedAtomicBeef } from '../../stas/buildChainedAtomicBeef';
import { verifyAndPersistOnReceive } from '../verifyOnReceive';

const ORIGINATOR = 'admin.bsv21-discovery';

export interface RegisterBsv21Args {
  txid: string;
  vout: number;
  /** Token id — `<txid>_<vout>` of the deploy+mint. */
  tokenId: string;
  /** Raw amount (stringified bigint). */
  amt: string;
  /** Decimals (optional — usually only on deploy+mint payloads). */
  dec?: number;
  /** Symbol / ticker. */
  sym?: string;
  /** Icon outpoint / URL. */
  icon?: string;
  /** BRC-42 keyID of the receive key that owns this UTXO (e.g. `"recv 7"`). */
  brc42KeyId: string;
  /** Owner address (base58). Stored in customInstructions for diagnostics. */
  ownerAddress: string;
}

export interface RegisterBsv21Result {
  registered: boolean;
  txid: string;
  vout: number;
  outputId?: number;
  reason?: string;
}

export class BSV21Registration {
  constructor(
    private readonly wallet: WalletInterface,
    private readonly identityKey: string,
    private readonly chain: 'main' | 'test' | 'ttn'
  ) {}

  async register(args: RegisterBsv21Args): Promise<RegisterBsv21Result> {
    const { txid, vout, tokenId, amt, dec, sym, icon, brc42KeyId, ownerAddress } = args;

    // 1. Idempotency — if wallet-toolbox already knows the outpoint, skip.
    //    BSV-21 has no satellite table; `outputs.outputId` lookup is the
    //    canonical "have I seen this UTXO?" probe.
    try {
      const existingId = await this.stasQuery('findOutputIdByOutpoint', [txid, vout]);
      if (existingId) {
        return { registered: false, txid, vout, outputId: existingId, reason: 'already registered' };
      }
    } catch {
      /* best-effort — proceed and let internalize handle duplicates */
    }

    // 2. Chained AtomicBEEF — walks back the input ancestry until every
    //    leaf has a proof. Works equally well for confirmed and mempool
    //    BSV-21 outputs.
    let atomicBeef: number[];
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

    // 3. customInstructions carries the BRC-42 derivation recipe for
    //    spend-time unlocking. The transfer service reads this back via
    //    listOutputs / output.customInstructions and feeds it to
    //    wallet.createSignature with the same protocolID + keyID + counterparty.
    const customInstructions = JSON.stringify({
      kind: 'bsv-21',
      protocolID: BSV21_PROTOCOL_ID,
      keyID: brc42KeyId,
      counterparty: BSV21_COUNTERPARTY,
      tokenId,
      ownerAddress,
    });

    const tags: string[] = ['bsv21', `id:${tokenId}`, `amt:${amt}`];
    if (dec !== undefined) tags.push(`dec:${dec}`);
    if (sym) tags.push(`sym:${sym}`);
    if (icon) tags.push(`icon:${icon}`);

    try {
      await this.wallet.internalizeAction(
        {
          tx: atomicBeef,
          outputs: [
            {
              outputIndex: vout,
              protocol: 'basket insertion',
              insertionRemittance: {
                basket: BSV21_BASKET,
                customInstructions,
                tags,
              },
            },
          ],
          description: 'bsv-21 discovery',
          seekPermission: false,
        } as any,
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

    // 4. Look up the freshly-inserted output and flip spendable=true so
    //    createAction will let us reference it as an input later.
    //    Mirror of the STAS post-register step.
    let outputId: number | undefined;
    try {
      outputId = await this.stasQuery('findOutputIdByOutpoint', [txid, vout]);
      if (outputId) {
        await this.stasQuery('setOutputSpendable', [outputId, true]);
      }
    } catch (err) {
      console.warn(`[BSV21Registration] post-internalize step failed for ${txid}:${vout}`, err);
    }

    // Verify provenance on receive (the BSV-21 discovery path). Fire-and-forget.
    verifyAndPersistOnReceive(this.identityKey, this.chain, { txid, vout, protocol: 'bsv-21' });

    return { registered: true, txid, vout, outputId };
  }

  private async stasQuery(method: string, args: any[]): Promise<any> {
    const api =
      typeof window !== 'undefined' ? (window as any).electronAPI?.stas : undefined;
    if (!api) throw new Error('STAS query channel unavailable');
    const res = await api.query(this.identityKey, this.chain, method, args);
    if (!res || !res.success) {
      throw new Error(`stas:query ${method} failed: ${res && res.error}`);
    }
    return res.result;
  }
}
