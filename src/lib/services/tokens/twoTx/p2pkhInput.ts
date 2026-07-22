/**
 * signP2pkhInput — sign a plain P2PKH input via `wallet.createSignature`.
 *
 * Part of the storage-agnostic 2-tx token transfer. TX2's single funding input
 * spends a P2PKH output that TX1 created at a wallet-protocol (BRC-29) address
 * we derived ourselves (`counterparty:'anyone', forSelf:true`). The wallet won't
 * sign a caller-supplied input during `signAction`, so we sign it here exactly
 * the way the STAS/DSTAS services sign their token input — build the sighash
 * preimage with bsv-js, double-sha256 it, and hand the digest to
 * `wallet.createSignature` with the same derivation triple used to lock it —
 * then assemble the bare `<sig+sighashByte> <pubkey>` unlocking script.
 *
 * The derivation MUST match how TX1's output was locked (see fundingOutput.ts):
 * protocolID = BRC-29 `[2,'3241645161d8']`, keyID = `"<prefix> <suffix>"`,
 * counterparty = 'anyone', forSelf = true.
 */

import type { WalletInterface, WalletProtocol } from '@bsv/sdk';

/** BRC-29 ("SABPPP") payment protocol id — matches ScriptTemplateBRC29 / LegacyBridge. */
export const BRC29_PROTOCOL_ID: WalletProtocol = [2, '3241645161d8'];

export interface SignP2pkhInputArgs {
  wallet: WalletInterface;
  /** Loaded bsv-js module (the callers already `loadStasDeps()` it). */
  bsv: any;
  /** bsv-js Transaction being signed; input `inputIndex`'s prev-output must be attached. */
  tx: any;
  inputIndex: number;
  derivationPrefix: string;
  derivationSuffix: string;
  /** P2PKH locking script hex of the output being spent (TX1's funding output). */
  sourceScriptHex: string;
  sourceSatoshis: number;
  /** e.g. SIGHASH_ALL | FORKID = 0x41. */
  sighashType: number;
  originator: string;
}

/**
 * Returns the funding input's unlocking script hex (`<DER sig + sighash byte> <compressed pubkey>`).
 */
export async function signP2pkhInput(args: SignP2pkhInputArgs): Promise<string> {
  const {
    wallet, bsv, tx, inputIndex,
    derivationPrefix, derivationSuffix,
    sourceScriptHex, sourceSatoshis, sighashType, originator,
  } = args;

  const derivation = {
    protocolID: BRC29_PROTOCOL_ID,
    keyID: `${derivationPrefix} ${derivationSuffix}`,
    counterparty: 'anyone' as const,
    forSelf: true,
  };

  // Public key that P2PKH-locks the funding output (same derivation TX1 used).
  const { publicKey } = await wallet.getPublicKey({ ...derivation } as any, originator);

  // Sighash preimage over the funding input → double-sha256 digest.
  const sourceLocking = bsv.Script.fromHex(sourceScriptHex);
  const satsBN = new bsv.crypto.BN(sourceSatoshis);
  const preimage = bsv.Transaction.sighash.sighashPreimage(
    tx, sighashType, inputIndex, sourceLocking, satsBN,
  );
  const digest = Array.from(bsv.crypto.Hash.sha256sha256(preimage) as Buffer) as number[];

  const sigRes = await wallet.createSignature(
    { ...derivation, hashToDirectlySign: digest } as any,
    originator,
  );
  const sigHex =
    Buffer.from(sigRes.signature as number[]).toString('hex') +
    sighashType.toString(16).padStart(2, '0');

  // Bare P2PKH unlock: <sig+sighashtype> <pubkey>.
  return bsv.Script.fromASM(`${sigHex} ${publicKey}`).toHex();
}
