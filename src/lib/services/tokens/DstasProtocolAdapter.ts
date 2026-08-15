/**
 * DstasProtocolAdapter — STAS v3 / "DSTAS", parsed via dxs-bsv-token-sdk.
 *
 * Discovery + registration land via StasDiscoveryService's registry
 * dispatch. Transfer goes through DstasTransferService (F3): the SDK's
 * `buildDstasLockingScript` gives us the new output, wallet-toolbox
 * handles funding + broadcast via createAction/signAction, and the
 * DSTAS unlocking script is hand-assembled to match the template's
 * expected witness format (mirror of the SDK's InputBuilder.sign).
 */

import { DSTAS_BASKET } from '../../constants/baskets';
import { parseDstasLockingScript } from '../stas/dstasParser';
import type {
  TokenProtocolAdapter,
  ParsedTokenOutput,
  TransferArgs,
  TransferResult,
} from './TokenProtocolAdapter';
import type { DstasTransferService } from './dstas/DstasTransferService';

export class DstasProtocolAdapter implements TokenProtocolAdapter {
  readonly id = 'dstas' as const;
  readonly basketName = DSTAS_BASKET;
  readonly displayName = 'DSTAS';
  readonly transferSupported = true;

  constructor(private readonly transferService: DstasTransferService) {}

  async parseOutput(scriptHex: string): Promise<ParsedTokenOutput | null> {
    const parsed = parseDstasLockingScript(scriptHex);
    if (!parsed) return null;
    return {
      tokenId: parsed.tokenId,
      ownerFieldHash160: parsed.ownerFieldHash160,
      flagsHex: parsed.flagsHex,
      satoshisPerToken: 1,
      freezeEnabled: parsed.freezeEnabled,
      confiscationEnabled: parsed.confiscationEnabled,
      serviceFields: parsed.serviceFields,
    };
  }

  async transfer(args: TransferArgs): Promise<TransferResult> {
    return this.transferService.transfer(args);
  }
}
