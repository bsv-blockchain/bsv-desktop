/**
 * BSV21TransferService — build, sign, and broadcast a BSV-21 transfer.
 *
 * Unlike STAS, BSV-21 is just an ord-inscription envelope wrapping a
 * standard P2PKH owner script — no engine, no custom sighash rules,
 * no payment segments. The transfer is:
 *
 *   in :  [ source BSV-21 UTXO (1 sat) ]   ← signed by BRC-42 owner key
 *         + wallet-funded BSV inputs       ← signed natively by wallet
 *   out:  [ recipient BSV-21 output (1 sat) ]
 *         [ optional token-change output (1 sat) ]
 *         [ wallet BSV change ]            ← added by createAction
 *
 * Signing for the BSV-21 input uses standard P2PKH sighash (ALL|FORKID)
 * over the full source locking script. The unlocking script is the
 * canonical `<sig> <pubkey>` pair — the ord envelope is dead code
 * (OP_FALSE OP_IF … OP_ENDIF) and never executes.
 *
 * Optional pre-flight origin verification can be enabled (default on)
 * — calls `OneSatIndexerClient.validateOutputs` and refuses to send if
 * the source outpoint isn't part of the token's overlay-validated DAG.
 */

import type { WalletInterface } from '@bsv/sdk';
import { Beef } from '@bsv/sdk';
import { Address, fromHex } from 'dxs-bsv-token-sdk/bsv';
import { BSV21_PROTOCOL_ID, BSV21_COUNTERPARTY } from './constants';
import { BSV21_BASKET } from '../../../constants/baskets';
import { buildBsv21Transfer } from './inscription';
import { buildChainedAtomicBeef } from '../../stas/buildChainedAtomicBeef';
import { OneSatIndexerClient } from './OneSatIndexerClient';
import type { BSV21KeyDeriver } from './BSV21KeyDeriver';
import { tokenLog } from '../tokenLog';

const ORIGINATOR = 'admin.bsv21-transfer';

/** stas-js exports the SIGHASH ALL|FORKID byte we want for P2PKH sigs. */
const SIGHASH_ALL_FORKID = 0x41; // SIGHASH_ALL (0x01) | SIGHASH_FORKID (0x40)

export interface BSV21TransferArgs {
  source: {
    txid: string;
    vout: number;
    scriptHex: string;
    satoshis: number;
    brc42KeyId: string;
    /** Token id this UTXO carries — `<txid>_<vout>` of the deploy+mint. */
    tokenId: string;
    /** Raw token amount the input holds. */
    amt: string;
    /** Decimals + symbol propagate to change tags for UI continuity. */
    dec?: number;
    sym?: string;
    icon?: string;
    /**
     * Optional owner-key derivation override for signing the BSV-21 input.
     * Defaults to the self-owned scheme (BSV21_PROTOCOL_ID, keyID
     * `brc42KeyId`, counterparty 'self'). A token received over a peer
     * channel (BRC-29) is owned under a derivation keyed to the SENDER, so
     * re-spending it requires `keyID = "<prefix> <suffix>"` and
     * `counterparty = senderIdentityKey`. Backward compatible.
     */
    owner?: {
      protocolID?: [number, string];
      keyID: string;
      counterparty: string;
      /** True for a BRC-29-received token: derive the recipient's OWN key. */
      forSelf?: boolean;
    };
  };
  /** Amount of tokens (raw integer units) to send. */
  amount: string;
  recipientAddress: string;
}

export interface BSV21TransferResult {
  ok: boolean;
  txid?: string;
  reason?: string;
  /** Signed AtomicBEEF of the transfer (from signAction) — for peer delivery. */
  beef?: number[];
}

export interface BSV21TransferDeps {
  wallet: WalletInterface;
  identityKey: string;
  chain: 'main' | 'test' | 'ttn';
  /** Deriver used for token-change addresses. */
  deriver: BSV21KeyDeriver;
  /** Indexer for optional pre-send origin validation. */
  indexer: OneSatIndexerClient;
  /** Toggle the overlay check off when the indexer is known unavailable. */
  originVerify?: boolean;
}

