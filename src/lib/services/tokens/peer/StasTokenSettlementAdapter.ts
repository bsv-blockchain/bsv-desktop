/**
 * StasTokenSettlementAdapter — concrete TokenSettlementAdapter for classic STAS.
 *
 * Plugs into `PeerTokenClient` (from @bsv/message-box-client) to move classic
 * STAS tokens peer-to-peer over MessageBox, the token analog of PeerPay's
 * BRC-29 settlement. It composes the wallet's existing building blocks:
 *   - owner-field derivation (BRC-29 style, so the recipient can reconstruct
 *     the key) via wallet.getPublicKey;
 *   - StasTransferService.transfer to build + sign + broadcast the transfer;
 *   - buildChainedAtomicBeef to package the signed tx for the recipient;
 *   - wallet.internalizeAction (basket insertion) on accept, recording the
 *     BRC-29 derivation so the received token stays re-spendable.
 *
 * The TokenSettlementAdapter interface is mirrored locally until
 * @bsv/message-box-client publishes it; the shape is structurally identical, so
 * this class is assignable to the published interface after the version bump.
 */
import type { WalletInterface } from '@bsv/sdk';
import { Hash, Utils, createNonce, Beef } from '@bsv/sdk';
import { StasTransferService } from '../../stas/StasTransferService';
import { StasKeyDeriver } from '../../stas/StasKeyDeriver';
import { buildChainedAtomicBeef } from '../../stas/buildChainedAtomicBeef';
import { StasRegistration } from '../../stas/StasRegistration';
import { parseClassicStasMetadata } from '../../stas/parseClassicStasMetadata';
import { encodeBrc29KeyId } from './brc29KeyId';
import { STAS_PROTOCOL_ID } from '../../stas/constants';
import { STAS_BASKET } from '../../../constants/baskets';
import type {
  TokenSettlementAdapter, TokenSourceRef, TokenSettlementArtifact,
  TokenAdapterContext, TokenBuildResult, TokenAcceptResult,
} from './tokenSettlementTypes';

