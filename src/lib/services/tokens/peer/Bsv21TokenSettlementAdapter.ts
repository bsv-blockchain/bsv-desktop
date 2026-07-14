/**
 * Bsv21TokenSettlementAdapter — concrete TokenSettlementAdapter for BSV-21.
 *
 * The BSV-21 analog of StasTokenSettlementAdapter. Because BSV-21 ownership is
 * plain P2PKH (no engine), the peer flow is closer to PeerPay's BRC-29:
 *   - buildTokenSettlement derives the recipient's owner key BRC-29-style
 *     (counterparty = recipient) and reuses BSV21TransferService.transfer,
 *     which supports divisible/partial sends (recipient + token-change);
 *   - acceptTokenSettlement internalizes the recipient output into the BSV-21
 *     basket, recording the BRC-29 derivation so the token stays re-spendable.
 *
 * The TokenSettlementAdapter interface is mirrored locally (see
 * ./tokenSettlementTypes) until @bsv/message-box-client publishes it.
 */
import type { WalletInterface } from '@bsv/sdk';
import { Hash, Utils, createNonce, Beef } from '@bsv/sdk';
import { BSV21TransferService, type BSV21TransferDeps } from '../bsv21/BSV21TransferService';
import { buildChainedAtomicBeef } from '../../stas/buildChainedAtomicBeef';
import { parseBsv21LockingScript } from '../bsv21/inscription';
import { verifyAndPersistOnReceive } from '../verifyOnReceive';
import { BSV21_PROTOCOL_ID } from '../bsv21/constants';
import { BSV21_BASKET } from '../../../constants/baskets';
import type {
  TokenSettlementAdapter, TokenSourceRef, TokenSettlementArtifact,
  TokenAdapterContext, TokenBuildResult, TokenAcceptResult,
} from './tokenSettlementTypes';

const ORIGINATOR = 'admin.bsv21-peer';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type Bsv21AdapterDeps = BSV21TransferDeps;

export class Bsv21TokenSettlementAdapter implements TokenSettlementAdapter {
  readonly protocol = 'bsv-21';
  private readonly wallet: WalletInterface;
  private readonly chain: 'main' | 'test';

  constructor(private readonly deps: Bsv21AdapterDeps) {
    this.wallet = deps.wallet;
    this.chain = deps.chain;
  }