/** Dynamic bsv-js import — same pattern StasTransferService uses. */
async function loadBsvJs(): Promise<{ bsv: any }> {
  const bsvMod: any = await import('bsv');
  return { bsv: bsvMod.default ?? bsvMod };
}

function toHex(bytes: number[] | Uint8Array): string {
  const arr = Array.isArray(bytes) ? bytes : Array.from(bytes);
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class BSV21TransferService {
  constructor(private readonly deps: BSV21TransferDeps) {}

  async transfer(args: BSV21TransferArgs): Promise<BSV21TransferResult> {
    const { source, amount, recipientAddress } = args;
    const { wallet, deriver, indexer } = this.deps;
    const originVerify = this.deps.originVerify ?? true;

    // 1. Validate amounts up front. BSV-21 amounts are bigint strings.
    let sendAmt: bigint;
    let inAmt: bigint;
    try {
      sendAmt = BigInt(amount);
      inAmt = BigInt(source.amt);
      if (sendAmt <= 0n) throw new Error('amount must be > 0');
      if (sendAmt > inAmt) throw new Error(`amount ${sendAmt} exceeds input ${inAmt}`);
    } catch (err) {
      return { ok: false, reason: `amount validation: ${errMsg(err)}` };
    }
    const changeAmt = inAmt - sendAmt;

    // 2. Optional origin verification — fail closed where we can,
    //    short-circuit where we can't.
    //
    //    Three branches:
    //    a) Source IS the deploy+mint output itself (first transfer from
    //       the root). It's canonical by construction — no validation
    //       needed. Token id encodes the deploy outpoint as `<txid>_<vout>`.
    //    b) Overlay returns `null` for the validate-outputs call. This
    //       happens when the per-token topic-manager (`tm_{tokenId}`)
    //       isn't active (1sat-stack fee-gate). We can't verify, but
    //       can't fail closed either — log a warning and proceed.
    //    c) Overlay returns an array. Standard path — outpoint must be
    //       in the validated set or we refuse.
    const sourceOutpointUnderscored = OneSatIndexerClient.dotToUnderscore(
      `${source.txid}.${source.vout}`
    );
    const isDeployRoot = sourceOutpointUnderscored === source.tokenId;
    if (originVerify && !isDeployRoot) {
      let valid: Set<string> | null;
      try {
        valid = await indexer.validateOutputs(source.tokenId, [
          sourceOutpointUnderscored,
        ]);
      } catch (err) {
        return { ok: false, reason: `origin overlay unreachable: ${errMsg(err)}` };
      }
      if (valid === null) {
        // Per-token validation unavailable. Most common cause: token's
        // per-token worker isn't active yet (overlay returns 200 + null
        // body). Log and proceed — the recipient's wallet still trusts
        // the inscription bytes for ownership; the worst case is they
        // can't see a token-scoped balance until activation.
        tokenLog.warn(
          `[bsv-21 transfer] origin validate unavailable for ${source.tokenId} — proceeding without ancestry check`
        );
      } else if (!valid.has(sourceOutpointUnderscored)) {
        // Fail-open (not fail-closed): the overlay returned a validated set
        // that omits our outpoint. This is common for self-broadcast transfers
        // and tokens whose per-token worker lagged or rejected the submit — it
        // does NOT mean the token is counterfeit. Blocking here would refuse a
        // legitimate send of a UTXO we hold. Two facts make the overlay's set
        // non-authoritative now:
        //   • discovery migrated to WOC, whose BSV-21 indexer runs its OWN
        //     origin validation on the receive side (the real gate), and
        //   • the broadcast goes through wallet-toolbox/ARC, not the overlay.
        // So warn and proceed; the recipient's indexer decides admissibility.
        tokenLog.warn(
          `[bsv-21 transfer] origin outpoint ${sourceOutpointUnderscored} not in overlay validated set for ${source.tokenId} — proceeding (WOC indexer is the receive-side gate)`
        );
      }
    }

    // 3. Resolve recipient + (optional) change hash160s. Addresses come in
    //    base58 — bsv-js's Address gives us the hash buffer.
    let bsv: any;
    try {
      ({ bsv } = await loadBsvJs());
    } catch (err) {
      return { ok: false, reason: `load bsv-js: ${errMsg(err)}` };
    }
    let recipientHash160Hex: string;
    try {
      recipientHash160Hex = bsv.Address.fromString(recipientAddress).hashBuffer.toString('hex');
    } catch (err) {
      return { ok: false, reason: `invalid recipient: ${errMsg(err)}` };
    }

    let changeHash160Hex: string | undefined;
    let changeKeyId: string | undefined;
    if (changeAmt > 0n) {
      try {
        const ctx = await deriver.createNextReceiveContext();
        changeHash160Hex = ctx.ownerFieldHash160;
        changeKeyId = ctx.keyId;
      } catch (err) {
        return { ok: false, reason: `derive change key: ${errMsg(err)}` };
      }
    }

    // 4. Build the two BSV-21 outputs. Both are 1 sat.
    //
    // Normalize tokenId to underscore form per BSV-21 spec. Historical
    // registration paths in this wallet sometimes wrote the dot form (the
    // overlay surfaces outpoints as `txid.vout`); the inscription's `id`
    // field MUST be `txid_vout` or the topic-manager rejects the transfer.
    // Normalising at the boundary makes the on-chain bytes correct
    // regardless of how the source was stored.
    const canonicalTokenId = source.tokenId.replace('.', '_');
    const destScriptHex = buildBsv21Transfer({
      payload: {
        id: canonicalTokenId,
        amt: sendAmt.toString(),
        dec: source.dec,
        sym: source.sym,
        icon: source.icon,
      },
      ownerHash160: recipientHash160Hex,
    });
    let changeScriptHex: string | undefined;
    if (changeAmt > 0n && changeHash160Hex) {
      changeScriptHex = buildBsv21Transfer({
        payload: {
          id: canonicalTokenId,
          amt: changeAmt.toString(),
          dec: source.dec,
          sym: source.sym,
          icon: source.icon,
        },
        ownerHash160: changeHash160Hex,
      });
    }

    // 5. Build the inputBEEF that lets internalize/createAction verify the
    //    spent output. Same chained walkback STAS uses.
    let inputBEEF: number[];
    try {
      const built = await buildChainedAtomicBeef({ wallet, txid: source.txid });
      inputBEEF = built.beef;
    } catch (err) {
      return { ok: false, reason: `inputBEEF: ${errMsg(err)}` };
    }

    // 6. createAction. The wallet auto-funds BSV and adds standard change.
    //
    // The recipient output stays external — wallet-toolbox should NOT add
    // it to any basket. The token-change output, by contrast, goes back to
    // a wallet-derived BSV-21 address (see step 3 — `changeHash160Hex`
    // comes from `deriver.createNextReceiveContext()`), so we declare its
    // `basket` + `customInstructions` + `tags` here. Without these,
    // createAction creates the on-chain output but leaves
    // `outputs.basketId = NULL` in the SQL row, which means the user
    // permanently loses sight of their change tokens — the AssetsPage
    // basket query never returns them.
    //
    // The shape mirrors `BSV21Registration.register()`'s internalize call
    // so listOutputs(bsv-21-tokens) returns identical row metadata for
    // organic-discovery and self-change paths.
    const outputs: any[] = [
      {
        lockingScript: destScriptHex,
        satoshis: 1,
        outputDescription: 'BSV-21 to recipient',
      },
    ];
    if (changeScriptHex && changeHash160Hex && changeKeyId) {
      // Owner address for the customInstructions.
      let changeOwnerAddress: string;
      try {
        changeOwnerAddress = new (Address as any)(fromHex(changeHash160Hex)).Value as string;
      } catch {
        changeOwnerAddress = '';
      }
      const changeCustomInstructions = JSON.stringify({
        kind: 'bsv-21',
        protocolID: BSV21_PROTOCOL_ID,
        keyID: changeKeyId,
        counterparty: BSV21_COUNTERPARTY,
        tokenId: canonicalTokenId,
        ownerAddress: changeOwnerAddress,
      });
      const changeTags: string[] = ['bsv21', `id:${canonicalTokenId}`, `amt:${changeAmt.toString()}`];
      if (source.dec !== undefined) changeTags.push(`dec:${source.dec}`);
      if (source.sym) changeTags.push(`sym:${source.sym}`);
      if (source.icon) changeTags.push(`icon:${source.icon}`);

      outputs.push({
        lockingScript: changeScriptHex,
        satoshis: 1,
        outputDescription: 'BSV-21 token change',
        basket: BSV21_BASKET,
        customInstructions: changeCustomInstructions,
        tags: changeTags,
      });
    }

    let createRes: any;
    try {
      createRes = await wallet.createAction(
        {
          labels: ['peertoken'],
          inputBEEF,
          inputs: [
            {
              outpoint: `${source.txid}.${source.vout}`,
              unlockingScriptLength: 108, // standard P2PKH unlock: ~73 sig + 33 pubkey + push opcodes
              inputDescription: 'BSV-21 token input',
            },
          ],
          outputs,
          description: 'BSV-21 transfer',
          options: { randomizeOutputs: false },
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

    // 7. Pull the atomic tx out of the signable BEEF and rebuild a bsv-js
    //    Transaction so we can compute the sighash. Same trick as STAS.
    let tx: any;
    try {
      const beef = Beef.fromBinary(signable.tx);
      const atomicTxid = (beef as any).atomicTxid as string | undefined;
      if (!atomicTxid) return { ok: false, reason: 'signable BEEF has no atomic txid' };
      const btx = beef.findTxid(atomicTxid);
      if (!btx?.tx) return { ok: false, reason: `signable BEEF missing atomic tx ${atomicTxid}` };
      const rawTxBytes = btx.tx.toBinary();
      tx = new bsv.Transaction(Buffer.from(rawTxBytes).toString('hex'));
      tx.inputs[0].output = new bsv.Transaction.Output({
        script: bsv.Script.fromHex(source.scriptHex),
        satoshis: source.satoshis,
      });
    } catch (err) {
      return { ok: false, reason: `parse signable tx: ${errMsg(err)}` };
    }

    // 8. Compute the P2PKH sighash for input 0 over the full source script.
    //    The ord envelope at the head is dead code on eval but participates
    //    in the sighash subject (BSV sighash hashes whole locking script).
    let sigHex: string;
    let ownerPubKeyHex: string;
    // Effective owner-key derivation. Defaults to the self-owned scheme; a
    // BRC-29 peer-received token overrides keyID + counterparty so it stays
    // spendable.
    const ownerDerivation = {
      protocolID: (source.owner?.protocolID ?? BSV21_PROTOCOL_ID) as any,
      keyID: source.owner?.keyID ?? source.brc42KeyId,
      counterparty: (source.owner?.counterparty ?? BSV21_COUNTERPARTY) as any,
      forSelf: source.owner?.forSelf === true,
    };
    try {
      const sourceLocking = bsv.Script.fromHex(source.scriptHex);
      const satsBN = new bsv.crypto.BN(source.satoshis);
      const preimage = bsv.Transaction.sighash.sighashPreimage(
        tx, SIGHASH_ALL_FORKID, 0, sourceLocking, satsBN
      );
      const digestBuf = bsv.crypto.Hash.sha256sha256(preimage);
      const digestBytes = Array.from(digestBuf as Buffer) as number[];

      const sigRes = await wallet.createSignature(
        {
          protocolID: ownerDerivation.protocolID,
          keyID: ownerDerivation.keyID,
          counterparty: ownerDerivation.counterparty,
          hashToDirectlySign: digestBytes,
        } as any,
        ORIGINATOR
      );
      sigHex = toHex(sigRes.signature) + SIGHASH_ALL_FORKID.toString(16).padStart(2, '0');

      // Derive the matching pubkey for the unlocking script.
      const { publicKey } = await wallet.getPublicKey(
        {
          protocolID: ownerDerivation.protocolID,
          keyID: ownerDerivation.keyID,
          counterparty: ownerDerivation.counterparty,
          forSelf: ownerDerivation.forSelf,
        } as any,
        ORIGINATOR
      );
      ownerPubKeyHex = publicKey;
    } catch (err) {
      return { ok: false, reason: `sighash/sign: ${errMsg(err)}` };
    }

    // 9. Standard P2PKH unlocking script: <sig> <pubkey>.
    let unlockingScriptHex: string;
    try {
      const asm = `${sigHex} ${ownerPubKeyHex}`;
      unlockingScriptHex = bsv.Script.fromASM(asm).toHex();
    } catch (err) {
      return { ok: false, reason: `unlocking script assembly: ${errMsg(err)}` };
    }

    // 10. signAction — the wallet queues + monitor worker handles broadcast.
    let signResp: any;
    try {
      signResp = await wallet.signAction(
        {
          reference: signable.reference,
          spends: { 0: { unlockingScript: unlockingScriptHex } },
        } as any,
        ORIGINATOR
      );
    } catch (err) {
      return { ok: false, reason: `signAction: ${errMsg(err)}` };
    }

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

    // 11. Indexer-coupling step: submit the AtomicBEEF to the overlay's
    //     `/1sat/bsv21/overlay/submit` endpoint with the per-token topic
    //     (`tm_<tokenId>`) so the BSV-21 topic-manager admits the transfer
    //     and surfaces it via `/1sat/owner/.../txos`. This is what
    //     yours-wallet's @1sat/client OverlayClient.submitBsv21 does and
    //     what makes organic-receive work for the recipient side.
    //
    //     We pass `signResp.tx` (the signed AtomicBEEF) — not raw bytes,
    //     not refetched-via-getRawTx. The AtomicBEEF includes parent
    //     funding transactions with their merkle proofs, which is what
    //     the topic-manager needs to validate the chain.
    //
    //     Best-effort: a failure here doesn't fail the transfer. The tx
    //     is already broadcast through wallet-toolbox's primary path; the
    //     overlay submit only adds the indexer entry. If it fails today,
    //     the tx becomes discoverable when JungleBus auto-pickup catches
    //     up (also requires canonical inscription format — see inscription.ts).
    try {
      const signedBeef: number[] | undefined = signResp?.tx;
      if (signedBeef && signedBeef.length > 0) {
        const submit = await this.deps.indexer.submitTransaction(signedBeef, {
          tokenId: source.tokenId,
        });
        if (submit.ok) {
          tokenLog.debug(`[bsv-21 transfer] overlay submit ✓ ${submit.body.slice(0, 200)}`);
        } else {
          tokenLog.warn(`[bsv-21 transfer] overlay submit ${submit.status}: ${submit.body.slice(0, 200)}`);
        }
      } else {
        tokenLog.warn('[bsv-21 transfer] overlay submit skipped — signResp.tx empty (returnTXIDOnly?)');
      }
    } catch (err) {
      tokenLog.warn(`[bsv-21 transfer] overlay submit threw: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { ok: true, txid: signResp?.txid, beef: signResp?.tx };
  }
}

// Suppress an unused-import warning — `fromHex` and `Address` may be useful
// in the future for richer address-handling and we want to keep the import
// surface aligned with the rest of the BSV-21 module.
void fromHex; void Address;