const ORIGINATOR = 'admin.stas-peer';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class StasTokenSettlementAdapter implements TokenSettlementAdapter {
  readonly protocol = 'stas';

  constructor(
    private readonly wallet: WalletInterface,
    private readonly identityKey: string,
    private readonly chain: 'main' | 'test' | 'ttn'
  ) {}

  /**
   * Derives the recipient's STAS owner key with a BRC-29-style shared
   * derivation: the recipient can reconstruct the matching private key by
   * deriving with `counterparty = senderIdentityKey` and the same keyID.
   */
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

    // Classic STAS is satoshi-denominated; the send amount must be a positive
    // integer ≤ the UTXO value. A partial send SPLITS: recipient gets `amount`,
    // the remainder returns to the sender as token change.
    const sendAmt = Number(amount);
    if (!Number.isInteger(sendAmt) || sendAmt < 1 || sendAmt > source.satoshis) {
      return {
        action: 'terminate',
        termination: { code: 'stas.bad_amount', message: `amount must be an integer between 1 and ${source.satoshis} (got ${amount})` },
      };
    }
    const isPartial = sendAmt < source.satoshis;

    try {
      const derivationPrefix = await createNonce(this.wallet, 'self', ctx.originator);
      const derivationSuffix = await createNonce(this.wallet, 'self', ctx.originator);
      const recipientAddress = await this.deriveRecipientAddress(recipient, derivationPrefix, derivationSuffix);

      // Dry run: prove derivation + validation only — never touch the chain.
      if (ctx.dryRun) {
        ctx.logger?.log(`[stas dry-run] would transfer ${amount}${isPartial ? ` (split, change ${source.satoshis - sendAmt})` : ''} to ${recipientAddress}`);
        return {
          action: 'settle',
          artifact: {
            customInstructions: { derivationPrefix, derivationSuffix },
            transaction: [],
            protocol: 'stas',
            assetId: source.assetId,
            amount,
            outputIndex: 0,
          },
        };
      }

      // For a partial send, derive a self-owned STAS receive key for the token
      // change so the sender keeps (and can see/re-spend) the remainder.
      let senderChange: { ownerFieldHash160: string; keyId: string } | undefined;
      if (isPartial) {
        const ctxRow = await new StasKeyDeriver(this.wallet, this.identityKey, this.chain).createNextReceiveContext();
        senderChange = { ownerFieldHash160: ctxRow.ownerFieldHash160, keyId: ctxRow.keyId };
      }

      const transfer = new StasTransferService(this.wallet, this.identityKey, this.chain);
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
        return { action: 'terminate', termination: { code: 'stas.transfer_failed', message: res.reason ?? 'transfer failed' } };
      }

      // Register the sender's token-change output (vout 1) into the satellite
      // tables so the remaining balance shows immediately. Best-effort: the
      // discovery scan would also find it. The change is self-owned, so it
      // registers with the normal recv key (no BRC-29 override).
      if (isPartial && senderChange) {
        try {
          const meta = parseClassicStasMetadata(source.lockingScriptHex);
          await new StasRegistration(this.wallet, this.identityKey, this.chain).register({
            txid: res.txid,
            vout: 1,
            tokenSatoshis: source.satoshis - sendAmt,
            ownerFieldHash160: senderChange.ownerFieldHash160,
            brc42KeyId: senderChange.keyId,
            parsed: {
              tokenId: source.assetId,
              ownerFieldHash160: senderChange.ownerFieldHash160,
              symbol: meta?.symbol ?? undefined,
              flagsHex: meta?.flagsHex ?? '',
              serviceFields: [], optionalData: [],
              freezeEnabled: false, confiscationEnabled: false, frozen: false, actionData: {},
            } as any,
            protocol: { id: 'stas', basketName: STAS_BASKET },
            // The change output's basket was declared at createAction time, so
            // its wallet output row already exists — only link the satellite
            // tables (internalizing our own output again would conflict).
            skipInternalize: true,
          }).then((r) => {
            if (r.registered || r.reason === 'already registered') {
              ctx.logger?.log?.(`[stas] registered sender token-change (vout 1, ${source.satoshis - sendAmt})`);
            } else {
              ctx.logger?.warn?.(`[stas] sender token-change NOT registered: ${r.reason}`);
            }
          });
        } catch (e) {
          ctx.logger?.warn?.(`[stas] sender token-change registration failed (scan will recover): ${String(e)}`);
        }
      }

      // Prefer the signed AtomicBEEF the wallet already returned (no re-fetch
      // race); fall back to assembling a chained BEEF if it wasn't surfaced.
      const transaction = (res.beef && res.beef.length > 0)
        ? res.beef
        : (await buildChainedAtomicBeef({ wallet: this.wallet, txid: res.txid })).atomicBeef;

      return {
        action: 'settle',
        artifact: {
          customInstructions: { derivationPrefix, derivationSuffix },
          transaction,
          protocol: 'stas',
          assetId: source.assetId,
          amount,
          outputIndex: 0, // STAS engine places the recipient output at vout 0
          txid: res.txid,
        },
      };
    } catch (err) {
      return { action: 'terminate', termination: { code: 'stas.build_error', message: errMsg(err) } };
    }
  }

  async acceptTokenSettlement(
    args: { sender: string; settlement: TokenSettlementArtifact },
    _ctx: TokenAdapterContext
  ): Promise<TokenAcceptResult> {
    const { sender, settlement } = args;
    try {
      // 1. Recover the received output (txid, vout, script) from the delivered
      //    AtomicBEEF so we can register it exactly like discovery does — which
      //    is what makes it show up in the Assets view (STAS holdings are read
      //    from the satellite tables, not the raw basket).
      const beef = Beef.fromBinary(settlement.transaction);
      const txid = (beef as any).atomicTxid as string | undefined
        ?? (beef as any).txs?.[(beef as any).txs.length - 1]?.txid;
      if (txid == null) throw new Error('delivered BEEF has no atomic txid');
      const btx = beef.findTxid(txid);
      if (btx?.tx == null) throw new Error(`delivered BEEF missing tx ${txid}`);
      const out = btx.tx.outputs[settlement.outputIndex];
      if (out == null) throw new Error(`tx ${txid} has no output ${settlement.outputIndex}`);
      const scriptHex = out.lockingScript.toHex();
      const meta = parseClassicStasMetadata(scriptHex);
      if (meta == null) throw new Error('received output is not classic STAS');

      // 2. Pack the BRC-29 owner derivation into the brc42KeyId field so the
      //    received token is re-spendable (keyID "<prefix> <suffix>",
      //    counterparty = sender). The holdings loader decodes this back.
      const brc42KeyId = encodeBrc29KeyId({
        derivationPrefix: settlement.customInstructions.derivationPrefix,
        derivationSuffix: settlement.customInstructions.derivationSuffix,
        senderIdentityKey: sender,
      });

      // 3. Register via the same path discovery uses — internalize (with the
      //    delivered BEEF, no re-fetch) + satellite-table linkage + spendable.
      const reg = new StasRegistration(this.wallet, this.identityKey, this.chain);
      const result = await reg.register({
        txid,
        vout: settlement.outputIndex,
        tokenSatoshis: out.satoshis ?? Number(settlement.amount),
        ownerFieldHash160: meta.ownerFieldHash160,
        brc42KeyId,
        parsed: {
          tokenId: settlement.assetId,
          ownerFieldHash160: meta.ownerFieldHash160,
          symbol: meta.symbol ?? undefined,
          flagsHex: meta.flagsHex ?? '',
          serviceFields: [],
          optionalData: [],
          freezeEnabled: false,
          confiscationEnabled: false,
          frozen: false,
          actionData: {},
        } as any,
        protocol: { id: 'stas', basketName: STAS_BASKET },
        atomicBeef: settlement.transaction,
      });
      if (!result.registered && result.reason !== 'already registered') {
        return { action: 'terminate', termination: { code: 'stas.register_failed', message: result.reason ?? 'register failed' } };
      }

      return { action: 'accept', receiptData: { internalizeResult: result } };
    } catch (err) {
      return { action: 'terminate', termination: { code: 'stas.internalize_failed', message: errMsg(err) } };
    }
  }
}
