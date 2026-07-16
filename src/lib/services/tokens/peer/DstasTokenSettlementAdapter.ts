/**
 * DstasTokenSettlementAdapter — concrete TokenSettlementAdapter for DSTAS.
 *
 * The DSTAS analog of StasTokenSettlementAdapter. DSTAS shares classic STAS's
 * BRC-42 receive namespace (STAS_PROTOCOL_ID), so the BRC-29 owner derivation
 * is identical; only the transfer builder (DstasTransferService, custom DSTAS
 * witness) and the destination basket differ.
 *
 *   - buildTokenSettlement derives the recipient's owner key BRC-29-style and
 *     reuses DstasTransferService.transfer (full-value 1-to-1, spending-type 1),
 *     then packages the signed tx as AtomicBEEF.
 *   - acceptTokenSettlement internalizes the recipient output into the DSTAS
 *     basket, recording the BRC-29 derivation so the token stays re-spendable.
 *
 * Interface mirrored locally (see ./tokenSettlementTypes) until
 * @bsv/message-box-client publishes it.
 */
import type { WalletInterface } from '@bsv/sdk';
import { Hash, Utils, createNonce, Beef } from '@bsv/sdk';
import { DstasTransferService } from '../dstas/DstasTransferService';
import { StasKeyDeriver } from '../../stas/StasKeyDeriver';
import { buildChainedAtomicBeef } from '../../stas/buildChainedAtomicBeef';
import { StasRegistration } from '../../stas/StasRegistration';
import { parseDstasLockingScript } from '../../stas/dstasParser';
import { encodeBrc29KeyId } from './brc29KeyId';
import { STAS_PROTOCOL_ID } from '../../stas/constants';
import { DSTAS_BASKET } from '../../../constants/baskets';
import type {
  TokenSettlementAdapter, TokenSourceRef, TokenSettlementArtifact,
  TokenAdapterContext, TokenBuildResult, TokenAcceptResult,
} from './tokenSettlementTypes';

