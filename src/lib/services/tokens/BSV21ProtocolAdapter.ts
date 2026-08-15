/**
 * BSV21ProtocolAdapter — wraps the bsv21/* service modules into the
 * cross-protocol `TokenProtocolAdapter` contract declared in Part A.
 *
 * Note: BSV-21 discovery is BESPOKE (BSV21DiscoveryService — 1Sat REST,
 * different from STAS's per-address Bitails scan). The registry's
 * `find(scriptHex)` path is still useful for type detection elsewhere
 * (e.g. if a foreign output ends up in a token basket and we want to
 * recognise it), but the main discovery loop calls
 * `stas.bsv21Discovery.scan()` directly.
 */

import { BSV21_BASKET } from '../../constants/baskets';
import { parseBsv21LockingScript } from './bsv21/inscription';
import type { BSV21TransferService } from './bsv21/BSV21TransferService';
import type {
  TokenProtocolAdapter,
  ParsedTokenOutput,
  TransferArgs,
  TransferResult,
} from './TokenProtocolAdapter';

export class BSV21ProtocolAdapter implements TokenProtocolAdapter {
  readonly id = 'bsv-21' as const;
  readonly basketName = BSV21_BASKET;
  readonly displayName = 'BSV-21';
  readonly transferSupported = true;

  /**
   * `transferService` carries the wallet + indexer + deriver context the
   * BSV-21 send flow needs. The cross-protocol `TransferArgs` shape we
   * receive only covers the input outpoint + recipient + brc42KeyId — for
   * BSV-21 we also need the token id, amount, and decimals to assemble
   * the destination output. Those come from the input's basket TAGS,
   * which the renderer (`AssetsPage`) reads at `listBasketOutputs` time
   * and threads through via a richer args object than the cross-protocol
   * interface exposes.
   */
  constructor(private readonly transferService: BSV21TransferService) {}

  async parseOutput(scriptHex: string): Promise<ParsedTokenOutput | null> {
    const parsed = parseBsv21LockingScript(scriptHex);
    if (!parsed) return null;
    return {
      tokenId: parsed.id,
      ownerFieldHash160: parsed.ownerHash160,
      symbol: parsed.sym,
      satoshisPerToken: 1,
    };
  }

  /**
   * Cross-protocol transfer entry point. AssetsPage passes BSV-21-
   * specific extras (tokenId, amt, dec, sym, icon, sendAmount) through
   * a richer args shape — see `Bsv21SendArgs` below; callers that go
   * through this adapter method should cast their args accordingly.
   */
  async transfer(args: TransferArgs): Promise<TransferResult> {
    const extra = args as TransferArgs & Bsv21SendExtras;
    if (!extra.tokenId || !extra.amount || !extra.sourceAmt) {
      return {
        ok: false,
        reason: 'BSV-21 transfer requires tokenId, amount, and sourceAmt — caller must thread these through',
      };
    }
    return this.transferService.transfer({
      source: {
        txid: args.source.txid,
        vout: args.source.vout,
        scriptHex: args.source.scriptHex,
        satoshis: args.source.satoshis,
        brc42KeyId: args.source.brc42KeyId,
        tokenId: extra.tokenId,
        amt: extra.sourceAmt,
        dec: extra.dec,
        sym: extra.sym,
        icon: extra.icon,
      },
      amount: extra.amount,
      recipientAddress: args.recipientAddress,
    });
  }
}

/**
 * Extra fields callers attach to `TransferArgs` when sending BSV-21.
 * The cross-protocol interface stays minimal; BSV-21 carries token-
 * specific context separately. Exporting this type so AssetsPage's
 * send dialog can shape the args correctly at call time.
 */
export interface Bsv21SendExtras {
  /** Token id of the source UTXO (`txid_vout`). */
  tokenId: string;
  /** Raw token amount the source UTXO holds (stringified bigint). */
  sourceAmt: string;
  /** Raw token amount to send (stringified bigint). */
  amount: string;
  dec?: number;
  sym?: string;
  icon?: string;
}
