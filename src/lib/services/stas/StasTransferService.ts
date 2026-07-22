/**
 * StasTransferService — STAS transfer via a storage-agnostic 2-transaction flow.
 *
 * Token tx (TX2) output layout:
 *   vout 0 = new STAS to recipient
 *   vout 1 = (partial send) STAS token-change back to the sender
 *   last   = one BSV P2PKH change output
 *
 * The STAS engine requires exactly ONE BSV change output, but wallet-toolbox's
 * `createAction` auto-funds and fragments change server-side on remote storage
 * (building a pool toward `numberOfDesiredUTXOs`). So we remove the token tx from
 * the wallet's change operations entirely (see services/tokens/twoTx/):
 *   TX1 — a dedicated self-owned BRC-29 funding output sized to TX2's fee.
 *   TX2 — [token, funding] → the outputs above; assembled + signed here, then
 *         broadcast + change-internalized via the twoTx helpers.
 * No auto-funding ⇒ no server-side change fragmentation ⇒ works on local AND
 * remote storage.
 *
 * Signing:
 *   - STAS input: externally via `wallet.createSignature` with the BRC-42
 *     derivation that owns the STAS.
 *   - Funding input: `signP2pkhInput` (BRC-29 self-owned P2PKH).
 */

import type { WalletInterface } from '@bsv/sdk';
import { Beef, Transaction } from '@bsv/sdk';
import { STAS_PROTOCOL_ID, STAS_COUNTERPARTY } from './constants';
import { STAS_BASKET } from '../../constants/baskets';
import { buildChainedAtomicBeef } from './buildChainedAtomicBeef';
import { createTokenFundingOutput } from '../tokens/twoTx/fundingOutput';
import { deriveSelfBrc29P2pkh } from '../tokens/twoTx/brc29Address';
import { signP2pkhInput } from '../tokens/twoTx/p2pkhInput';
import { broadcastAndInternalizeChange } from '../tokens/twoTx/internalizeChange';
import { StasRegistration } from './StasRegistration';
import { parseClassicStasMetadata } from './parseClassicStasMetadata';
import { tokenLog } from '../tokens/tokenLog';

async function loadStasDeps(): Promise<{
  bsv: any;
  stasInternals: any;
  SIGHASH: number;
}> {
  const bsvMod: any = await import('bsv');
  const bsv = bsvMod.default ?? bsvMod;
  const stasInternalsMod: any = await import('stas-js/lib/stas.js');
  const stasInternals = stasInternalsMod.default ?? stasInternalsMod;
  return { bsv, stasInternals, SIGHASH: stasInternals.sighash };
}

const ORIGINATOR = 'admin.stas-transfer';

export interface StasTransferArgs {
  source: {
    txid: string;
    vout: number;
    scriptHex: string;
    satoshis: number;
    brc42KeyId: string;
    /**
     * Optional owner-key derivation override for signing the STAS input.
     * Defaults to the self-owned scheme (protocolID STAS_PROTOCOL_ID,
     * keyID `brc42KeyId`, counterparty 'self'). A token received over a
     * peer channel (BRC-29) is owned under a derivation keyed to the SENDER,
     * so re-spending it requires `keyID = "<prefix> <suffix>"` and
     * `counterparty = senderIdentityKey`. Supplying this makes such tokens
     * spendable without changing the default self-custody path.
     */
    owner?: {
      protocolID?: [number, string];
      keyID: string;
      counterparty: string;
      /** True for a BRC-29-received token: derive the recipient's OWN key. */
      forSelf?: boolean;
    };
  };
  recipientAddress: string;
  /**
   * Token amount (satoshis) to send to the recipient. Defaults to the full
   * `source.satoshis` (1-to-1 transfer). When less than the full value, the
   * service performs a SPLIT: a recipient STAS output of `amount` plus a
   * sender token-change STAS output of the remainder (to `senderChangeHash160`).
   */
  amount?: number;
  /**
   * Owner pkh (hex) for the sender's token-change STAS output. Required when
   * `amount` < `source.satoshis`. Derived from the sender's own STAS receive
   * key so the change is self-custodied and re-discoverable.
   */
  senderChangeHash160?: string;
  /**
   * BRC-42 keyId of the sender's token-change receive key. Declared in the
   * change output's customInstructions so the wallet tracks the output at
   * creation time (mirrors BSV-21 token-change), which is what lets the
   * satellite linkage find its output row.
   */
  senderChangeKeyId?: string;
  /** Token id for the change output's customInstructions (display/tracking). */
  tokenId?: string;
}