const ORIGINATOR = 'admin.dstas-peer';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class DstasTokenSettlementAdapter implements TokenSettlementAdapter {
  readonly protocol = 'dstas';

  constructor(
    private readonly wallet: WalletInterface,
    private readonly identityKey: string,
    private readonly chain: 'main' | 'test'
  ) {}

  /** BRC-29-style derivation (shared STAS namespace) so the recipient can reconstruct the key. */
  private async deriveRecipientAddress(
    recipient: string,
    derivationPrefix: string,
    derivationSuffix: string
  ): Promise<string> {
    const { publicKey } = await this.wallet.getPublicKey(
      {
        protocolID: STAS_PROTOCOL_ID as any,
        keyID: `${derivationPrefix} ${derivationSuffix}`,
        counterparty: recipient as any,
      },
      ORIGINATOR
    );
    const pkh = Hash.hash160(Utils.toArray(publicKey, 'hex'));
    const versionByte = this.chain === 'main' ? 0x00 : 0x6f;
    return Utils.toBase58Check(pkh, [versionByte]);
  }

  async buildTokenSettlement(
    args: { recipient: string; source: TokenSourceRef; amount: string },
    ctx: TokenAdapterContext
  ): Promise<TokenBuildResult> {
    const { recipient, source, amount } = args;

    // DSTAS is satoshi-denominated; a partial send SPLITS (recipient + sender
    // token-change), like STAS.
    const sendAmt = Number(amount);
    if (!Number.isInteger(sendAmt) || sendAmt < 1 || sendAmt > source.satoshis) {
      return {
        action: 'terminate',
        termination: { code: 'dstas.bad_amount', message: `amount must be an integer between 1 and ${source.satoshis} (got ${amount})` },
      };
    }
    const isPartial = sendAmt < source.satoshis;

    try {
      const derivationPrefix = await createNonce(this.wallet, 'self', ctx.originator);
      const derivationSuffix = await createNonce(this.wallet, 'self', ctx.originator);
      const recipientAddress = await this.deriveRecipientAddress(recipient, derivationPrefix, derivationSuffix);

      // Dry run: prove derivation + validation only — never touch the chain.
      if (ctx.dryRun) {
        ctx.logger?.log(`[dstas dry-run] would transfer ${amount}${isPartial ? ` (split, change ${source.satoshis - sendAmt})` : ''} to ${recipientAddress}`);
        return {
          action: 'settle',
          artifact: {
            customInstructions: { derivationPrefix, derivationSuffix },
            transaction: [],
            protocol: 'dstas',
            assetId: source.assetId,
            amount,
            outputIndex: 0,
          },
        };
      }

      // Partial: derive a self-owned receive key (DSTAS shares the STAS
      // namespace) for the token change.
      let senderChange: { ownerFieldHash160: string; keyId: string } | undefined;
      if (isPartial) {
        const ctxRow = await new StasKeyDeriver(this.wallet, this.identityKey, this.chain).createNextReceiveContext();
        senderChange = { ownerFieldHash160: ctxRow.ownerFieldHash160, keyId: ctxRow.keyId };
      }

      const transfer = new DstasTransferService(this.wallet, this.identityKey, this.chain);
      const res = await transfer.transfer({
        source: {
          txid: source.txid,
          vout: source.outputIndex,
          scriptHex: source.lockingScriptHex,
          satoshis: source.satoshis,
          brc42KeyId: source.brc42KeyId ?? 'recv 0',
          owner: source.owner,
        },
        recipientAddress,
        amount: sendAmt,
        senderChangeHash160: senderChange?.ownerFieldHash160,
        senderChangeKeyId: senderChange?.keyId,
        tokenId: source.assetId,
      });
      if (!res.ok || res.txid == null) {
        return { action: 'terminate', termination: { code: 'dstas.transfer_failed', message: res.reason ?? 'transfer failed' } };
      }

      // Register the sender's token-change DSTAS output (vout 1) — basket was
      // declared at createAction, so only link the satellite tables.
      if (isPartial && senderChange) {
        try {
          const parsedChange = parseDstasLockingScript(source.lockingScriptHex);
          const r = await new StasRegistration(this.wallet, this.identityKey, this.chain).register({
            txid: res.txid,
            vout: 1,
            tokenSatoshis: source.satoshis - sendAmt,
            ownerFieldHash160: senderChange.ownerFieldHash160,
            brc42KeyId: senderChange.keyId,
            parsed: { ...(parsedChange ?? {}), ownerFieldHash160: senderChange.ownerFieldHash160, tokenId: source.assetId } as any,
            protocol: { id: 'dstas', basketName: DSTAS_BASKET },
            skipInternalize: true,
          });
          if (r.registered || r.reason === 'already registered') {
            ctx.logger?.log?.(`[dstas] registered sender token-change (vout 1, ${source.satoshis - sendAmt})`);
          } else {
            ctx.logger?.warn?.(`[dstas] sender token-change NOT registered: ${r.reason}`);
          }
        } catch (e) {
          ctx.logger?.warn?.(`[dstas] sender token-change registration failed (scan will recover): ${String(e)}`);
        }
      }

      const transaction = (res.beef && res.beef.length > 0)
        ? res.beef
        : (await buildChainedAtomicBeef({ wallet: this.wallet, txid: res.txid })).atomicBeef;

      return {
        action: 'settle',
        artifact: {
          customInstructions: { derivationPrefix, derivationSuffix },
          transaction,
          protocol: 'dstas',
          assetId: source.assetId,
          amount,
          outputIndex: 0, // DSTAS transfer places the recipient output at vout 0
          txid: res.txid,
        },
      };
    } catch (err) {
      return { action: 'terminate', termination: { code: 'dstas.build_error', message: errMsg(err) } };
    }
  }

  async acceptTokenSettlement(
    args: { sender: string; settlement: TokenSettlementArtifact },
    _ctx: TokenAdapterContext
  ): Promise<TokenAcceptResult> {
    const { sender, settlement } = args;
    try {
      // Recover the received output from the delivered AtomicBEEF and register
      // it into the satellite tables (like discovery) so it shows in Assets;
      // DSTAS holdings are read from the satellite tables, not the raw basket.
      const beef = Beef.fromBinary(settlement.transaction);
      const txid = (beef as any).atomicTxid as string | undefined
        ?? (beef as any).txs?.[(beef as any).txs.length - 1]?.txid;
      if (txid == null) throw new Error('delivered BEEF has no atomic txid');
      const btx = beef.findTxid(txid);
      if (btx?.tx == null) throw new Error(`delivered BEEF missing tx ${txid}`);
      const out = btx.tx.outputs[settlement.outputIndex];
      if (out == null) throw new Error(`tx ${txid} has no output ${settlement.outputIndex}`);
      const parsed = parseDstasLockingScript(out.lockingScript.toHex());
      if (parsed == null) throw new Error('received output is not DSTAS');

      const brc42KeyId = encodeBrc29KeyId({
        derivationPrefix: settlement.customInstructions.derivationPrefix,
        derivationSuffix: settlement.customInstructions.derivationSuffix,
        senderIdentityKey: sender,
      });

      const reg = new StasRegistration(this.wallet, this.identityKey, this.chain);
      const result = await reg.register({
        txid,
        vout: settlement.outputIndex,
        tokenSatoshis: out.satoshis ?? Number(settlement.amount),
        ownerFieldHash160: parsed.ownerFieldHash160,
        brc42KeyId,
        parsed: { ...parsed, tokenId: parsed.tokenId || settlement.assetId } as any,
        protocol: { id: 'dstas', basketName: DSTAS_BASKET },
        atomicBeef: settlement.transaction,
      });
      if (!result.registered && result.reason !== 'already registered') {
        return { action: 'terminate', termination: { code: 'dstas.register_failed', message: result.reason ?? 'register failed' } };
      }

      return { action: 'accept', receiptData: { internalizeResult: result } };
    } catch (err) {
      return { action: 'terminate', termination: { code: 'dstas.internalize_failed', message: errMsg(err) } };
    }
  }
}
