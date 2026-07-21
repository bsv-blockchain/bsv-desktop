/**
 * StasTransferService — STAS transfer via createAction + signAction.
 *
 * The STAS engine assumes exactly 2 outputs in the transfer tx:
 *   vout 0 = new STAS to recipient
 *   vout 1 = BSV change back to funder
 *
 * wallet-toolbox's `generateChange` normally adds fragmentation outputs to
 * top up the change basket toward `numberOfDesiredUTXOs` (default 144). To
 * keep the tx at exactly 2 outputs, we LOWER the basket target to 0 before
 * createAction (with `randomizeOutputs: false`), then restore it afterward.
 * This goes through the ACTIVE storage provider (see `walletChangeParams`), so
 * it works on remote storage too — a prior local-only IPC write silently
 * no-op'd on remote and was the cause of STAS/DSTAS sends failing there.
 *
 * Signing:
 *   - STAS input (our outpoint): externally via `wallet.createSignature` with
 *     the BRC-42 derivation that owns the STAS.
 *   - BSV input (wallet-owned): the wallet signs it internally during signAction.
 */

import type { WalletInterface } from '@bsv/sdk';
import { Beef } from '@bsv/sdk';
import { STAS_PROTOCOL_ID, STAS_COUNTERPARTY } from './constants';
import { STAS_BASKET } from '../../constants/baskets';
import { stasQuery } from './stasIpc';
import { setChangeParams, DEFAULT_DESIRED_UTXOS, DEFAULT_MIN_UTXO_VALUE } from './walletChangeParams';
import { buildChainedAtomicBeef } from './buildChainedAtomicBeef';
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

    // 4. Build inputBEEF (Services + WoC fallback).
    let inputBEEF: number[];
    try {
      const built = await buildChainedAtomicBeef({ wallet: this.wallet, txid: source.txid });
      inputBEEF = built.beef;
    } catch (err) {
      return { ok: false, reason: `inputBEEF assembly: ${errMsg(err)}` };
    }

    // 5. Flip STAS outputs.spendable=true so createAction will accept it.
    try {
      const outputId: number | null = await stasQuery(
        this.identityKey,
        this.chain,
        'findOutputIdByOutpoint',
        [source.txid, source.vout]
      );
      if (outputId) {
        await stasQuery(this.identityKey, this.chain, 'setOutputSpendable', [outputId, true]);
      }
    } catch {
      /* best effort */
    }

    // 6. Suppress change fragmentation so the tx keeps exactly one BSV change
    //    output. Routes through the ACTIVE store (works local AND remote); a
    //    failure here would otherwise surface as a cryptic script-eval error,
    //    so fail clean with an actionable reason.
    try {
      await setChangeParams(this.wallet, 0, DEFAULT_MIN_UTXO_VALUE, ORIGINATOR);
    } catch (err) {
      return {
        ok: false,
        reason:
          `could not suppress change fragmentation (setWalletChangeParams): ${errMsg(err)}. ` +
          'Without it the funding change splits into multiple outputs and the STAS engine rejects the transfer.',
      };
    }

    // From here, restore the change-pool target on every exit path (best-effort).
    const restoreBasket = async () => {
      try {
        await setChangeParams(this.wallet, DEFAULT_DESIRED_UTXOS, DEFAULT_MIN_UTXO_VALUE, ORIGINATOR);
      } catch {
        /* best effort */
      }
    };

    try {
      // 7. createAction. Wallet auto-funds (1 BSV input from default basket)
      //    + 1 change output (target=0 + balancing).
      let createRes: any;
      try {
        createRes = await this.wallet.createAction(
          {
            labels: ['peertoken'],
            inputBEEF,
            inputs: [
              {
                outpoint: `${source.txid}.${source.vout}`,
                unlockingScriptLength: 4500,
                inputDescription: 'STAS being transferred',
              },
            ],
            outputs: [
              {
                lockingScript: newStasScriptHex,
                satoshis: sendAmt,
                outputDescription: 'STAS to recipient',
              },
              ...(changeStasScriptHex != null
                ? [{
                    lockingScript: changeStasScriptHex,
                    satoshis: changeAmt,
                    outputDescription: 'STAS token change',
                    // Declare the basket at creation so the wallet tracks this
                    // self-owned output natively (mirrors BSV-21 token-change);
                    // the satellite linkage then finds its output row.
                    basket: STAS_BASKET,
                    customInstructions: JSON.stringify({
                      brc42KeyId: args.senderChangeKeyId,
                      tokenId: args.tokenId,
                    }),
                    tags: ['stas'],
                  }]
                : []),
            ],
            description: 'STAS transfer',
            options: {
              // Note: acceptDelayedBroadcast not set to false here, otherwise
              // the wallet errors with "Undelayed createAction or signAction
              // results require review" when prior failed attempts are queued.
              // Let the wallet queue + monitor worker handle broadcast.
              randomizeOutputs: false,
            },
          } as any,
          ORIGINATOR
        );
      } catch (err) {
        return { ok: false, reason: `createAction: ${errMsg(err)}` };
      }

      const signable = createRes?.signableTransaction;
      if (!signable || !signable.tx) {
        return { ok: false, reason: 'createAction did not return signableTransaction' };
      }

      // 8. Parse signable.tx (AtomicBEEF) → extract atomic tx → bsv-js Transaction.
      let tx: any;
      try {
        const beef = Beef.fromBinary(signable.tx);
        const atomicTxid = (beef as any).atomicTxid as string | undefined;
        if (!atomicTxid) {
          return { ok: false, reason: 'signable BEEF has no atomic txid' };
        }
        const btx = beef.findTxid(atomicTxid);
        if (!btx?.tx) {
          return { ok: false, reason: `signable BEEF missing atomic tx ${atomicTxid}` };
        }
        const rawTxBytes = btx.tx.toBinary();
        tx = new bsv.Transaction(Buffer.from(rawTxBytes).toString('hex'));
        tx.inputs[0].output = new bsv.Transaction.Output({
          script: bsv.Script.fromHex(source.scriptHex),
          satoshis: source.satoshis,
        });
      } catch (err) {
        return { ok: false, reason: `parse signable tx: ${errMsg(err)}` };
      }

      tokenLog.debug('[stas-transfer] tx.inputs.length=', tx.inputs.length);
      for (let i = 0; i < tx.inputs.length; i++) {
        const inp = tx.inputs[i];
        const prevTxidHex =
          typeof inp.prevTxId === 'string'
            ? inp.prevTxId
            : Buffer.from(inp.prevTxId).toString('hex');
        const tag = i === 0 ? '(STAS)' : i === tx.inputs.length - 1 ? '(funding-last)' : '(extra)';
        tokenLog.debug(`  in ${i} ${tag}: ${prevTxidHex.substring(0, 16)}…:${inp.outputIndex}`);
      }
      tokenLog.debug('[stas-transfer] outputs.length=', tx.outputs.length);
      for (let v = 0; v < tx.outputs.length; v++) {
        tokenLog.debug(`  out ${v}: ${tx.outputs[v].satoshis} sats, len=${tx.outputs[v].script.toHex().length / 2}`);
      }

      // The classic STAS engine encodes exactly ONE funding outpoint into the
      // unlock witness (input 0 is the STAS being spent; the funding input is
      // the wallet's BSV). If the default basket only holds fragments smaller
      // than the fee, wallet-toolbox combines several — which the engine can't
      // accept, and you get a cryptic "OP_EQUALVERIFY required equal" deep in
      // script eval. Fail clean with actionable guidance instead. (Mirrors the
      // DSTAS check in DstasTransferService.)
      const fundingInputCount = tx.inputs.length - 1;
      if (fundingInputCount < 1) {
        return { ok: false, reason: 'no BSV funding input found in the assembled tx' };
      }
      if (fundingInputCount > 1) {
        return {
          ok: false,
          reason:
            `STAS transfer requires exactly one BSV funding input, but the wallet ` +
            `combined ${fundingInputCount} from the default basket — your BSV is ` +
            `fragmented into amounts smaller than the fee. Consolidate by sending a ` +
            `small BSV payment to yourself (or top up with one larger UTXO of a few ` +
            `thousand sats), then retry the send.`,
        };
      }

      // 9. Payment segment = the wallet's added change output (now at vout 1).
      let paymentSegment: { satoshis: number; publicKey: string } | null = null;
      for (let v = 1; v < tx.outputs.length; v++) {
        const sHex = tx.outputs[v].script.toHex();
        if (sHex.startsWith('76a914') && sHex.endsWith('88ac') && sHex.length === 50) {
          paymentSegment = { satoshis: tx.outputs[v].satoshis, publicKey: sHex.substring(6, 46) };
          break;
        }
      }

      // 10. partialSTASUnlockingScript fills tx.inputs[0].script with engine push-data.
      try {
        partialSTASUnlockingScript(
          tx,
          [
            { satoshis: sendAmt, publicKey: recipientPkhHex },
            changeStasScriptHex != null && args.senderChangeHash160
              ? { satoshis: changeAmt, publicKey: args.senderChangeHash160 }
              : null,
            paymentSegment,
          ],
          stasVersion,
          paymentSegment === null
        );
      } catch (err) {
        return { ok: false, reason: `partial unlocking: ${errMsg(err)}` };
      }

      // 11. Sighash for input 0 + sign via wallet.createSignature.
      let sigHex: string;
      try {
        const sourceLocking = bsv.Script.fromHex(source.scriptHex);
        const satsBN = new bsv.crypto.BN(source.satoshis);
        const preimage = bsv.Transaction.sighash.sighashPreimage(
          tx, SIGHASH, 0, sourceLocking, satsBN
        );
        const digestBuf = bsv.crypto.Hash.sha256sha256(preimage);
        const digestBytes = Array.from(digestBuf as Buffer) as number[];

        const sigRes = await this.wallet.createSignature(
          {
            protocolID: ownerDerivation.protocolID,
            keyID: ownerDerivation.keyID,
            counterparty: ownerDerivation.counterparty,
            hashToDirectlySign: digestBytes,
          } as any,
          ORIGINATOR
        );
        sigHex = toHex(sigRes.signature) + SIGHASH.toString(16).padStart(2, '0');
      } catch (err) {
        return { ok: false, reason: `sighash/sign: ${errMsg(err)}` };
      }

      // 12. Final unlocking script.
      let unlockingScriptHex: string;
      try {
        const partialASM = tx.inputs[0].script.toASM();
        const finalASM = `${partialASM} ${sigHex} ${ownerPubKey.toString('hex')}`;
        unlockingScriptHex = bsv.Script.fromASM(finalASM).toHex();
      } catch (err) {
        return { ok: false, reason: `unlocking assembly: ${errMsg(err)}` };
      }

      // 13. signAction. No acceptDelayedBroadcast override — the wallet
      //     queues and the monitor worker broadcasts asynchronously. The
      //     monitor's TaskSendWaiting handles relay + retry + WoC fallback.
      let signResp: any;
      try {
        signResp = await this.wallet.signAction(
          {
            reference: signable.reference,
            spends: { 0: { unlockingScript: unlockingScriptHex } },
          } as any,
          ORIGINATOR
        );
      } catch (err) {
        return { ok: false, reason: `signAction: ${errMsg(err)}` };
      }

      tokenLog.debug('[stas-transfer] signAction result:', signResp);

      // signAction returns txid as soon as the tx is finalized, regardless of
      // whether broadcast succeeded. Inspect sendWithResults to see if any
      // input/output was rejected by mAPI. Surface real broadcast failures.
      const sendResults: any[] = Array.isArray(signResp?.sendWithResults)
        ? signResp.sendWithResults
        : [];
      const failed = sendResults.find((r) => r?.status === 'failed');
      if (failed) {
        return {
          ok: false,
          reason: `broadcast failed: ${JSON.stringify(failed)} (txid was ${signResp?.txid})`,
        };
      }

      const wocBase = this.chain === 'main' ? 'https://whatsonchain.com/tx/' : 'https://test.whatsonchain.com/tx/';
      tokenLog.info(`[stas-transfer] BROADCAST ✓ txid: ${signResp?.txid}  ${wocBase}${signResp?.txid}`);

      // 14. Link the sender's token-change output (vout 1 — outputs are not
      //     randomized) into the satellite tables. The Assets view reads STAS
      //     holdings from `listStasOutputs`, NOT from the basket, so without
      //     this the remainder of a partial send stays invisible until a
      //     discovery scan happens to pick it back up off the chain — even
      //     though we minted the output ourselves and know everything about it.
      //     `skipInternalize` because createAction already declared its basket.
      //     Idempotent, so a caller that registers the change itself (the peer
      //     settlement adapter does) simply gets 'already registered'.
      if (changeStasScriptHex != null && args.senderChangeHash160 && signResp?.txid) {
        try {
          const meta = parseClassicStasMetadata(source.scriptHex);
          const r = await new StasRegistration(this.wallet, this.identityKey, this.chain).register({
            txid: signResp.txid,
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
            skipInternalize: true,
          });
          if (!r.registered && r.reason !== 'already registered') {
            tokenLog.warn(`[stas-transfer] token-change NOT registered: ${r.reason} (scan will recover)`);
          }
        } catch (err) {
          // Best-effort: the output exists on-chain and in the basket either
          // way, and a scan re-registers it. Never fail a broadcast tx here.
          tokenLog.warn(`[stas-transfer] token-change registration threw: ${errMsg(err)} (scan will recover)`);
        }
      }

      return { ok: true, txid: signResp?.txid, beef: signResp?.tx };
    } finally {
      await restoreBasket();
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toHex(bytes: number[] | Uint8Array): string {
  const arr = Array.isArray(bytes) ? bytes : Array.from(bytes);
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}