export interface StasTransferResult {
  ok: boolean;
  txid?: string;
  reason?: string;
  /** Signed AtomicBEEF of the transfer (from signAction) — for peer delivery. */
  beef?: number[];
}

export class StasTransferService {
  constructor(
    private readonly wallet: WalletInterface,
    private readonly identityKey: string,
    private readonly chain: 'main' | 'test'
  ) {}

  async transfer(args: StasTransferArgs): Promise<StasTransferResult> {
    const { source, recipientAddress } = args;

    let bsv: any, stasInternals: any, SIGHASH: number;
    try {
      ({ bsv, stasInternals, SIGHASH } = await loadStasDeps());
    } catch (err) {
      return { ok: false, reason: `load stas-js/bsv failed: ${errMsg(err)}` };
    }

    const { updateStasScript, partialSTASUnlockingScript, getVersion } = stasInternals;

    // Effective owner-key derivation. Defaults to the self-owned scheme; a
    // BRC-29 peer-received token overrides keyID + counterparty so it stays
    // spendable.
    const ownerDerivation = {
      protocolID: (source.owner?.protocolID ?? STAS_PROTOCOL_ID) as any,
      keyID: source.owner?.keyID ?? source.brc42KeyId,
      counterparty: (source.owner?.counterparty ?? STAS_COUNTERPARTY) as any,
      // BRC-29-received tokens are owned by OUR key in the shared derivation —
      // derive the pubkey with forSelf:true so it matches the on-chain owner.
      forSelf: source.owner?.forSelf === true,
    };

    // 1. Owner pubkey via BRC-42 derivation.
    let ownerPubKey: any;
    try {
      const { publicKey } = await this.wallet.getPublicKey(
        {
          protocolID: ownerDerivation.protocolID,
          keyID: ownerDerivation.keyID,
          counterparty: ownerDerivation.counterparty,
          forSelf: ownerDerivation.forSelf,
        } as any,
        ORIGINATOR
      );
      ownerPubKey = bsv.PublicKey.fromString(publicKey);
    } catch (err) {
      return { ok: false, reason: `getPublicKey: ${errMsg(err)}` };
    }

    // Diagnostic: does our signing key actually own this UTXO? Compare the
    // hash160 of the derived owner pubkey to the owner pkh baked in the source
    // script (76a914 <owner:20> …). A mismatch = wrong brc42KeyId/counterparty.
    try {
      const derivedOwnerPkh = bsv.crypto.Hash.sha256ripemd160(ownerPubKey.toBuffer()).toString('hex');
      const sourceOwnerPkh = source.scriptHex.substring(6, 46);
      tokenLog.debug('[stas-transfer] OWNER CHECK — keyID:', ownerDerivation.keyID,
        'counterparty:', ownerDerivation.counterparty,
        '| derived pkh:', derivedOwnerPkh, '| source owner pkh:', sourceOwnerPkh,
        '| MATCH:', derivedOwnerPkh === sourceOwnerPkh);
    } catch { /* never block on diagnostics */ }

    // 2. Recipient hash160.
    let recipientPkhHex: string;
    try {
      const addr = bsv.Address.fromString(recipientAddress);
      recipientPkhHex = addr.hashBuffer.toString('hex');
    } catch (err) {
      return { ok: false, reason: `invalid recipient: ${errMsg(err)}` };
    }

    // 3. Validate the source is a classic STAS shape. stas-js's updateStasScript
    //    enforces this internally, but its error message ("Invalid STAS script")
    //    doesn't tell the caller *why*. Pre-check so the failure mode is
    //    actionable — most often the user picked a DSTAS UTXO (different
    //    engine), or the lockingScript wasn't surfaced by listStasOutputs.
    const sh = source.scriptHex;
    if (typeof sh !== 'string' || sh.length < 56) {
      return {
        ok: false,
        reason: `source.scriptHex missing or too short (type=${typeof sh}, length=${sh?.length ?? 0})`,
      };
    }
    if (!sh.startsWith('76a914')) {
      return {
        ok: false,
        reason: `source isn't a classic STAS script — prefix is "${sh.substring(0, 20)}…". For DSTAS UTXOs the dispatch should route via DstasTransferService — if you reached this branch, the protocol-aware dispatch upstream is bypassed.`,
      };
    }
    if (sh.substring(46, 52) !== '88ac69') {
      return {
        ok: false,
        reason: `source isn't a classic STAS script — engine marker missing at offset 46 (got "${sh.substring(46, 52)}", expected "88ac69")`,
      };
    }

    // 3b. Resolve send amount vs. token-change (SPLIT). Full-value send keeps
    //     the original 1-output path byte-for-byte; a partial send adds a
    //     second STAS output carrying the remainder back to the sender.
    const sendAmt = args.amount ?? source.satoshis;
    const changeAmt = source.satoshis - sendAmt;
    if (!Number.isInteger(sendAmt) || sendAmt < 1) {
      return { ok: false, reason: `invalid amount ${sendAmt} (must be a positive integer ≤ ${source.satoshis})` };
    }
    if (changeAmt < 0) {
      return { ok: false, reason: `amount ${sendAmt} exceeds the token UTXO value ${source.satoshis}` };
    }
    if (changeAmt > 0 && !args.senderChangeHash160) {
      return { ok: false, reason: 'partial transfer requires senderChangeHash160 for the token-change output' };
    }

    // 4. Build new STAS locking script(s): recipient + (optional) sender change.
    let newStasScriptHex: string;
    let changeStasScriptHex: string | null = null;
    let stasVersion: number;
    try {
      newStasScriptHex = updateStasScript(recipientPkhHex, sh);
      if (changeAmt > 0 && args.senderChangeHash160) {
        changeStasScriptHex = updateStasScript(args.senderChangeHash160, sh);
      }
      stasVersion = getVersion(sh);
    } catch (err) {
      return {
        ok: false,
        reason: `script build: ${errMsg(err)} (prefix ${sh.substring(0, 32)}…)`,
      };
    }

    // ---- diagnostic: surface the field-level expectations engine eval cares about ----
    try {
      const sourceOwnerPkh = sh.substring(6, 46);
      const newOwnerPkh = newStasScriptHex.substring(6, 46);
      const headSame = newStasScriptHex.substring(0, 6) === sh.substring(0, 6);
      const tailSame = newStasScriptHex.substring(46) === sh.substring(46);
      const lengthSame = newStasScriptHex.length === sh.length;
      tokenLog.debug('[stas-transfer] source pkh →', sourceOwnerPkh);
      tokenLog.debug('[stas-transfer] new pkh    →', newOwnerPkh, '(matches recipient:', newOwnerPkh === recipientPkhHex, ')');
      tokenLog.debug('[stas-transfer] source.satoshis =', source.satoshis);
      tokenLog.debug('[stas-transfer] stas version =', stasVersion);
      tokenLog.debug('[stas-transfer] new script invariants — length same:', lengthSame, '· head same:', headSame, '· tail same:', tailSame);
      if (!tailSame) {
        // Surface the first diverging byte if the engine/tail isn't preserved.
        const len = Math.min(newStasScriptHex.length, sh.length);
        let firstDiff = -1;
        for (let i = 46; i < len; i++) {
          if (newStasScriptHex[i] !== sh[i]) { firstDiff = i; break; }
        }
        tokenLog.debug('[stas-transfer] first diverging hex index past owner-pkh:', firstDiff,
          firstDiff >= 0 ? `(source="${sh.substring(firstDiff, firstDiff + 12)}…" new="${newStasScriptHex.substring(firstDiff, firstDiff + 12)}…")` : '');
      }
    } catch { /* never block on logging */ }

    // ===== Storage-agnostic 2-tx transfer =====================================
    // We remove this token tx from the wallet's change operations entirely: TX1
    // creates a dedicated funding output we control, TX2 spends [token, funding]
    // → [recipient, (token-change), ONE explicit BSV change] with both inputs
    // signed client-side. No auto-funding ⇒ no server-side change fragmentation,
    // so it works on local OR remote storage. See services/tokens/twoTx/.

    // 5. Token input ancestry BEEF (for TX2 SPV).
    let tokenBeef: number[];
    try {
      const built = await buildChainedAtomicBeef({ wallet: this.wallet, txid: source.txid });
      tokenBeef = built.beef;
    } catch (err) {
      return { ok: false, reason: `inputBEEF assembly: ${errMsg(err)}` };
    }

    // 6. Self-owned BRC-29 address for TX2's single BSV change output.
    let changeDeriv: { scriptHex: string; pkhHex: string; derivationPrefix: string; derivationSuffix: string };
    try {
      changeDeriv = await deriveSelfBrc29P2pkh({ wallet: this.wallet, chain: this.chain, originator: ORIGINATOR });
    } catch (err) {
      return { ok: false, reason: `change derivation: ${errMsg(err)}` };
    }

    // 7. TX1: dedicated funding output sized to TX2's fee. Over-estimate the size
    //    (STAS unlock is large) so the single change absorbs the remainder and the
    //    fee is never underpaid; over-estimating merely over-funds TX1.
    const FEE_RATE = 1; // sat/byte
    const estTx2Size =
      5500 /* STAS unlock */ + 120 /* P2PKH unlock */ + 200 /* tx overhead */ +
      Math.ceil(newStasScriptHex.length / 2) +
      (changeStasScriptHex ? Math.ceil(changeStasScriptHex.length / 2) : 0) +
      34 /* change output */;
    const tx2Fee = Math.ceil(estTx2Size * FEE_RATE);
    const fundingSats = tx2Fee + 500; // margin ⇒ change stays well above dust
    let funding: Awaited<ReturnType<typeof createTokenFundingOutput>>;
    try {
      funding = await createTokenFundingOutput({
        wallet: this.wallet, chain: this.chain, satoshis: fundingSats,
        originator: ORIGINATOR, description: 'STAS transfer funding',
      });
    } catch (err) {
      return { ok: false, reason: `TX1 funding: ${errMsg(err)}` };
    }
    const changeValue = funding.satoshis - tx2Fee;
    if (changeValue < 1) {
      return { ok: false, reason: `funding ${funding.satoshis} below estimated fee ${tx2Fee}` };
    }

    // 8. Assemble TX2: [token(0), funding(1)] → [recipient(0), (token-change), change].
    let tx: any;
    try {
      tx = new bsv.Transaction();
      tx.from({ txId: source.txid, outputIndex: source.vout, script: source.scriptHex, satoshis: source.satoshis });
      tx.from({ txId: funding.txid, outputIndex: funding.vout, script: funding.scriptHex, satoshis: funding.satoshis });
      tx.addOutput(new bsv.Transaction.Output({ script: bsv.Script.fromHex(newStasScriptHex), satoshis: sendAmt }));
      if (changeStasScriptHex != null) {
        tx.addOutput(new bsv.Transaction.Output({ script: bsv.Script.fromHex(changeStasScriptHex), satoshis: changeAmt }));
      }
      tx.addOutput(new bsv.Transaction.Output({ script: bsv.Script.fromHex(changeDeriv.scriptHex), satoshis: changeValue }));
      // Attach prev-outputs so bsv-js can compute the BIP143 sighash preimages.
      tx.inputs[0].output = new bsv.Transaction.Output({ script: bsv.Script.fromHex(source.scriptHex), satoshis: source.satoshis });
      tx.inputs[1].output = new bsv.Transaction.Output({ script: bsv.Script.fromHex(funding.scriptHex), satoshis: funding.satoshis });
    } catch (err) {
      return { ok: false, reason: `TX2 assembly: ${errMsg(err)}` };
    }
    const changeVout = tx.outputs.length - 1;

    tokenLog.debug('[stas-transfer] TX2 inputs=2 (token, funding), outputs=', tx.outputs.length, 'change=', changeValue, 'fee≈', tx2Fee);

    // 9. STAS unlock for the token input. Payment segment = the BSV change output.
    try {
      partialSTASUnlockingScript(
        tx,
        [
          { satoshis: sendAmt, publicKey: recipientPkhHex },
          changeStasScriptHex != null && args.senderChangeHash160
            ? { satoshis: changeAmt, publicKey: args.senderChangeHash160 }
            : null,
          { satoshis: changeValue, publicKey: changeDeriv.pkhHex },
        ],
        stasVersion,
        false
      );
    } catch (err) {
      return { ok: false, reason: `partial unlocking: ${errMsg(err)}` };
    }

    let tokenSigHex: string;
    try {
      const sourceLocking = bsv.Script.fromHex(source.scriptHex);
      const satsBN = new bsv.crypto.BN(source.satoshis);
      const preimage = bsv.Transaction.sighash.sighashPreimage(tx, SIGHASH, 0, sourceLocking, satsBN);
      const digestBytes = Array.from(bsv.crypto.Hash.sha256sha256(preimage) as Buffer) as number[];
      const sigRes = await this.wallet.createSignature(
        {
          protocolID: ownerDerivation.protocolID,
          keyID: ownerDerivation.keyID,
          counterparty: ownerDerivation.counterparty,
          hashToDirectlySign: digestBytes,
        } as any,
        ORIGINATOR
      );
      tokenSigHex = toHex(sigRes.signature) + SIGHASH.toString(16).padStart(2, '0');
    } catch (err) {
      return { ok: false, reason: `sighash/sign token input: ${errMsg(err)}` };
    }
    try {
      const partialASM = tx.inputs[0].script.toASM();
      tx.inputs[0].setScript(bsv.Script.fromASM(`${partialASM} ${tokenSigHex} ${ownerPubKey.toString('hex')}`));
    } catch (err) {
      return { ok: false, reason: `token unlock assembly: ${errMsg(err)}` };
    }

    // 10. Sign the funding input (P2PKH) via the two-tx helper.
    try {
      const fundingUnlock = await signP2pkhInput({
        wallet: this.wallet, bsv, tx, inputIndex: 1,
        derivationPrefix: funding.derivationPrefix, derivationSuffix: funding.derivationSuffix,
        sourceScriptHex: funding.scriptHex, sourceSatoshis: funding.satoshis,
        sighashType: SIGHASH, originator: ORIGINATOR,
      });
      tx.inputs[1].setScript(bsv.Script.fromHex(fundingUnlock));
    } catch (err) {
      return { ok: false, reason: `sign funding input: ${errMsg(err)}` };
    }

    // 11. Assemble TX2 AtomicBEEF: token ancestry + TX1's own BEEF (from
    //     createAction — it already carries TX1's full ancestry incl. any
    //     unconfirmed txs WoC can't re-serve) + TX2. Use mergeTransaction + the
    //     SDK-computed txid so toBinaryAtomic sets atomicTxid correctly (bsv-js
    //     tx.id can differ, which made validateAtomicBeef reject it).
    let tx2Txid = '';
    let tx2AtomicBeef: number[];
    try {
      const beef = Beef.fromBinary(tokenBeef);
      beef.mergeBeef(Beef.fromBinary(funding.beef));
      const sdkTx2 = Transaction.fromHex(tx.toString());
      beef.mergeTransaction(sdkTx2);
      tx2Txid = sdkTx2.id('hex');
      tx2AtomicBeef = beef.toBinaryAtomic(tx2Txid);
    } catch (err) {
      return { ok: false, reason: `TX2 BEEF assembly: ${errMsg(err)}` };
    }

    // 12. Broadcast TX2 + internalize the sender's BSV change (wallet payment).
    try {
      const r = await broadcastAndInternalizeChange({
        wallet: this.wallet, atomicBeef: tx2AtomicBeef, changeVout,
        derivationPrefix: changeDeriv.derivationPrefix, derivationSuffix: changeDeriv.derivationSuffix,
        originator: ORIGINATOR, description: 'STAS transfer', labels: ['peertoken'],
      });
      if (!r.accepted) {
        return { ok: false, reason: 'TX2 broadcast/internalize not accepted by the wallet' };
      }
    } catch (err) {
      return { ok: false, reason: `TX2 broadcast: ${errMsg(err)}` };
    }

    const wocBase = this.chain === 'main' ? 'https://whatsonchain.com/tx/' : 'https://test.whatsonchain.com/tx/';
    tokenLog.info(`[stas-transfer] BROADCAST ✓ txid: ${tx2Txid}  ${wocBase}${tx2Txid}`);

    // 13. Register the sender's token-change (partial sends) as a basket insertion.
    if (changeStasScriptHex != null && args.senderChangeHash160) {
      try {
        const meta = parseClassicStasMetadata(source.scriptHex);
        const r = await new StasRegistration(this.wallet, this.identityKey, this.chain).register({
          txid: tx2Txid,
          vout: 1,
          tokenSatoshis: changeAmt,
          ownerFieldHash160: args.senderChangeHash160,
          brc42KeyId: args.senderChangeKeyId ?? source.brc42KeyId,
          parsed: {
            tokenId: args.tokenId ?? '',
            ownerFieldHash160: args.senderChangeHash160,
            symbol: meta?.symbol ?? undefined,
            flagsHex: meta?.flagsHex ?? '',
            serviceFields: [], optionalData: [],
            freezeEnabled: false, confiscationEnabled: false, frozen: false, actionData: {},
          } as any,
          protocol: { id: 'stas', basketName: STAS_BASKET },
          atomicBeef: tx2AtomicBeef,
        } as any);
        if (!r.registered && r.reason !== 'already registered') {
          tokenLog.warn(`[stas-transfer] token-change NOT registered: ${r.reason} (scan will recover)`);
        }
      } catch (err) {
        tokenLog.warn(`[stas-transfer] token-change registration threw: ${errMsg(err)} (scan will recover)`);
      }
    }

    return { ok: true, txid: tx2Txid, beef: tx2AtomicBeef };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toHex(bytes: number[] | Uint8Array): string {
  const arr = Array.isArray(bytes) ? bytes : Array.from(bytes);
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}
