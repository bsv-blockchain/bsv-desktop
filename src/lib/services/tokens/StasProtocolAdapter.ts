/**
 * StasProtocolAdapter — classic STAS, the original on-chain token engine.
 *
 * Recognises locking scripts by the canonical P2PKH+OP_VERIFY prefix
 * (`76a914 <pkh> 88ac69 …`), extracts symbol/flags from the OP_RETURN
 * tail via parseClassicStasMetadata, and walks back through tx inputs
 * to the CreateContract txid (canonical tokenId) via findCreateContractTxid.
 *
 * Transfer delegates to the existing StasTransferService, which carries
 * the BRC-42-unlock + stas-js engine logic.
 */

import { STAS_BASKET } from '../../constants/baskets';
import { parseClassicStasMetadata } from '../stas/parseClassicStasMetadata';
import { findCreateContractTxid } from '../stas/findCreateContractTxid';
import { StasTransferService } from '../stas/StasTransferService';
import type {
  TokenProtocolAdapter,
  ParseContext,
  ParsedTokenOutput,
  TransferArgs,
  TransferResult,
} from './TokenProtocolAdapter';

export class StasProtocolAdapter implements TokenProtocolAdapter {
  readonly id = 'stas' as const;
  readonly basketName = STAS_BASKET;
  readonly displayName = 'STAS';
  readonly transferSupported = true;

  constructor(private readonly transferService: StasTransferService) {}

  async parseOutput(scriptHex: string, ctx?: ParseContext): Promise<ParsedTokenOutput | null> {
    const meta = parseClassicStasMetadata(scriptHex);
    if (!meta) return null;

    // Best-effort: derive canonical tokenId by walking back to the
    // CreateContract tx. Caller may not have supplied a wallet (parse-only
    // contexts), in which case we leave tokenId empty — registration will
    // backfill it later.
    let tokenId = '';
    if (ctx?.wallet && ctx?.txid) {
      try {
        const cc = await findCreateContractTxid({ wallet: ctx.wallet, txid: ctx.txid });
        if (cc.tokenId) tokenId = cc.tokenId;
      } catch {
        // Leave tokenId empty; non-fatal.
      }
    }

    return {
      tokenId,
      ownerFieldHash160: meta.ownerFieldHash160,
      symbol: meta.symbol ?? undefined,
      flagsHex: meta.flagsHex ?? undefined,
      satoshisPerToken: 1,
      freezeEnabled: false,
      confiscationEnabled: false,
      serviceFields: [],
    };
  }

  async transfer(args: TransferArgs): Promise<TransferResult> {
    return this.transferService.transfer(args);
  }
}