  /** BRC-29-style derivation so the recipient can reconstruct the owner key. */
  private async deriveRecipientAddress(
    recipient: string,
    derivationPrefix: string,
    derivationSuffix: string
  ): Promise<string> {
    const { publicKey } = await this.wallet.getPublicKey(
      {
        protocolID: BSV21_PROTOCOL_ID as any,
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
    try {
      const derivationPrefix = await createNonce(this.wallet, 'self', ctx.originator);
      const derivationSuffix = await createNonce(this.wallet, 'self', ctx.originator);
      const recipientAddress = await this.deriveRecipientAddress(recipient, derivationPrefix, derivationSuffix);

      // Dry run: prove derivation + validation only — never touch the chain.
      if (ctx.dryRun) {
        ctx.logger?.log(`[bsv-21 dry-run] would transfer ${amount} to ${recipientAddress}`);
        return {
          action: 'settle',
          artifact: {
            customInstructions: { derivationPrefix, derivationSuffix },
            transaction: [],
            protocol: 'bsv-21',
            assetId: source.assetId,
            amount,
            outputIndex: 0,
          },
        };
      }

      const transfer = new BSV21TransferService(this.deps);
      const res = await transfer.transfer({
        source: {
          txid: source.txid,
          vout: source.outputIndex,
          scriptHex: source.lockingScriptHex,
          satoshis: source.satoshis,
          brc42KeyId: source.brc42KeyId ?? 'recv 0',
          tokenId: source.assetId,
          amt: String(source.amt ?? amount),
          dec: source.dec as number | undefined,
          sym: source.sym as string | undefined,
          icon: source.icon as string | undefined,
          owner: source.owner,
        },
        amount,
        recipientAddress,
      });
      if (!res.ok || res.txid == null) {
        return { action: 'terminate', termination: { code: 'bsv21.transfer_failed', message: res.reason ?? 'transfer failed' } };
      }

      const transaction = (res.beef && res.beef.length > 0)
        ? res.beef
        : (await buildChainedAtomicBeef({ wallet: this.wallet, txid: res.txid })).atomicBeef;

      return {
        action: 'settle',
        artifact: {
          customInstructions: { derivationPrefix, derivationSuffix },
          transaction,
          protocol: 'bsv-21',
          assetId: source.assetId,
          amount,
          outputIndex: 0, // recipient BSV-21 output is built first
          txid: res.txid,
        },
      };
    } catch (err) {
      return { action: 'terminate', termination: { code: 'bsv21.build_error', message: errMsg(err) } };
    }
  }

  async acceptTokenSettlement(
    args: { sender: string; settlement: TokenSettlementArtifact },
    _ctx: TokenAdapterContext
  ): Promise<TokenAcceptResult> {
    const { sender, settlement } = args;
    try {
      // Parse the received inscription from the delivered BEEF so the holding
      // displays with its amount/symbol (BSV-21 holdings are read from the
      // basket tags, unlike STAS/DSTAS which use the satellite tables).
      let amt = settlement.amount;
      let dec: number | undefined;
      let sym: string | undefined;
      let icon: string | undefined;
      try {
        const beef = Beef.fromBinary(settlement.transaction);
        const txid = (beef as any).atomicTxid as string | undefined
          ?? (beef as any).txs?.[(beef as any).txs.length - 1]?.txid;
        const btx = txid != null ? beef.findTxid(txid) : undefined;
        const out = btx?.tx?.outputs[settlement.outputIndex];
        const parsed = out != null ? parseBsv21LockingScript(out.lockingScript.toHex()) : null;
        if (parsed != null) { amt = parsed.amt; dec = parsed.dec; sym = parsed.sym; icon = parsed.icon; }
      } catch { /* fall back to settlement.amount */ }

      // Store the BRC-29 owner derivation so the received token is re-spendable
      // (the holdings loader decodes scheme:'brc29' into a source.owner override
      // with counterparty = sender, forSelf:true).
      const customInstructions = JSON.stringify({
        scheme: 'brc29',
        kind: 'bsv-21',
        tokenId: settlement.assetId,
        derivationPrefix: settlement.customInstructions.derivationPrefix,
        derivationSuffix: settlement.customInstructions.derivationSuffix,
        senderIdentityKey: sender,
      });

      const tags = ['bsv21', 'peer', `id:${settlement.assetId}`, `amt:${amt}`];
      if (dec !== undefined) tags.push(`dec:${dec}`);
      if (sym !== undefined) tags.push(`sym:${sym}`);
      if (icon !== undefined) tags.push(`icon:${icon}`);

      const internalizeResult = await this.wallet.internalizeAction(
        {
          tx: settlement.transaction,
          outputs: [
            {
              outputIndex: settlement.outputIndex,
              protocol: 'basket insertion',
              insertionRemittance: {
                basket: BSV21_BASKET,
                customInstructions,
                tags,
              },
            },
          ],
          description: 'BSV-21 peer receive',
          seekPermission: false,
        } as any,
        ORIGINATOR
      );

      // Verify provenance on receive. This peer path internalizes directly
      // (bypassing BSV21Registration), so it needs its own hook. Fire-and-forget.
      try {
        const beef = Beef.fromBinary(settlement.transaction);
        const txid = (beef as any).atomicTxid as string | undefined
          ?? (beef as any).txs?.[(beef as any).txs.length - 1]?.txid;
        if (txid) {
          verifyAndPersistOnReceive(this.deps.identityKey, this.chain, {
            txid,
            vout: settlement.outputIndex,
            protocol: 'bsv-21',
          });
        }
      } catch { /* best-effort — the Assets load-time pass is the backstop */ }

      return { action: 'accept', receiptData: { internalizeResult } };
    } catch (err) {
      return { action: 'terminate', termination: { code: 'bsv21.internalize_failed', message: errMsg(err) } };
    }
  }
}
